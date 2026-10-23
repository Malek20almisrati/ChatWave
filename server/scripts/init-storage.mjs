import { S3Client, CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}; initialize the local environment first.`);

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const buckets = [
  process.env.S3_BUCKET_IMAGES || 'chatwave-images',
  process.env.S3_BUCKET_VIDEOS || 'chatwave-videos',
  process.env.S3_BUCKET_FILES || 'chatwave-files',
  process.env.S3_BUCKET_QUARANTINE || 'chatwave-quarantine',
];
const cors = {
  CORSRules: [{
    AllowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
    AllowedMethods: ['POST', 'GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 300,
  }],
};

for (const bucket of buckets) {
  try { await client.send(new CreateBucketCommand({ Bucket: bucket })); }
  catch (error) {
    if (!['BucketAlreadyExists', 'BucketAlreadyOwnedByYou', 'BucketAlreadyOwnedByAccount'].includes(error.name)) throw error;
  }
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: cors }));
}
client.destroy();
process.stdout.write(`Initialized ${buckets.length} private development buckets and browser CORS rules.\n`);
