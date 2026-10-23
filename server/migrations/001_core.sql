CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE audience_scope AS ENUM ('private', 'friends', 'public');
CREATE TYPE media_kind AS ENUM ('image', 'video', 'file');
CREATE TYPE media_state AS ENUM ('pending_upload', 'quarantined', 'ready', 'rejected', 'delete_pending');
CREATE TYPE conversation_kind AS ENUM ('direct', 'group', 'channel', 'bot');
CREATE TYPE friendship_state AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE otp_purpose AS ENUM ('register', 'login', 'phone_change');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  birth_date date NOT NULL,
  country_code char(2) NOT NULL,
  display_name varchar(48) NOT NULL,
  username varchar(24) NOT NULL,
  bio varchar(160) NOT NULL DEFAULT '',
  gender varchar(8) NOT NULL CHECK (gender IN ('male', 'female')),
  visibility audience_scope NOT NULL DEFAULT 'private',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated', 'deletion_pending', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_username_lower_unique ON users (lower(username));
CREATE INDEX users_country_created_idx ON users (country_code, created_at DESC);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose otp_purpose NOT NULL,
  phone_e164 text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  otp_hash bytea NOT NULL,
  pending_password_hash text,
  pending_birth_date date,
  pending_country_code char(2),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  registration_token_hash bytea,
  registration_token_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'register' AND pending_password_hash IS NOT NULL AND pending_birth_date IS NOT NULL AND pending_country_code IS NOT NULL) OR purpose <> 'register')
);
CREATE INDEX otp_phone_recent_idx ON otp_challenges (phone_e164, created_at DESC);
CREATE INDEX otp_expiry_idx ON otp_challenges (expires_at);

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_active_idx ON account_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE guardian_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code char(2) NOT NULL,
  provider text NOT NULL,
  provider_reference text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'withdrawn', 'expired', 'rejected')),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardian_child_status_idx ON guardian_verifications (child_user_id, status);

CREATE TABLE user_interests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_key varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest_key)
);

CREATE TABLE friendships (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state friendship_state NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, recipient_id),
  CHECK (requester_id <> recipient_id)
);
CREATE INDEX friendships_recipient_idx ON friendships (recipient_id, state, created_at DESC);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind media_kind NOT NULL,
  bucket_name text NOT NULL,
  object_key text NOT NULL UNIQUE,
  original_filename varchar(255) NOT NULL,
  declared_mime_type varchar(127) NOT NULL,
  detected_mime_type varchar(127),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 bytea,
  state media_state NOT NULL DEFAULT 'pending_upload',
  audience audience_scope NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  scanned_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX media_owner_created_idx ON media_assets (owner_id, created_at DESC);
CREATE INDEX media_quarantine_idx ON media_assets (state, created_at) WHERE state IN ('pending_upload', 'quarantined');

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  audience audience_scope NOT NULL DEFAULT 'friends',
  context_tag varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (length(body) <= 5000)
);
CREATE INDEX posts_feed_idx ON posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE post_media (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id),
  UNIQUE (post_id, position)
);

CREATE TABLE post_reactions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction varchar(16) NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX post_comments_post_idx ON post_comments (post_id, created_at);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind conversation_kind NOT NULL DEFAULT 'direct',
  title varchar(80),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'bot')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  pinned_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX members_user_idx ON conversation_members (user_id, joined_at DESC) WHERE left_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CHECK (length(body) <= 10000)
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE TABLE message_media (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (message_id, media_id)
);

CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  audience audience_scope NOT NULL DEFAULT 'friends',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  archived_at timestamptz
);
CREATE INDEX stories_expiry_idx ON stories (expires_at) WHERE archived_at IS NULL;

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  category varchar(48) NOT NULL,
  details varchar(3000) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'in_review', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_queue_idx ON reports (status, created_at);

CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL,
  username varchar(24) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  visibility audience_scope NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channels_username_lower_unique ON channels (lower(username));
CREATE TABLE channel_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  title varchar(120) NOT NULL,
  description varchar(2000) NOT NULL DEFAULT '',
  is_reel boolean NOT NULL DEFAULT false,
  duration_seconds integer,
  audience audience_scope NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
  CHECK (NOT is_reel OR duration_seconds BETWEEN 60 AND 90)
);
CREATE INDEX channel_videos_feed_idx ON channel_videos (created_at DESC);
