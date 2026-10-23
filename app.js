(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const views = $$('.view');
  const navLinks = $$('[data-view-link]');
  const toast = $('#toast');
  const authGate = $('#auth-gate');
  const appShell = $('#app-shell');
  const fileState = { media: null, document: null, storyUrl: '' };
  const objectUrls = new Set();
  let toastTimer;
  let currentChat = '';
  let authMode = 'register';
  let uploadMode = 'post';
  let reelDurationState = 'idle';
  let currentLocale = 'en';
  let previewOnly = location.protocol === 'file:' || new URLSearchParams(location.search).get('preview') === '1';
  let backendChallengeId = '';
  let backendRegistrationToken = '';
  let recoveryChallengeId = '';
  let backendFlow = false;
  let backendProbe = null;
  let backendSessionActive = false;
  let backendUserId = '';
  let currentConversationId = '';
  let isMinorPreview = false;
  let onboardingStep = 1;
  let profilePhotoUrl = '';
  let profilePostCount = 0;
  let profileVideoCount = 0;
  let activeStory = null;
  const savedStories = [];
  const storyVideoUrls = new Set();
  const arNumber = new Intl.NumberFormat('ar');
  const enNumber = new Intl.NumberFormat('en');
  const txt = (ar, en) => currentLocale === 'ar' ? ar : en;
  const apiRequest = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const contentType = response.headers.get('content-type') || '';
    const hasJson = contentType.toLowerCase().includes('json');
    const result = hasJson ? await response.json().catch(() => ({})) : {};
    if (!response.ok) throw Object.assign(new Error(result.error || (hasJson ? 'server_error' : 'api_unavailable')), { status: response.status, apiCode: result.error || (hasJson ? 'server_error' : 'api_unavailable') });
    if (!hasJson) throw Object.assign(new Error('api_unavailable'), { status: response.status, apiCode: 'api_unavailable' });
    return result;
  };
  const mimeForFile = (file) => file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream';
  const uploadToQuarantine = async (file, kind) => {
    const mimeType = mimeForFile(file);
    const ticket = await apiRequest('/api/media/tickets', { method: 'POST', body: JSON.stringify({ filename: file.name, mimeType, byteSize: file.size, kind }) });
    const form = new FormData();
    Object.entries(ticket.upload.fields).forEach(([key, value]) => form.append(key, value));
    if (!('Content-Type' in ticket.upload.fields)) form.append('Content-Type', mimeType);
    form.append('file', file);
    const response = await fetch(ticket.upload.url, { method: 'POST', body: form });
    if (!response.ok) throw new Error('object_upload_failed');
    const completed = await apiRequest(`/api/media/${ticket.assetId}/complete`, { method: 'POST', body: '{}' });
    return { assetId: completed.assetId, state: completed.state };
  };
  const apiErrorMessage = (code) => ({
    guardian_verification_required: txt('يتطلب هذا الحساب مسار تحقق موثقًا لولي الأمر غير المتصل بعد.', 'This account needs a verified guardian pathway that is not connected yet.'),
    invalid_registration_details: txt('راجعي رقم الهاتف وتاريخ الميلاد والبلد ثم حاولي مجددًا.', 'Check your phone number, birth date, and country, then try again.'),
    registration_unavailable: txt('تعذر بدء التسجيل بهذه البيانات. تحققي من الرقم أو سجّلي الدخول.', 'Registration could not start with these details. Check the number or sign in.'),
    registration_session_expired: txt('انتهت جلسة التسجيل. ابدئي من جديد.', 'Your registration session expired. Start again.'),
    username_or_phone_unavailable: txt('اسم المستخدم أو رقم الهاتف مستخدم بالفعل.', 'That username or phone number is already in use.'),
    too_many_verification_requests: txt('وصلتِ إلى حد طلبات التحقق. حاولي لاحقًا.', 'Too many verification requests. Try again later.'),
    invalid_verification_code: txt('رمز التحقق غير صحيح.', 'That verification code is incorrect.'),
    verification_challenge_expired: txt('انتهت صلاحية الرمز. ابدئي طلب تحقق جديدًا.', 'That code expired. Request a new verification code.'),
    sms_provider_unavailable: txt('خدمة الرسائل غير مهيأة. لم يُنشأ الحساب.', 'SMS delivery is not configured. No account was created.'),
    sms_delivery_failed: txt('تعذر إرسال رسالة التحقق. حاولي لاحقًا.', 'The verification message could not be sent. Try again later.'),
    invalid_login_details: txt('رقم الهاتف أو كلمة المرور غير صحيحة.', 'The phone number or password is incorrect.'),
    password_policy_failed: txt('كلمة المرور لا تحقق متطلبات الأمان.', 'The password does not meet the security requirements.'),
    session_expired: txt('انتهت جلسة الدخول. سجّلي الدخول من جديد.', 'Your session expired. Please sign in again.'),
    recovery_token_invalid: txt('انتهت صلاحية جلسة الاستعادة. اطلبي رمزًا جديدًا.', 'That recovery session expired. Request a new code.'),
    account_deactivation_unavailable: txt('تعذر تعطيل الحساب الآن.', 'The account could not be deactivated right now.'),
    direct_chat_requires_one_person: txt('تتطلب المحادثة الخاصة شخصًا واحدًا.', 'A direct conversation needs one person.'),
    avatar_not_ready: txt('صورة الملف الشخصي غير جاهزة؛ أكملي فحص الملف أولًا.', 'That profile photo is not ready. Complete the file scan first.'),
    uploaded_file_does_not_match_ticket: txt('لم يطابق الملف بيانات الرفع، لذلك أُزيل من التخزين.', 'The uploaded file did not match its upload details and was removed.'),
    upload_not_found: txt('لم نعثر على هذا الملف أو انتهت صلاحية الرفع.', 'That upload was not found or has expired.'),
    media_not_available: txt('هذا الملف غير متاح.', 'This file is not available.'),
    file_type_or_size_rejected: txt('نوع الملف أو حجمه غير مسموح.', 'That file type or size is not allowed.'),
    upload_quota_exceeded: txt('وصلتِ إلى الحد المؤقت للملفات غير المفحوصة. أزيلي ملفًا أو حاولي لاحقًا.', 'The temporary limit for unscanned files has been reached. Remove a file or try again later.'),
    object_upload_failed: txt('تعذر رفع الملف إلى المخزن الخاص. حاولي مجددًا.', 'The file could not be uploaded to private storage. Please try again.'),
    people_not_available: txt('لم نعثر على هذا الاسم أو لا يمكن بدء التواصل معه.', 'That username is unavailable or cannot be contacted.'),
    friends_only_messaging: txt('يمكنك بدء محادثة مع الأصدقاء المقبولين فقط.', 'You can start chats with accepted friends only.'),
    friend_request_not_found: txt('لم نعثر على طلب صداقة معلّق لهذا الحساب.', 'There is no pending friend request from that account.'),
    public_post_blocked_by_privacy: txt('اجعلي الملف عامًا أولًا من إعدادات الخصوصية.', 'Change your profile visibility before publishing a public post.'),
    post_text_required: txt('اكتبي نص المنشور أولًا.', 'Add some text to your post first.'),
    group_title_required: txt('أدخلي اسمًا للجروب.', 'Enter a name for the group.'),
    group_not_found: txt('لم نعثر على هذا الجروب.', 'That group was not found.'),
    group_admin_required: txt('يتطلب هذا الإجراء صلاحية المالك أو المشرف.', 'Only the owner or an admin can do that.'),
    group_owner_required: txt('يمكن لمالك الجروب وحده تغيير دور المشرفين.', 'Only the group owner can change admin roles.'),
    public_group_required_for_open_join: txt('الانضمام المفتوح متاح للجروبات العامة فقط.', 'Open joining is available for public groups only.'),
    group_invite_not_found: txt('رابط الانضمام غير صالح أو انتهت صلاحيته.', 'That group link is invalid or has expired.'),
    channel_username_unavailable: txt('اسم رابط القناة مستخدم بالفعل.', 'That channel link is already in use.'),
    channel_owner_required: txt('يمكن لمالك القناة وحده تعيين المشرفين.', 'Only the channel owner can appoint admins.'),
    invalid_channel_admin: txt('تأكدي من أسماء المستخدمين للمشرفين، ولا تضيفي حسابك كمسؤول.', 'Check the admin usernames; you cannot add your own account as an admin.'),
    channel_link_invalid: txt('رابط القناة غير صالح أو لا يمكن الوصول إليه.', 'That channel link is invalid or unavailable.'),
    server_error: txt('تعذر الاتصال بالخدمة. حاولي مجددًا بعد قليل.', 'The service could not complete the request. Please try again.'),
    sign_in_required: txt('سجّلي الدخول للمتابعة.', 'Sign in to continue.'),
  }[code] || txt('تعذر إكمال الطلب. تحققي من البيانات وحاولي مجددًا.', 'The request could not be completed. Check the details and try again.'));
  const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
  const enhanceCountryInputs = () => {
    ['age-gate-country', 'onboarding-country'].forEach((id) => {
      const oldInput = $(`#${id}`);
      if (!oldInput || oldInput.tagName === 'SELECT') return;
      const select = document.createElement('select');
      select.id = id;
      select.className = oldInput.className;
      select.required = oldInput.required;
      select.dataset.countrySelect = 'true';
      select.setAttribute('autocomplete', 'country-name');
      oldInput.replaceWith(select);
    });
  };
  const updateCountryOptions = () => {
    const names = typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([currentLocale], { type: 'region' })
      : null;
    $$('select[data-country-select]').forEach((select) => {
      if (select.dataset.locale === currentLocale) return;
      const selected = select.value;
      const placeholder = new Option(txt('اختاري بلد الإقامة', 'Choose your country'), '');
      const options = countryCodes.map((code) => ({ code, label: names?.of(code) || code })).sort((a, b) => a.label.localeCompare(b.label, currentLocale));
      select.replaceChildren(placeholder, ...options.map(({ code, label }) => new Option(label, code)));
      select.value = selected;
      select.dataset.locale = currentLocale;
    });
  };
  const digitsToLatin = (value) => String(value).replace(/[٠-٩۰-۹]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10));
  const yearsOld = (value) => {
    if (!value) return NaN;
    const birth = new Date(`${value}T00:00:00`);
    if (Number.isNaN(birth.getTime()) || birth > new Date()) return NaN;
    const now = new Date();
    return now.getFullYear() - birth.getFullYear() - ((now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) ? 1 : 0);
  };
  const copy = {
    'لحظاتك. أصدقاؤك. في مكان واحد.': 'Your moments. Your friends. All in one place.',
    'شارك، تواصل. مجتمع يجمعنا.': 'Share, connect. A community that brings us together.',
    'تواصل بلا حدود': 'Connect without limits', 'أنشئي حسابك': 'Create your account', 'سجّلي الدخول': 'Sign in',
    'ضعي رقم هاتفك لتصلك رسالة التحقق.': 'Enter your phone number to receive a verification code.', 'ضع رقم هاتفك لتصلك رسالة التحقق.': 'Enter your phone number to receive a verification code.',
    'قبل إنشاء الحساب، أخبرينا بتاريخ ميلادك وبلد إقامتك لعرض مسار العمر المناسب.': 'Before creating an account, enter your date of birth and country so we can show the right age pathway.',
    'تاريخ الميلاد': 'Date of birth', 'بلد الإقامة': 'Country of residence', 'اختاري البلد أو المنطقة': 'Choose a country or region', 'اختاري بلدك': 'Choose your country',
    'الولايات المتحدة': 'United States', 'المملكة المتحدة': 'United Kingdom', 'الاتحاد الأوروبي': 'European Union', 'دولة في الاتحاد الأوروبي': 'EU member state', 'ليبيا': 'Libya', 'بلد آخر': 'Other country', 'كندا': 'Canada', 'المكسيك': 'Mexico', 'إيرلندا': 'Ireland', 'فرنسا': 'France', 'ألمانيا': 'Germany', 'إسبانيا': 'Spain', 'إيطاليا': 'Italy', 'هولندا': 'Netherlands', 'السويد': 'Sweden', 'بولندا': 'Poland', 'البرتغال': 'Portugal', 'تركيا': 'Türkiye', 'مصر': 'Egypt', 'المغرب': 'Morocco', 'تونس': 'Tunisia', 'السعودية': 'Saudi Arabia', 'الإمارات': 'United Arab Emirates', 'الأردن': 'Jordan', 'لبنان': 'Lebanon', 'جنوب أفريقيا': 'South Africa', 'الهند': 'India', 'اليابان': 'Japan', 'سنغافورة': 'Singapore', 'أستراليا': 'Australia', 'نيوزيلندا': 'New Zealand', 'البرازيل': 'Brazil',
    'متابعة آمنة': 'Continue safely', 'مسار حماية القاصرين': 'Youth safety pathway',
    'لأن تاريخ الميلاد يشير إلى عمر دون ١٨ عامًا، تحتاج المنصة إلى مراجعة القواعد المحلية وموافقة ولي الأمر الموثقة عند لزومها. هذه المعاينة لا تستطيع التحقق من موافقة حقيقية، لذلك لن تطلب رقم الهاتف أو تنشئ حسابًا.': 'The date of birth indicates you are under 18. Local rules and verified guardian consent may apply. This preview cannot verify consent, so it will not ask for a phone number or create an account.',
    'استعراض وضع القاصر التجريبي': 'Preview youth-safe mode', 'تصحيح تاريخ الميلاد': 'Correct date of birth', 'هذا حد وقائي للمعاينة، وليس تحديدًا للسن القانوني في جميع البلدان.': 'This is a precaution for the preview, not a statement of the legal age in every country.',
    'رقم الهاتف': 'Phone number', 'مع رمز الدولة': 'Include country code', 'كلمة المرور': 'Password', 'إظهار': 'Show', 'إخفاء': 'Hide', '١٢ حرفًا على الأقل': 'At least 12 characters', 'استخدمي ١٢ حرفًا أو أكثر مع حروف وأرقام.': 'Use at least 12 characters with letters and numbers.',
    'أؤكد أن تاريخ ميلادي صحيح، وأفهم أن موافقة ولي الأمر قد تلزم بحسب بلدي.': 'I confirm my date of birth is correct and understand guardian consent may be required where I live.',
    'أوافق على': 'I agree to the', 'شروط الاستخدام': 'Terms of Service', 'سياسة الخصوصية': 'Privacy Policy', 'و': 'and ',
    'متابعة برقم الهاتف': 'Continue with phone', 'الدخول برقم الهاتف': 'Sign in with phone', 'لديك حساب بالفعل؟': 'Already have an account?', 'مستخدم جديد؟': 'New to ChatWave?', 'تسجيل الدخول': 'Sign in', 'إنشاء حساب': 'Create account',
    'تحقّق من رقمك': 'Verify your number', 'أدخل رمز التحقق المرسل إلى': 'Enter the verification code sent to', 'محاكاة فقط: لا توجد خدمة رسائل متصلة. أدخل ٦ أرقام للانتقال إلى معاينة الموقع.': 'Preview only: SMS is not connected. Enter any six digits to continue to the site preview.', 'متابعة المعاينة': 'Continue to preview', 'تعديل رقم الهاتف': 'Change phone number', 'هذه معاينة فقط. لا يُرسل رقمك أو كلمة المرور، ورمز التحقق غير متصل.': 'Preview only. Your phone number and password are not sent, and verification is not connected.',
    'الرئيسية': 'Home', 'الفيديوهات': 'Videos', 'الرسائل': 'Messages', 'اليوميات': 'Stories', 'الأصدقاء': 'Friends', 'ملفي الشخصي': 'My profile', 'الإعدادات': 'Settings', 'المساعدة والبلاغات': 'Help & reports', 'جديد': 'New', 'إخفاء أسماء الأقسام': 'Collapse navigation', 'إظهار أسماء الأقسام': 'Expand navigation',
    'ابحث عن أشخاص أو منشورات': 'Search people and posts', 'بحث': 'Search', 'الإشعارات': 'Notifications', 'نسخة تجريبية': 'Preview', 'مريم': 'Mariam', 'مريم خالد': 'Mariam Khaled',
    'أصدقاءك، لحظاتهم، وكل ما يهمك': 'Friends, their moments, and what matters to you', 'الأصدقاء والعامة': 'Friends & public', 'منشور جديد': 'New post', 'الأصدقاء': 'Friends', 'العامة': 'Public', 'الكل': 'All', 'الأكثر تفاعلاً': 'Most engaged', 'الأكثر مشاهدة': 'Most viewed', 'الأحدث': 'Most recent', 'انشر الآن': 'Share a post',
    'منشورات الأصدقاء والعامة': 'Posts from friends and public accounts', 'إعجاب': 'Like', 'تعليق': 'Comment', 'مشاركة': 'Share', 'حفظ': 'Save', 'تم الحفظ': 'Saved', 'خيارات المنشور': 'Post options', 'تفاعلًا': 'reactions', 'تعليقات': 'comments', 'مشاهدة': 'views', 'الأصدقاء فقط': 'Friends only', 'الجميع': 'Everyone',
    'لقطات سريعة': 'Quick moments', 'ريلز ChatWave': 'ChatWave Reels', 'اسحبي للأعلى للانتقال للمقطع التالي.': 'Scroll down or use the arrow to watch the next clip.', 'من ٦٠ إلى ٩٠ ثانية': 'One to one and a half minutes', 'إنشاء ريل': 'Create a Reel', 'إنشاء فيديو': 'Create video', 'رفع فيديو للقناة': 'Upload a channel video', 'اكتشفي القنوات': 'Discover channels', 'أعلى الفيديوهات': 'Top videos', 'الترتيب': 'Sort by', 'الأكثر إعجابًا': 'Most liked', 'الأكثر تعليقًا': 'Most commented', 'أعلى القنوات': 'Top channels', 'الأكثر اشتراكًا': 'Most subscribers', 'الموصى بها': 'Recommended', 'مشاهدة الفيديو': 'Watch video', 'متابعة': 'Follow', 'تتابعينها ✓': 'Following ✓',
    'المحادثات': 'Chats', 'الجروبات': 'Groups', 'القنوات': 'Channels', 'غير مقروءة': 'Unread', 'جهات الاتصال': 'Contacts', 'الغرباء': 'Strangers', 'البوتات': 'Bots', 'مثبتة': 'Pinned', 'الكل': 'All', 'الخاصة': 'Direct', 'رسالة جديدة': 'New message', 'اكتبي رسالة…': 'Write a message…', 'إرسال': 'Send',
    'أرشيف اليوميات': 'Story archive', 'أرشيف يومياتك': 'Your story archive', 'اليوميات التي حفظتِها تبقى خاصة بك.': 'Stories you save remain private to you.', 'احفظي يومية من شاشة العرض لتظهر هنا.': 'Save a story from its viewer to see it here.', 'حفظ في الأرشيف': 'Save to archive', 'تنتهي بعد ٢٤ ساعة · حتى ٣ يوميات لك أسبوعيًا': 'Stories expire after 24 hours · Up to 3 stories each week', 'يوميات الأصدقاء': 'Friends’ stories', 'عرض الكل': 'View all', 'يومية جديدة': 'New story',
    'اسم ظاهر': 'Display name', 'الاسم الظاهر': 'Display name', 'اسم المستخدم': 'Username', 'نبذة عنك': 'About you', 'تعديل الملف': 'Edit profile', 'أحب التفاصيل الصغيرة، والكتب، وكل صباح يبدأ بقهوة ☕': 'I love little details, books, and mornings that start with coffee ☕', 'صديقًا': 'friends', 'منشورًا': 'posts', 'فيديوهات': 'videos', 'منشورات مريم': 'Mariam’s posts', 'مرئية للأصدقاء': 'Visible to friends', 'مساحتك تبدأ من هنا': 'Your space starts here', 'شاركي أول لحظة مع أصدقائك من الصفحة الرئيسية.': 'Share your first moment with friends from the home page.',
    'اللغة وإمكانية الوصول': 'Language & accessibility', 'اختاري لغة الواجهة واتجاه الكتابة.': 'Choose the interface language and writing direction.', 'لغة الواجهة': 'Interface language', 'تتوفر الإنجليزية والعربية الآن؛ تظهر بقية اللغات عند اكتمال ترجمتها ومراجعتها.': 'English and Arabic are available now. More languages will appear after translation and review.',
    'الخصوصية والأمان': 'Privacy & safety', 'الحساب والخصوصية': 'Account & privacy', 'البلاغات والدعم': 'Reports & support', 'نسمعك': 'We’re listening', 'أرسلي شكوى أو بلاغًا عن مشكلة في ChatWave.': 'Send a complaint or report a problem with ChatWave.', 'كيف نقدر نساعدك؟': 'How can we help?', 'إرسال البلاغ': 'Submit report', 'فتح مركز الدعم': 'Open support center',
    'لنتعرف عليك': 'Let’s get to know you', 'الخطوة ١ من ٣': 'Step 1 of 3', 'الخطوة ٢ من ٣': 'Step 2 of 3', 'الخطوة ٣ من ٣': 'Step 3 of 3', 'متابعة': 'Continue', 'رجوع': 'Back', 'دخول إلى ChatWave': 'Enter ChatWave', 'الجنس': 'Gender', 'ذكر': 'Male', 'أنثى': 'Female', 'إضافة صورة': 'Add a photo', 'الرياضة': 'Sports', 'التعليم': 'Education', 'الطبخ': 'Cooking', 'التصميم': 'Design', 'السفر': 'Travel', 'التقنية': 'Technology', 'الفن والترفيه': 'Arts & entertainment', 'ما المحتوى الذي تفضلينه؟': 'What content are you interested in?', 'حسابات قد تعجبك': 'People you may like', 'الاهتمامات': 'Interests', 'حماية القاصرين مفعّلة في هذه المعاينة': 'Youth safeguards are on in this preview',
    'منشوراتك': 'Your feed', 'أصدقاءك، لحظاتهم، وكل ما يهمك': 'Friends, their moments, and everything you care about', 'منشورات الأصدقاء والعامة': 'Posts from friends and public accounts',
    'ليلى الحداد': 'Layla Al-Haddad', 'يوسف علي': 'Yousef Ali', 'سارة منصور': 'Sarah Mansour', 'عمر ناصر': 'Omar Nasser', 'نور إبراهيم': 'Noor Ibrahim', 'هند سالم': 'Hind Salem', 'ليلى': 'Layla', 'يوسف': 'Yousef', 'سارة': 'Sarah', 'عمر': 'Omar', 'نور': 'Noor',
    'منذ ١٥ دقيقة': '15 minutes ago', 'منذ ساعة': '1 hour ago', 'منذ ٣ ساعات': '3 hours ago', '٩٨٠': '980', '٧٦٠': '760', '١٢٫٤ ألف': '12.4K', 'رحلة ومكان': 'Travel & places', 'صباح البحر له حكاية ثانية 🌊 يوم هادئ، وشمس لطيفة، وقهوة ما تنوصف.': 'The sea has its own story in the morning 🌊 A quiet day, soft sunshine, and unforgettable coffee.', 'على مهل… كل شيء أجمل': 'Take your time… everything is lovelier',
    'وصفة سريعة لليوم: معكرونة بالليمون والريحان 🍋 تحفظونها للعشاء؟': 'A quick recipe for today: lemon and basil pasta 🍋 Saving it for dinner?', 'مطبخ البيت': 'Home Kitchen', 'وصفة في دقيقة': 'A recipe in a minute', 'وصفة اليوم': 'Today’s recipe', 'تذكير صغير: خذي استراحة، اشربي ماء، واحتفلي بالأشياء البسيطة التي أنجزتها اليوم. 🌷': 'A little reminder: take a break, drink water, and celebrate the small things you did today. 🌷', 'لحظة ملهمة': 'A little inspiration', 'يا سلام على الهدوء 💙': 'What a peaceful view 💙',
    'لحظات عابرة': 'Little moments', 'صور ومقاطع يشاركها أصدقاؤك لمدة محدودة.': 'Photos and clips shared by friends for a limited time.', '٣ من ٣ متاحة': '3 of 3 available', 'أضيفي يومية': 'Add a story',
    'شاهد، تابع، وشارك': 'Watch, follow, and share', 'مساحة للمقاطع والقنوات ومنشئي المحتوى.': 'A home for videos, channels, and creators.', 'قنوات قد تعجبك': 'Channels you may like', 'مرتبة حسب عدد المشتركين.': 'Sorted by subscriber count.', 'ترتيب القنوات': 'Sort channels', '٢٨٥ ألف مشترك': '285K subscribers', '١٢٤ ألف مشترك': '124K subscribers', '٩٨ ألف مشترك': '98K subscribers', 'وصفات': 'Recipes',
    'تواصل قريب': 'Stay connected', 'رسائلك': 'Your messages', 'حديثك يبقى في مكان واحد.': 'Keep your conversations in one place.', 'ابحثي عن شخص أو محادثة': 'Search people or conversations', 'الخاصة': 'Direct', 'الغرباء': 'Requests', 'المثبتة': 'Pinned', 'أرسلت لك صورة 🌊': 'Sent you a photo 🌊', 'تمام، أرسلها لك بعد قليل': 'Sure, I’ll send it in a moment', 'شكرًا يا جميلة 💜': 'Thank you, lovely 💜', 'عمر: نشوفكم الجمعة؟': 'Omar: See you Friday?', 'آخر ظهور منذ قليل': 'Last seen recently', 'من حساب لا تعرفينه': 'From someone you don’t know', 'مساعدة وإرشادات الحساب': 'Account help and guidance', 'اختاري محادثة': 'Choose a conversation', 'ابدئي حديثًا لطيفًا مع أحد أصدقائك.': 'Start a friendly conversation with someone you know.', 'ابدئي محادثة': 'Start a conversation', 'متصلة الآن': 'Online now', 'اليوم': 'Today', 'الآن': 'Now', 'أمس': 'Yesterday', 'الثلاثاء': 'Tuesday', 'الأحد': 'Sunday', 'دائمًا': 'Always',
    'دائرتك تكبر': 'Find your people', 'ابحثي عن الأشخاص باسم المستخدم فقط.': 'Find people by username.', 'ابحثي باسم المستخدم مثل @mariam.k': 'Search by username, e.g. @mariam.k', 'اقتراحات لك': 'Suggestions for you', 'صديقتان مشتركتان': '2 mutual friends', 'من مجتمع القراءة': 'From the reading community', 'صديقة من الجامعة': 'A friend from university', 'مهتم بالطبخ والتصوير': 'Interested in cooking and photography', '٤ أصدقاء مشتركون': '4 mutual friends', 'تحب السفر والفن': 'Loves travel and art',
    'مساحة ChatWave': 'ChatWave space', '١٢٨': '128', '٤٢': '42', '٣': '3', '٤٢ منشورًا': '42 posts', '٣ فيديوهات': '3 videos', 'حسابك تحت سيطرتك': 'Your account, your choice', 'إدارة الحساب والخصوصية والأمان.': 'Manage your account, privacy, and safety.', 'البيانات والنسخ الاحتياطي': 'Data & backups', 'الأمان والجلسات': 'Security & sessions', 'إدارة الحساب': 'Account management', 'حذف الحساب': 'Delete account', 'تعطيل مؤقت': 'Temporarily deactivate',
    'شاركيه مع أصدقائك أو اجعليه عامًا.': 'Share with friends or make it public.', 'الظهور لـ': 'Audience', 'نشر': 'Post', 'النشر والمرفقات تجريبية وتظهر في هذه الجلسة فقط.': 'Posting and attachments are preview-only in this session.', 'كيف تشعرين اليوم؟': 'How are you feeling today?', 'اختاري رمزًا وأضيفيه إلى منشورك: 😊  💛  🌷  🎉  ☕': 'Choose an emoji to add to your post: 😊  💛  🌷  🎉  ☕',
    'مشكلة في الحساب أو تسجيل الدخول': 'Account or sign-in issue', 'إساءة أو محتوى مخالف': 'Abuse or policy-violating content', 'خصوصية أو أمان': 'Privacy or safety', 'رسالة أو مجموعة': 'Message or group', 'مشكلة تقنية أو رفع ملف': 'Technical issue or upload problem', 'شكوى أو اقتراح آخر': 'Other complaint or suggestion', 'خاص': 'Private', 'عام': 'Public', 'إعدادات خصوصية إضافية مفعّلة لهذا الملف التجريبي.': 'Additional privacy protections are enabled for this preview profile.', 'تاريخ الميلاد مخفي عن الآخرين.': 'Your date of birth is hidden from others.', 'المقطع التالي': 'Next clip', 'يوميتك': 'Your story',
    'وصلتني صور البحر، المكان يجنن! 💙': 'I got the sea photos, the place looks amazing! 💙', 'كان الجو رائعًا فعلًا، نروح سوا المرة الجاية؟': 'The weather really was lovely. Shall we go together next time?', 'أكيد! خلينا نرتب لها قريبًا ✨': 'Absolutely! Let’s plan it soon ✨', 'تمام، أرسلها لك بعد قليل 🍋': 'Sure, I’ll send it in a moment 🍋', 'أهلًا مريم! سعيدة بالتواصل معك 🌷': 'Hi Mariam! Lovely to connect with you 🌷', 'أهلًا! كيف أخبارك؟': 'Hi! How are you?', 'مساعدة وإرشادات الحساب': 'Account help and guidance',
    'تعديل الملف الشخصي': 'Edit profile', 'سيتيح الإصدار الفعلي تغيير الاسم والصورة والنبذة وقائمة الأصدقاء.': 'The full service will let you update your name, photo, bio, and friends list.', 'تغيير رقم الهاتف': 'Change phone number', 'يتطلب ذلك إعادة التحقق من الرقم القديم والجديد برسائل SMS عند توصيل خدمة الحسابات.': 'This will require verifying the old and new numbers by SMS when account services are connected.', 'تغيير كلمة المرور': 'Change password', 'الأجهزة المتصلة': 'Connected devices', 'طلب نسخة بياناتك': 'Request a copy of your data', 'تعطيل مؤقت': 'Temporarily deactivate', 'حذف الحساب': 'Delete account',
    'كل المنشورات': 'All posts', 'الأصدقاء والعامة': 'Friends & public', 'مشاركة المنشور': 'Share post', 'أُضيف المنشور إلى هذه الجلسة التجريبية.': 'Post added to this preview session.', 'أُضيف الريل إلى معاينة الفيديوهات.': 'Reel added to the video preview.', 'أُنشئت قناتك في المعاينة المحلية.': 'Your channel was created in the local preview.',
    'ChatWave — تواصل يقرّبك': 'ChatWave — closer conversations', 'لحظاتك.': 'Your moments.', 'أصدقاؤك.': 'Your friends.', 'مجتمعك يبدأ هنا': 'Your community starts here', 'معاينة تصميم ChatWave — لا تستخدم كلمة مرور حقيقية هنا.': 'ChatWave design preview — do not use a real password here.', 'إذا كان العمر دون الحد المسموح في بلدك، سنعرض مسار حماية ولي الأمر. الموافقة الفعلية تتطلب تحققًا آمنًا غير متصل في هذه المعاينة.': 'If you are below the age allowed in your country, we will show a guardian safety pathway. Real consent needs secure verification, which is not available in this preview.', 'الملفات المشتركة': 'Shared files', 'مساحة تجمعنا': 'A place to connect',
    'إعجابًا': 'likes', 'تعليقًا': 'comments', 'تفاعلًا': 'reactions', 'منشورات الأصدقاء والعامة': 'Posts from friends and public accounts', 'رحلة وصورة': 'Travel & Frames', 'عالم المعرفة': 'Knowledge World', 'سفر': 'Travel', 'تقنية': 'Technology', 'دقيقة إلى دقيقة ونصف': 'One minute to one and a half minutes', 'اسحبي للأعلى للانتقال للمقطع التالي.': 'Scroll down or use the arrow to watch the next clip.', 'رحلة في ٨٢ ثانية': 'A trip in 82 seconds', 'غروب على كورنيش طرابلس… خذي نفسًا عميقًا 🌅': 'Sunset on Tripoli’s waterfront… take a deep breath 🌅', 'وصفة في ٦٨ ثانية': 'A recipe in 68 seconds', 'معكرونة الليمون والريحان، بثلاث خطوات 🍝': 'Lemon and basil pasta in three steps 🍝', 'دقيقة للهدوء': 'A quiet minute', 'ثلاثة كتب رجعت لها أكثر من مرة 📖': 'Three books I have returned to more than once 📖',
    'تواصل قريب': 'Stay connected', 'حديثك يبقى في مكان واحد.': 'Keep your conversations in one place.', 'قناة مطبخ البيت': 'Home Kitchen channel', 'وصفة جديدة: خبز بالزعتر': 'New recipe: za’atar bread', 'طلب رسالة جديد': 'New message request', 'خيارات المحادثة': 'Conversation options', 'البحث في المحادثات': 'Search conversations', 'إضافة رمز تعبيري': 'Add emoji', 'إرسال ملف': 'Send a file', 'ابدئي حديثًا لطيفًا مع أحد أصدقائك.': 'Start a friendly conversation with a friend.',
    'ابحثي عن الأشخاص باسم المستخدم فقط.': 'Find people by username.', 'منشورات مريم': 'Mariam’s posts', 'مرئية للأصدقاء': 'Visible to friends', 'حسابك تحت سيطرتك': 'Your account, your choice', 'معلومات الحساب': 'Account information', 'رقم الهاتف هو وسيلة الدخول واستعادة الحساب.': 'Your phone number is used to sign in and recover your account.', 'الاسم والصورة والنبذة': 'Name, photo, and bio', 'تحكمي بمن يستطيع رؤية ملفك ومنشوراتك.': 'Choose who can see your profile and posts.', 'حساب خاص': 'Private account', 'يرى منشوراتك الأصدقاء الذين وافقتِ عليهم فقط.': 'Only friends you approve can see your posts.', 'اختيار تجريبي للواجهة؛ تطبيق الصلاحيات يحتاج إلى الخادم.': 'Preview setting only; permissions must be enforced by the server.', 'راجعي طريقة استخدام البيانات وحقوقك وقواعد المجتمع.': 'Review how data is used, your rights, and community rules.', 'احتفظي بنسخة من محادثاتك أو اطلبي بيانات حسابك.': 'Save a copy of your chats or request your account data.', 'تنزيل نسخة محادثات': 'Download chat backup', 'طلب نسخة بياناتي': 'Request my data', 'تنزيل النسخ الاحتياطية الفعلية والمشفرة يتطلب ربط التخزين الآمن.': 'Secure storage must be connected for real encrypted backups.', 'أدوات إدارة الجلسات وتغيير كلمة المرور.': 'Tools for managing sessions and changing your password.', 'رمز SMS وكلمات المرور وإدارة الجلسات غير متصلة بخدمة حقيقية في النموذج.': 'SMS, passwords, and session management are not connected to a live service in this prototype.', 'يمكنك تعطيل الحساب مؤقتًا أو طلب حذفه نهائيًا.': 'You can temporarily deactivate your account or request permanent deletion.', 'في الخدمة الحقيقية، يمر الحذف بفترة تأكيد ويزيل البيانات وفق سياسة الاحتفاظ.': 'In the live service, deletion will include a confirmation period and follow the retention policy.', 'أرسلي شكوى أو اطلبي مساعدة من فريق ChatWave.': 'Send a complaint or ask the ChatWave team for help.', 'فتح مركز الدعم': 'Open support center',
    'أرسلي شكوى أو بلاغًا عن مشكلة في ChatWave.': 'Send a complaint or report a problem with ChatWave.', 'اختاري موضوعًا واكتبي التفاصيل. في الخدمة الفعلية يصل البلاغ إلى صندوق خاص بحساب مالك المنصة بصلاحية إدارية، ويمكن الرد عليك عبر رسائل ChatWave.': 'Choose a topic and describe the issue. In the live service, reports will go to a restricted owner support inbox, with replies available through ChatWave messages.', 'نوع البلاغ': 'Report type', 'اختاري نوع المشكلة': 'Choose an issue type', 'اشرحي ما حدث': 'Tell us what happened', 'أضيفي التفاصيل التي تساعدنا على فهم المشكلة…': 'Add details to help us understand the issue…', 'إرفاق لقطة شاشة أو مستند': 'Attach a screenshot or document', 'PNG أو JPG أو PDF، حتى ١٠ ميغابايت': 'PNG, JPG, or PDF, up to 10 MB', 'أوافق على مشاركة بيانات حسابي اللازمة لمتابعة هذا البلاغ.': 'I agree to share the account details needed to follow up on this report.', 'هذه معاينة: لا يُرسل البلاغ الآن ولا يُخزّن. لا ترفقي معلومات شديدة الحساسية.': 'Preview only: reports are not sent or stored. Do not attach highly sensitive information.',
    'شاركيه مع أصدقائك أو اجعليه عامًا.': 'Share with friends or make it public.', 'صورة JPG أو PNG أو WebP حتى ٢٠ ميغابايت · فيديو MP4 أو MOV حتى ١٠٠ ميغابايت · مستند PDF أو Office أو TXT أو CSV حتى ٢٥ ميغابايت': 'JPG, PNG, or WebP up to 20 MB · MP4 or MOV video up to 100 MB · PDF, Office, TXT, or CSV document up to 25 MB', 'صورة أو فيديو': 'Photo or video', 'مستند': 'Document', 'شعور': 'Feeling', 'النشر والمرفقات تجريبية وتظهر في هذه الجلسة فقط.': 'Posts and attachments are preview-only and appear in this session.', 'اليومية متاحة لمدة ٢٤ ساعة': 'Stories are available for 24 hours', 'لحظة جديدة من يومك ✨': 'A new moment from your day ✨', 'شاركت لحظة جميلة مع ChatWave ✨': 'Shared a lovely moment on ChatWave ✨',
    'أكملي معلوماتك الأساسية. سنستخدم تاريخ الميلاد لتطبيق وسائل الحماية المناسبة.': 'Add your basic details. Your date of birth helps us apply appropriate safeguards.', 'اسمك': 'Your name', 'إضافة صورة': 'Add a photo', 'أضيفي صورة ونبذة ومعرّفًا فريدًا لتسهيل العثور عليك.': 'Add a photo, bio, and unique username so people can find you.', '٣–٢٤ حرفًا لاتينيًا أو رقمًا أو نقطة أو شرطة سفلية.': '3–24 characters: letters, numbers, periods, or underscores.', 'ما الذي تحبين مشاركته؟': 'What would you like to share?', 'اختاري اهتماماتك وبعض الحسابات المقترحة. يمكنك تغيير هذه الاختيارات لاحقًا.': 'Choose interests and suggested accounts. You can change these choices later.', 'حسابات قد تعجبك': 'Accounts you may like', 'ما المحتوى الذي تفضلينه؟': 'What content do you like?', 'الاقتراحات والاهتمامات محفوظة محليًا في المعاينة فقط.': 'Suggestions and interests are saved locally in this preview only.',
    'أنشئي قناتك': 'Create your channel', 'اختاري اسمًا ومعرّفًا ليجدك المشاهدون.': 'Choose a name and handle so viewers can find you.', 'اسم القناة': 'Channel name', 'المجال': 'Category', 'منوعات': 'Lifestyle', 'تعليم': 'Education', 'فن وترفيه': 'Arts & entertainment', 'إنشاء القناة معاينة محلية فقط.': 'Channel creation is local preview only.', 'قريبًا في ChatWave': 'Coming soon to ChatWave', 'هذه الواجهة استعراضية في النسخة الأولية.': 'This is a preview interface.', 'حسنًا': 'OK',
    'أمريكا الشمالية': 'North America', 'أوروبا': 'Europe', 'الشرق الأوسط وأفريقيا': 'Middle East & Africa', 'آسيا والمحيط الهادئ': 'Asia Pacific', 'Language': 'Language', 'Español — coming soon': 'Español — قريبًا', 'Français — coming soon': 'Français — قريبًا', 'Deutsch — coming soon': 'Deutsch — قريبًا', 'Türkçe — coming soon': 'Türkçe — قريبًا', '中文 — coming soon': '中文 — قريبًا', 'हिन्दी — coming soon': 'हिन्दी — قريبًا', 'Português — coming soon': 'Português — قريبًا', 'Русский — coming soon': 'Русский — قريبًا', '日本語 — coming soon': '日本語 — قريبًا', 'Bahasa Indonesia — coming soon': 'Bahasa Indonesia — قريبًا',
    'موجة تجمعنا': 'A wave that brings us together', 'في مكان واحد.': 'All in one place.', '٣ من ٣ متاحة': '3 of 3 available', '🍋 وصفة اليوم': '🍋 Today’s recipe', '✦ لحظة ملهمة': '✦ A little inspiration', '٩٨ ألف مشترك': '98K subscribers', 'إدارة الحساب والخصوصية والأمان.': 'Manage account, privacy, and safety.',
    'مرئية للأصدقاء': 'Visible to friends', '١٢٨': '128', '١٨': '18', '٣١': '31', '٢٤': '24', '١٢٫٤ ألف': '12.4K', '١٢:٤٦': '12:46', '١١:١٨': '11:18', '١٠:٠٥': '10:05', '٠:٥٨': '0:58', '١:٢٢': '1:22', '١:٠٨': '1:08', '١:٢٦': '1:26',
    'الريلز': 'Reels', 'دقيقة إلى دقيقة ونصف': 'One minute to one and a half minutes', '@home.cooks · وصفات': '@home.cooks · Recipes', '@world.frames · سفر': '@world.frames · Travel', '@know.wave · تقنية': '@know.wave · Technology', '٢٨٥ ألف مشترك': '285K subscribers', '١٢٤ ألف مشترك': '124K subscribers',
    'منشور جديد': 'New post', 'الأصدقاء والعامة': 'Friends & public', 'الكل': 'All', 'العامة': 'Public', 'ليلى الحداد': 'Layla Al-Haddad', 'منذ ١٥ دقيقة': '15 minutes ago', 'صباح البحر له حكاية ثانية 🌊 يوم هادئ، وشمس لطيفة، وقهوة ما تنوصف.': 'The sea has its own story in the morning 🌊 A quiet day, soft sunshine, and unforgettable coffee.', 'على مهل… كل شيء أجمل': 'Take your time… everything is lovelier',
    'يوسف علي': 'Yousef Ali', 'وصفة سريعة لليوم: معكرونة بالليمون والريحان 🍋 تحفظونها للعشاء؟': 'A quick recipe for today: lemon and basil pasta 🍋 Saving it for dinner?', 'مطبخ البيت': 'Home Kitchen', 'وصفة في دقيقة': 'A recipe in a minute', 'سارة منصور': 'Sarah Mansour', 'منذ ٣ ساعات': '3 hours ago', 'تذكير صغير: خذي استراحة، اشربي ماء، واحتفلي بالأشياء البسيطة التي أنجزتها اليوم. 🌷': 'A little reminder: take a break, drink water, and celebrate the small things you did today. 🌷',
    'لحظات عابرة': 'Little moments', 'صور ومقاطع يشاركها أصدقاؤك لمدة محدودة.': 'Photos and clips shared by friends for a limited time.', 'أرشيف اليوميات': 'Story archive', 'يومية جديدة': 'New story', 'يوميات الأصدقاء': 'Friends’ stories', 'تنتهي بعد ٢٤ ساعة · حتى ٣ يوميات لك أسبوعيًا': 'Stories expire after 24 hours · Up to 3 each week', 'عرض الكل': 'View all', 'أضيفي يومية': 'Add a story', 'أرشيف يومياتك': 'Your story archive', 'اليوميات التي حفظتِها تبقى خاصة بك.': 'Stories you save remain private to you.', 'احفظي يومية من شاشة العرض لتظهر هنا.': 'Save a story from its viewer to see it here.',
    'شاهد، تابع، وشارك': 'Watch, follow, and share', 'مساحة للمقاطع والقنوات ومنشئي المحتوى.': 'A home for videos, channels, and creators.', 'رفع فيديو': 'Upload video', 'قنوات قد تعجبك': 'Channels you may like', 'مرتبة حسب عدد المشتركين.': 'Sorted by subscriber count.', 'إنشاء قناة': 'Create channel', 'اكتشفي القنوات': 'Discover channels', 'ترتيب القنوات': 'Sort channels', 'الأكثر اشتراكًا': 'Most subscribers', 'رحلة وصورة': 'Travel & Frames', 'عالم المعرفة': 'Knowledge World', 'أعلى الفيديوهات': 'Top videos', 'الترتيب': 'Sort by', 'الأكثر إعجابًا': 'Most liked', 'الأكثر تعليقًا': 'Most commented', 'لقطات سريعة': 'Quick moments', 'ريلز ChatWave': 'ChatWave Reels', 'اسحبي للأعلى للانتقال للمقطع التالي.': 'Scroll down or use the arrow to watch the next clip.', 'من ٦٠ إلى ٩٠ ثانية': 'One to one and a half minutes', 'إنشاء ريل': 'Create a Reel',
    'رحلة في ٨٢ ثانية': 'A trip in 82 seconds', 'نور إبراهيم': 'Noor Ibrahim', 'غروب على كورنيش طرابلس… خذي نفسًا عميقًا 🌅': 'Sunset on Tripoli’s waterfront… take a deep breath 🌅', '٨٢٠': '820', 'وصفة في ٦٨ ثانية': 'A recipe in 68 seconds', 'معكرونة الليمون والريحان، بثلاث خطوات 🍝': 'Lemon and basil pasta in three steps 🍝', '٨٦٠': '860', 'دقيقة للهدوء': 'A quiet minute', 'ثلاثة كتب رجعت لها أكثر من مرة 📖': 'Three books I have returned to more than once 📖', '٦٠٤': '604',
    'حديثك يبقى في مكان واحد.': 'Keep your conversations in one place.', 'رسالة جديدة': 'New message', 'الخاصة': 'Direct', 'الجروبات': 'Groups', 'القنوات': 'Channels', 'غير مقروءة': 'Unread', 'جهات الاتصال': 'Contacts', 'الغرباء': 'Requests', 'البوتات': 'Bots', 'المثبتة': 'Pinned', 'أرسلت لك صورة 🌊': 'Sent you a photo 🌊', 'تمام، أرسلها لك بعد قليل': 'Sure, I’ll send it in a moment', 'شكرًا يا جميلة 💜': 'Thank you, lovely 💜', 'أمس': 'Yesterday', 'مجموعة الأصدقاء': 'Friends group', 'عمر: نشوفكم الجمعة؟': 'Omar: See you Friday?', 'الثلاثاء': 'Tuesday', 'قناة مطبخ البيت': 'Home Kitchen channel', 'وصفة جديدة: خبز بالزعتر': 'New recipe: za’atar bread', 'عمر ناصر': 'Omar Nasser', 'آخر ظهور منذ قليل': 'Last seen recently', 'الأحد': 'Sunday', 'طلب رسالة جديد': 'New message request', 'من حساب لا تعرفينه': 'From someone you don’t know', 'مساعد ChatWave': 'ChatWave assistant', 'مساعدة وإرشادات الحساب': 'Account help and guidance', 'دائمًا': 'Always', 'اختاري محادثة': 'Choose a conversation', 'ابدئي حديثًا لطيفًا مع أحد أصدقائك.': 'Start a friendly conversation with someone you know.', 'ابدئي محادثة': 'Start a conversation', 'متصلة الآن': 'Online now',
    'دائرتك تكبر': 'Find your people', 'ابحثي عن الأشخاص باسم المستخدم فقط.': 'Find people by username.', 'اقتراحات لك': 'Suggestions for you', 'مساحة ChatWave': 'ChatWave space', 'أحب التفاصيل الصغيرة، والكتب، وكل صباح يبدأ بقهوة ☕': 'I love little details, books, and mornings that start with coffee ☕', 'صديقًا': 'friends', 'منشورًا': 'posts', 'فيديوهات': 'videos', 'منشورات مريم': 'Mariam’s posts', 'مساحتك تبدأ من هنا': 'Your space starts here', 'شاركي أول لحظة مع أصدقائك من الصفحة الرئيسية.': 'Share your first moment with friends from the home page.', 'إنشاء منشور': 'Create a post',
    'معلومات الحساب': 'Account information', 'رقم الهاتف هو وسيلة الدخول واستعادة الحساب.': 'Your phone number is used to sign in and recover your account.', 'الاسم والصورة والنبذة': 'Name, photo, and bio', 'الخصوصية': 'Privacy', 'تحكمي بمن يستطيع رؤية ملفك ومنشوراتك.': 'Choose who can see your profile and posts.', 'حساب خاص': 'Private account', 'يرى منشوراتك الأصدقاء الذين وافقتِ عليهم فقط.': 'Only friends you approve can see your posts.', 'اختيار تجريبي للواجهة؛ تطبيق الصلاحيات يحتاج إلى الخادم.': 'Preview setting only; permissions must be enforced by the server.', 'اختاري لغة الواجهة واتجاه الكتابة.': 'Choose interface language and writing direction.', 'تتوفر الإنجليزية والعربية الآن؛ تظهر بقية اللغات عند اكتمال ترجمتها ومراجعتها.': 'English and Arabic are available now. More languages will appear after translation and review.', 'راجعي طريقة استخدام البيانات وحقوقك وقواعد المجتمع.': 'Review how data is used, your rights, and community rules.', 'حماية القاصرين': 'Youth safety', 'احتفظي بنسخة من محادثاتك أو اطلبي بيانات حسابك.': 'Save a copy of your chats or request your account data.', 'تنزيل نسخة محادثات': 'Download chat backup', 'طلب نسخة بياناتي': 'Request my data', 'تنزيل النسخ الاحتياطية الفعلية والمشفرة يتطلب ربط التخزين الآمن.': 'Secure storage must be connected for real encrypted backups.', 'أدوات إدارة الجلسات وتغيير كلمة المرور.': 'Tools to manage sessions and change your password.', 'رمز SMS وكلمات المرور وإدارة الجلسات غير متصلة بخدمة حقيقية في النموذج.': 'SMS, passwords, and session management are not connected to a live service in this prototype.', 'يمكنك تعطيل الحساب مؤقتًا أو طلب حذفه نهائيًا.': 'You can temporarily deactivate your account or request permanent deletion.', 'في الخدمة الحقيقية، يمر الحذف بفترة تأكيد ويزيل البيانات وفق سياسة الاحتفاظ.': 'In the live service, deletion will include a confirmation period and follow the retention policy.', 'أرسلي شكوى أو اطلبي مساعدة من فريق ChatWave.': 'Send a complaint or ask the ChatWave team for help.', 'فتح مركز الدعم': 'Open support center',
    'نسمعك': 'We’re listening', 'أرسلي شكوى أو بلاغًا عن مشكلة في ChatWave.': 'Send a complaint or report a problem with ChatWave.', 'كيف نقدر نساعدك؟': 'How can we help?', 'اختاري موضوعًا واكتبي التفاصيل. في الخدمة الفعلية يصل البلاغ إلى صندوق خاص بحساب مالك المنصة بصلاحية إدارية، ويمكن الرد عليك عبر رسائل ChatWave.': 'Choose a topic and describe the issue. In the live service, reports go to a restricted support inbox, with replies through ChatWave messages.', 'نوع البلاغ': 'Report type', 'اختاري نوع المشكلة': 'Choose an issue type', 'اشرحي ما حدث': 'Tell us what happened', 'إرفاق لقطة شاشة أو مستند': 'Attach a screenshot or document', 'PNG أو JPG أو PDF، حتى ١٠ ميغابايت': 'PNG, JPG, or PDF, up to 10 MB', 'أوافق على مشاركة بيانات حسابي اللازمة لمتابعة هذا البلاغ.': 'I agree to share the account details needed to follow up on this report.', 'إرسال البلاغ': 'Submit report', 'هذه معاينة: لا يُرسل البلاغ الآن ولا يُخزّن. لا ترفقي معلومات شديدة الحساسية.': 'Preview only: reports are not sent or stored. Do not attach highly sensitive information.',
    'صورة JPG أو PNG أو WebP حتى ٢٠ ميغابايت · فيديو MP4 أو MOV حتى ١٠٠ ميغابايت · مستند PDF أو Office أو TXT أو CSV حتى ٢٥ ميغابايت': 'JPG, PNG, or WebP up to 20 MB · MP4 or MOV video up to 100 MB · PDF, Office, TXT, or CSV document up to 25 MB', 'صورة أو فيديو': 'Photo or video', 'مستند': 'Document', 'شعور': 'Feeling', 'نشر': 'Post', 'النشر والمرفقات تجريبية وتظهر في هذه الجلسة فقط.': 'Posting and attachments are preview-only in this session.', 'اليومية متاحة لمدة ٢٤ ساعة': 'Stories are available for 24 hours', 'حفظ في الأرشيف': 'Save to archive',
    'تعديل الملف الشخصي': 'Edit profile', 'حدّثي الاسم والصورة والنبذة واسم المستخدم.': 'Update your name, photo, bio, and username.', 'تغيير صورة الملف': 'Change profile photo', 'حفظ التغييرات': 'Save changes', 'إنشاء قناة معاينة محلية فقط.': 'Channel creation is local preview only.', 'اختاري اسمًا ومعرّفًا ليجدك المشاهدون.': 'Choose a name and handle so viewers can find you.', 'مثال: يوميات سفر': 'e.g. Travel diary', 'فن وترفيه': 'Arts & entertainment', 'هذه الواجهة استعراضية في النسخة الأولية.': 'This is an early interface preview.',
    'العربية': 'Arabic', 'ل': 'L', 'لي': 'LA', 'ي': 'Y', 'س': 'S', 'م': 'M', 'ع': 'O', 'ن': 'N', 'ط': 'H', 'ر': 'W', 'أ': 'A', '؟': '?',
    '✈ رحلة ومكان': '✈ Travel & places', '١٢ تعليقًا': '12 comments', '٦ تعليقات': '6 comments', '٩ تعليقات': '9 comments', '٠ محفوظة': '0 saved', 'الشروط والخصوصية': 'Terms & privacy', 'تغيير': 'Change', 'سيكون الحساب خاصًا، والرسائل للأصدقاء فقط. قد يتطلب بلدك موافقة ولي أمر موثقة قبل إنشاء حساب حقيقي؛ لا يمكن إتمام هذا التحقق داخل النموذج.': 'This account will be private, with messages limited to friends. Your country may require verified guardian consent before a real account can be created; this preview cannot complete that verification.', 'طبخ': 'Cooking', 'إنشاء القناة': 'Create channel',
  };
  const nodeOriginals = new WeakMap();
  const attrOriginals = new WeakMap();
  const translatePage = (locale) => {
    currentLocale = locale === 'ar' ? 'ar' : 'en';
    updateCountryOptions();
    try { localStorage.setItem('chatwave-language', currentLocale); } catch { /* Preview can run without storage. */ }
    document.documentElement.lang = currentLocale;
    document.documentElement.dir = currentLocale === 'ar' ? 'rtl' : 'ltr';
    document.title = currentLocale === 'ar' ? 'ChatWave — تواصل يقرّبك' : 'ChatWave — closer conversations';
    const description = $('meta[name="description"]');
    if (description) description.content = currentLocale === 'ar' ? 'ChatWave — مساحة واحدة للتواصل ومشاركة اللحظات.' : 'ChatWave — one place to share and connect.';
    document.body.classList.toggle('locale-ar', currentLocale === 'ar');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const reverseCopy = Object.fromEntries(Object.entries(copy).map(([ar, en]) => [en, ar]));
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[data-user-content]')) continue;
      if (!nodeOriginals.has(node)) nodeOriginals.set(node, node.nodeValue);
      const original = nodeOriginals.get(node);
      const key = original.trim();
      if (!key) continue;
      const translated = currentLocale === 'ar' ? (reverseCopy[key] || key) : (copy[key] || key);
      node.nodeValue = original.replace(key, translated);
      if (currentLocale === 'en') node.nodeValue = digitsToLatin(node.nodeValue);
    }
    const attributeMap = {
      'aria-label': { 'الإشعارات': 'Notifications', 'بحث': 'Search', 'إخفاء أسماء الأقسام': 'Collapse navigation', 'إظهار أسماء الأقسام': 'Expand navigation', 'إغلاق': 'Close', 'معاينة صورة الملف الشخصي': 'Profile photo preview', 'نص المنشور': 'Post text', 'رمز التحقق': 'Verification code' },
      title: { 'الإشعارات': 'Notifications', 'إخفاء أسماء الأقسام': 'Collapse navigation', 'إظهار أسماء الأقسام': 'Expand navigation' },
      placeholder: { 'ابحث عن أشخاص أو منشورات': 'Search people and creators', 'اكتبي شيئًا جميلًا…': 'Share something…', 'اكتبي تعليقًا…': 'Write a comment…', 'اكتبي رسالة…': 'Write a message…', 'ما الذي تحبين مشاركته؟': 'What would you like to share?', 'اسمك': 'Your name', '١٢ حرفًا على الأقل': 'At least 12 characters', 'أضيفي التفاصيل التي تساعدنا على فهم المشكلة…': 'Add details to help us understand the issue…', 'اختاري البلد أو المنطقة': 'Choose your country or region', 'اختاري البلد': 'Choose your country', 'اختاري أو اكتبي بلدك': 'Choose or type your country', 'اختاري بلد الإقامة': 'Choose your country of residence', 'اكتبي أو اختاري بلدك': 'Type or choose your country', 'مثال: يوميات سفر': 'e.g. Travel diary', 'اكتبي وصفًا قصيرًا للريل…': 'Add a short Reel caption…', 'اكتبي وصف الفيديو…': 'Add a video description…' },
      alt: { 'معاينة صورة الملف الشخصي': 'Profile photo preview' },
    };
    const reverseAttributes = Object.fromEntries(Object.entries(attributeMap).map(([attribute, values]) => [attribute, Object.fromEntries(Object.entries(values).map(([ar, en]) => [en, ar]))]));
    $$('[aria-label], [title], [placeholder], [alt]').forEach((element) => {
      ['aria-label', 'title', 'placeholder', 'alt'].forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        let saved = attrOriginals.get(element);
        if (!saved) { saved = {}; attrOriginals.set(element, saved); }
        if (!(attribute in saved)) saved[attribute] = element.getAttribute(attribute);
        const original = saved[attribute];
        element.setAttribute(attribute, currentLocale === 'ar' ? (reverseAttributes[attribute]?.[original] || original) : (attributeMap[attribute]?.[original] || original));
      });
    });
    const langSwitch = $('#language-choice');
    const authSwitch = $('#auth-language-choice');
    if (langSwitch) langSwitch.value = currentLocale;
    if (authSwitch) authSwitch.value = currentLocale;
    $$('[data-en-href][data-ar-href]').forEach((link) => { link.href = currentLocale === 'ar' ? link.dataset.arHref : link.dataset.enHref; });
    $$('[data-locale-en][data-locale-ar]').forEach((node) => {
      const translated = currentLocale === 'ar' ? node.dataset.localeAr : node.dataset.localeEn;
      if (node.textContent !== translated) node.textContent = translated;
    });
    $$('[data-placeholder-en][data-placeholder-ar]').forEach((node) => { node.placeholder = currentLocale === 'ar' ? node.dataset.placeholderAr : node.dataset.placeholderEn; });
    const groupCreateButton = $('.group-create-action');
    if (groupCreateButton) {
      const groupCreateMarkup = `<span aria-hidden="true">＋</span> ${txt('جروب جديد', 'New group')}`;
      if (groupCreateButton.innerHTML !== groupCreateMarkup) groupCreateButton.innerHTML = groupCreateMarkup;
    }
    const groupSettings = $('.group-settings-action');
    if (groupSettings) groupSettings.setAttribute('aria-label', txt('إعدادات الجروب', 'Group settings'));
    const emojiHeadingLabels = [txt('وجوه', 'Faces'), txt('إيماءات', 'Gestures'), txt('قلوب', 'Hearts'), txt('حيوانات', 'Animals'), txt('طعام', 'Food'), txt('رياضة وفن', 'Sports & arts'), txt('سفر وأماكن', 'Travel & places'), txt('أدوات واحتفالات', 'Objects & celebrations'), txt('وجوه إضافية', 'More faces'), txt('أعلام', 'Flags')];
    $$('.emoji-section > strong').forEach((heading, index) => {
      if (emojiHeadingLabels[index] && heading.textContent !== emojiHeadingLabels[index]) heading.textContent = emojiHeadingLabels[index];
    });
    $$('.comment-emoji').forEach((button) => button.setAttribute('aria-label', txt('إضافة رمز تعبيري', 'Add emoji')));
    const forgotPasswordButton = $('#forgot-password');
    if (forgotPasswordButton) {
      const label = txt('نسيت كلمة المرور؟', 'Forgot password?');
      if (forgotPasswordButton.textContent !== label) forgotPasswordButton.textContent = label;
    }
    const languageLabel = $('label[for="auth-language-choice"]');
    if (languageLabel) {
      const label = currentLocale === 'ar' ? 'اللغة' : 'Language';
      if (languageLabel.textContent !== label) languageLabel.textContent = label;
    }
    const activeSort = $('[data-feed-sort].selected');
    if (activeSort && $('#feed-filter')?.firstChild) $('#feed-filter').firstChild.textContent = `${activeSort.textContent} `;
    if ($('#auth-title')) {
      const title = txt(authMode === 'register' ? 'أنشئي حسابك' : 'سجّلي الدخول', authMode === 'register' ? 'Create your account' : 'Sign in');
      if ($('#auth-title').textContent !== title) $('#auth-title').textContent = title;
    }
    if ($('#auth-mode-switch')) {
      const label = txt(authMode === 'register' ? 'تسجيل الدخول' : 'إنشاء حساب', authMode === 'register' ? 'Sign in' : 'Create account');
      if ($('#auth-mode-switch').textContent !== label) $('#auth-mode-switch').textContent = label;
    }
    if ($('#auth-form')) {
      const submit = $('.auth-submit', $('#auth-form'));
      const label = `${txt(authMode === 'register' ? 'متابعة برقم الهاتف' : 'الدخول برقم الهاتف', authMode === 'register' ? 'Continue with phone' : 'Sign in with phone')} <span>${currentLocale === 'ar' ? '←' : '→'}</span>`;
      if (submit.innerHTML !== label) submit.innerHTML = label;
    }
    if ($('#auth-switch')?.firstChild) $('#auth-switch').firstChild.textContent = txt(authMode === 'register' ? 'لديك حساب بالفعل؟ ' : 'مستخدم جديد؟ ', authMode === 'register' ? 'Already have an account? ' : 'New to ChatWave? ');
    const displayName = $('#profile-user-name')?.textContent || txt('مريم خالد', 'Mariam Khaled');
    if ($('#profile-feed-heading')) {
      const heading = currentLocale === 'ar' ? `منشورات ${displayName}` : `Posts by ${displayName}`;
      if ($('#profile-feed-heading').textContent !== heading) $('#profile-feed-heading').textContent = heading;
    }
    $$('.nav-link, .utility-link').forEach((link) => {
      const label = $('span', link)?.textContent || link.textContent.trim();
      link.setAttribute('aria-label', label);
      link.title = label;
    });
    const sidebarButton = $('#sidebar-toggle');
    if (sidebarButton) {
      const isCollapsed = appShell.classList.contains('sidebar-collapsed');
      const label = txt(isCollapsed ? 'إظهار أسماء الأقسام' : 'إخفاء أسماء الأقسام', isCollapsed ? 'Expand navigation' : 'Collapse navigation');
      sidebarButton.setAttribute('aria-label', label);
      sidebarButton.title = label;
    }
  };
  try { currentLocale = localStorage.getItem('chatwave-language') || 'en'; } catch { currentLocale = 'en'; }
  enhanceCountryInputs();
  translatePage(currentLocale);
  let translationQueued = false;
  const translationObserver = new MutationObserver((records) => {
    if (translationQueued || !records.some((record) => record.addedNodes.length)) return;
    translationQueued = true;
    queueMicrotask(() => {
      translationQueued = false;
      translatePage(currentLocale);
    });
  });
  translationObserver.observe(document.body, { childList: true, subtree: true });
  const currentStoryWeek = () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const storyUsageKey = `chatwave-story-count-${currentStoryWeek()}`;
  let weeklyStoryCount = 0;
  try { weeklyStoryCount = Number(localStorage.getItem(storyUsageKey) || 0); } catch { weeklyStoryCount = 0; }
  const escapeText = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const extensionOf = (file) => file.name.split('.').pop().toLowerCase();
  const videoExtensions = new Set(['mp4', 'mov']);
  const mediaExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', ...videoExtensions]);
  const documentExtensions = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']);
  const isVideoFile = (file) => file.type.startsWith('video/') || videoExtensions.has(extensionOf(file));
  const validateFile = (file, kind) => {
    const ext = extensionOf(file);
    const valid = kind === 'media' || kind === 'story' ? mediaExtensions.has(ext) : kind === 'report' ? new Set(['png', 'jpg', 'jpeg', 'pdf']).has(ext) : kind === 'chat' ? documentExtensions.has(ext) || mediaExtensions.has(ext) : documentExtensions.has(ext);
    const limit = ext === 'mp4' || ext === 'mov' ? 100 : kind === 'report' ? 10 : documentExtensions.has(ext) ? 25 : 20;
    if (!valid) {
      showToast('نوع الملف غير مسموح. استخدمي صورة أو فيديو أو مستندًا من الأنواع المحددة.');
      return false;
    }
    if (file.size > limit * 1024 * 1024) {
      showToast(txt(`حجم الملف يتجاوز الحد التجريبي (${arNumber.format(limit)} ميغابايت).`, `The file exceeds the preview limit of ${limit} MB.`));
      return false;
    }
    return true;
  };

  const showOnboarding = (minor = false) => {
    isMinorPreview = minor;
    onboardingStep = 1;
    $('#auth-gate').hidden = true;
    $('#app-shell').hidden = true;
    $('#onboarding-modal').hidden = false;
    $('#onboarding-name').focus();
    updateOnboardingStep();
  };
  function updateOnboardingStep() {
    $$('.onboarding-step').forEach((step) => {
      const active = Number(step.dataset.onboardingStep) === onboardingStep;
      step.hidden = !active;
      step.classList.toggle('active', active);
    });
    $$('.onboarding-progress i').forEach((dot, index) => dot.classList.toggle('active', index < onboardingStep));
    $('#onboarding-step-label').textContent = txt(`الخطوة ${arNumber.format(onboardingStep)} من ٣`, `Step ${onboardingStep} of 3`);
    $('#onboarding-back').hidden = onboardingStep === 1;
    $('#onboarding-next').hidden = onboardingStep === 3;
    $('#onboarding-finish').hidden = onboardingStep !== 3;
    $('#onboarding-title').textContent = txt('لنتعرف عليك', 'Let’s get to know you');
  }
  const finishOnboarding = async () => {
    let createdOnServer = false;
    if (backendRegistrationToken) {
      try {
        const result = await apiRequest('/api/auth/register/complete', {
          method: 'POST',
          body: JSON.stringify({
            registrationToken: backendRegistrationToken,
            displayName: $('#onboarding-name').value.trim(),
            username: $('#onboarding-username').value.trim().replace(/^@/, ''),
            bio: $('#onboarding-bio').value.trim(),
            gender: $('input[name="gender"]:checked')?.value,
            interests: $$('.interest-picker input:checked').map((input) => input.value),
          }),
        });
        backendRegistrationToken = '';
        createdOnServer = true;
        backendSessionActive = true;
        backendUserId = result.user.id;
        profilePostCount = 0;
        profileVideoCount = 0;
        $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(0) : enNumber.format(0);
        $('#profile-posts-count').textContent = currentLocale === 'ar' ? arNumber.format(0) : enNumber.format(0);
        $('#profile-videos-count').textContent = currentLocale === 'ar' ? arNumber.format(0) : enNumber.format(0);
        $('#profile-handle').textContent = `@${result.user.username}`;
      } catch (error) {
        showToast(apiErrorMessage(error.apiCode));
        return;
      }
    }
    const name = $('#onboarding-name').value.trim() || txt('مستخدم جديد', 'New user');
    const handle = $('#onboarding-username').value.trim().replace(/^@/, '');
    const bio = $('#onboarding-bio').value.trim();
    $('#profile-user-name').textContent = name;
    $('#profile-user-name').dataset.userContent = 'true';
    $('#profile-handle').textContent = handle ? `@${handle}` : '@chatwave.user';
    $('#profile-handle').dataset.userContent = 'true';
    $('#profile-bio').textContent = bio || txt('مرحبًا بكم في عالمي على ChatWave.', 'Welcome to my world on ChatWave.');
    $('#profile-bio').dataset.userContent = 'true';
    $('.mini-profile > span:last-child').textContent = name;
    $('.mini-profile > span:last-child').dataset.userContent = 'true';
    $('.mini-profile .avatar').textContent = [...name][0] || 'C';
    $('#profile-avatar').textContent = [...name][0] || 'C';
    if (profilePhotoUrl) {
      $('#profile-avatar').style.background = `center / cover no-repeat url("${profilePhotoUrl}")`;
      $('.mini-profile .avatar').style.background = `center / cover no-repeat url("${profilePhotoUrl}")`;
      $('#onboarding-photo-preview').src = profilePhotoUrl;
    }
    const birthdate = $('#onboarding-birthdate').value;
    const age = yearsOld(birthdate);
    $('#profile-age-note').hidden = false;
    $('#profile-age-note').textContent = age < 18 ? txt('إعدادات خصوصية إضافية مفعّلة لهذا الملف التجريبي.', 'Additional privacy protections are enabled for this preview profile.') : txt('تاريخ الميلاد مخفي عن الآخرين.', 'Your date of birth is hidden from others.');
    if (isMinorPreview || age < 18) {
      $('#private-account').checked = true;
      $('#private-account').disabled = true;
      $('#post-audience option[value="public"]').disabled = true;
      $('#upload-video').disabled = true;
      $('#upload-reel').disabled = true;
      document.body.classList.add('minor-preview');
    }
    const selectedFriends = $$('.friend-suggestions input:checked');
    selectedFriends.forEach((input) => addedFriends.add(input.value));
    $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(addedFriends.size) : enNumber.format(addedFriends.size);
    $('#profile-posts-count').textContent = currentLocale === 'ar' ? arNumber.format(profilePostCount) : enNumber.format(profilePostCount);
    $('#profile-videos-count').textContent = currentLocale === 'ar' ? arNumber.format(profileVideoCount) : enNumber.format(profileVideoCount);
    $('#profile-feed-heading').textContent = currentLocale === 'ar' ? `منشورات ${name}` : `Posts by ${name}`;
    $('#onboarding-modal').hidden = true;
    $('#app-shell').hidden = false;
    document.body.classList.add('signed-in-preview');
    setView('home');
    setSidebarCollapsed(true);
    translatePage(currentLocale);
    if (backendSessionActive) {
      loadServerPosts();
      await Promise.all([loadServerConversations(), loadServerChannels()]);
      renderFriends();
      await processPendingLinks();
    }
    showToast(createdOnServer ? txt('اكتمل إنشاء حسابك.', 'Your account is ready.') : txt('اكتمل إعداد ملفك التجريبي.', 'Your preview profile is ready.'));
  };
  $('#onboarding-photo-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      showToast(txt('اختاري صورة JPG أو PNG أو WebP لا تتجاوز ٨ ميغابايت.', 'Choose a JPG, PNG, or WebP image up to 8 MB.'));
      event.currentTarget.value = '';
      return;
    }
    if (profilePhotoUrl) { URL.revokeObjectURL(profilePhotoUrl); objectUrls.delete(profilePhotoUrl); }
    profilePhotoUrl = URL.createObjectURL(file);
    objectUrls.add(profilePhotoUrl);
    $('#onboarding-photo-preview').src = profilePhotoUrl;
    $('#onboarding-photo-preview').hidden = false;
    $('#onboarding-photo-placeholder').hidden = true;
  });
  $('#onboarding-birthdate').max = new Date().toISOString().slice(0, 10);
  $('#onboarding-birthdate').addEventListener('change', () => {
    const age = yearsOld($('#onboarding-birthdate').value);
    if (age < 18) isMinorPreview = true;
    $('#minor-safety-note').hidden = !(age < 18);
  });
  $('#onboarding-next').addEventListener('click', () => {
    if (onboardingStep === 1) {
      const name = $('#onboarding-name').value.trim();
      const age = yearsOld($('#onboarding-birthdate').value);
      const country = $('#onboarding-country').value;
      const gender = $('input[name="gender"]:checked');
      if (!name || !Number.isFinite(age) || !country || !gender) {
        showToast(txt('أكملي الاسم وتاريخ الميلاد والبلد والجنس للمتابعة.', 'Enter your name, date of birth, country, and gender to continue.'));
        return;
      }
      if (age < 18) {
        isMinorPreview = true;
        $('#minor-safety-note').hidden = false;
      }
    }
    if (onboardingStep === 2) {
      const username = $('#onboarding-username').value.trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9._]{3,24}$/.test(username)) {
        showToast(txt('اسم المستخدم يجب أن يكون من ٣ إلى ٢٤ حرفًا لاتينيًا أو رقمًا أو نقطة أو شرطة سفلية.', 'Username must be 3–24 characters using letters, numbers, periods, or underscores.'));
        $('#onboarding-username').focus();
        return;
      }
    }
    onboardingStep = Math.min(3, onboardingStep + 1);
    updateOnboardingStep();
  });
  $('#onboarding-back').addEventListener('click', () => { onboardingStep = Math.max(1, onboardingStep - 1); updateOnboardingStep(); });
  $('#onboarding-finish').addEventListener('click', finishOnboarding);

  $('#age-gate-birthdate').max = new Date().toISOString().slice(0, 10);
  $('#age-check-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const date = $('#age-gate-birthdate').value;
    const age = yearsOld(date);
    if (!Number.isFinite(age) || !$('#age-gate-country').value) {
      showToast(txt('أدخلي تاريخ ميلاد صحيحًا واختاري بلد الإقامة.', 'Enter a valid date of birth and choose your country.'));
      return;
    }
    $('#onboarding-birthdate').value = date;
    $('#onboarding-country').value = $('#age-gate-country').value;
    if (age < 18) {
      $('#age-check-form').hidden = true;
      $('#auth-form').hidden = true;
      $('#auth-switch').hidden = true;
      $('#minor-gate').hidden = false;
      return;
    }
    $('#age-check-form').hidden = true;
    $('#auth-form').hidden = false;
    $('#auth-switch').hidden = false;
  });
  $('#minor-preview').addEventListener('click', () => showOnboarding(true));
  $('#minor-edit-age').addEventListener('click', () => {
    $('#minor-gate').hidden = true;
    $('#age-check-form').hidden = false;
    $('#age-gate-birthdate').focus();
  });

  $('#auth-mode-switch').addEventListener('click', () => {
    authMode = authMode === 'register' ? 'login' : 'register';
    $('#auth-title').textContent = txt(authMode === 'register' ? 'أنشئي حسابك' : 'سجّلي الدخول', authMode === 'register' ? 'Create your account' : 'Sign in');
    $('.auth-submit', $('#auth-form')).innerHTML = `${txt(authMode === 'register' ? 'متابعة برقم الهاتف' : 'الدخول برقم الهاتف', authMode === 'register' ? 'Continue with phone' : 'Sign in with phone')} <span>${currentLocale === 'ar' ? '←' : '→'}</span>`;
    $('#auth-password').autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
    $('#auth-switch').firstChild.textContent = txt(authMode === 'register' ? 'لديك حساب بالفعل؟ ' : 'مستخدم جديد؟ ', authMode === 'register' ? 'Already have an account? ' : 'New to ChatWave? ');
    $('#auth-mode-switch').textContent = txt(authMode === 'register' ? 'تسجيل الدخول' : 'إنشاء حساب', authMode === 'register' ? 'Sign in' : 'Create account');
    $('#forgot-password').hidden = authMode !== 'login';
  });
  const forgotPassword = document.createElement('button');
  forgotPassword.type = 'button';
  forgotPassword.className = 'text-button forgot-password';
  forgotPassword.id = 'forgot-password';
  forgotPassword.textContent = txt('نسيت كلمة المرور؟', 'Forgot password?');
  forgotPassword.hidden = true;
  $('#auth-password').after(forgotPassword);
  forgotPassword.addEventListener('click', () => {
    let modal = $('#recovery-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'recovery-modal';
      modal.className = 'modal';
      modal.innerHTML = `<button class="modal-close" type="button" aria-label="${txt('إغلاق', 'Close')}">×</button><form class="simple-modal-content recovery-content" id="recovery-form"><span class="modal-sparkle">🔐</span><h2>${txt('استعادة الحساب', 'Recover your account')}</h2><p class="recovery-description">${txt('أرسلي رمز تحقق إلى رقم هاتف الحساب.', 'Send a verification code to your account phone number.')}</p><div id="recovery-phone-step"><label for="recovery-phone">${txt('رقم الهاتف', 'Phone number')}</label><input id="recovery-phone" type="tel" required placeholder="+218912345678"><button class="primary-button" type="submit">${txt('إرسال رمز التحقق', 'Send verification code')}</button></div><div id="recovery-reset-step" hidden><label for="recovery-code">${txt('رمز التحقق', 'Verification code')}</label><input id="recovery-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><label for="recovery-new-password">${txt('كلمة مرور جديدة', 'New password')}</label><input id="recovery-new-password" type="password" minlength="12" autocomplete="new-password" required><small class="setting-hint">${txt('١٢ حرفًا على الأقل، مع حروف وأرقام.', 'At least 12 characters, including letters and numbers.')}</small><button class="primary-button" type="submit">${txt('تحديث كلمة المرور', 'Reset password')}</button></div></form>`;
      document.body.append(modal);
      $('.modal-close', modal).addEventListener('click', () => { modal.hidden = true; recoveryChallengeId = ''; });
      modal.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
      $('#recovery-form', modal).addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!recoveryChallengeId) {
          const rawPhone = digitsToLatin($('#recovery-phone', modal).value.trim()).replace(/[\s().-]/g, '');
          if (!/^\+[1-9]\d{7,14}$/.test(rawPhone)) { showToast(txt('أدخلي الرقم بالصيغة الدولية.', 'Enter the number in international format.')); return; }
          try {
            const result = await apiRequest('/api/auth/recovery/start', { method: 'POST', body: JSON.stringify({ phone: rawPhone }) });
            recoveryChallengeId = result.challengeId;
            $('#recovery-phone-step', modal).hidden = true;
            $('#recovery-reset-step', modal).hidden = false;
            $('.recovery-description', modal).textContent = txt('أدخلي رمز الرسالة وحددي كلمة مرور جديدة.', 'Enter the code and choose a new password.');
            $('#recovery-code', modal).focus();
          } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
          return;
        }
        try {
          const verified = await apiRequest('/api/auth/recovery/verify', { method: 'POST', body: JSON.stringify({ challengeId: recoveryChallengeId, code: digitsToLatin($('#recovery-code', modal).value.trim()) }) });
          await apiRequest('/api/auth/recovery/complete', { method: 'POST', body: JSON.stringify({ recoveryToken: verified.recoveryToken, password: $('#recovery-new-password', modal).value }) });
          recoveryChallengeId = '';
          modal.hidden = true;
          $('#auth-phone').value = $('#recovery-phone', modal).value;
          $('#auth-password').value = '';
          if (authMode !== 'login') $('#auth-mode-switch').click();
          showToast(txt('تم تغيير كلمة المرور. سجّلي الدخول بها الآن.', 'Password updated. Sign in with your new password.'));
        } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      });
    }
    recoveryChallengeId = '';
    $('#recovery-phone-step', modal).hidden = false;
    $('#recovery-reset-step', modal).hidden = true;
    $('#recovery-phone', modal).value = $('#auth-phone').value;
    modal.hidden = false;
  });
  $('#toggle-password').addEventListener('click', (event) => {
    const input = $('#auth-password');
    input.type = input.type === 'password' ? 'text' : 'password';
    event.currentTarget.textContent = txt(input.type === 'password' ? 'إظهار' : 'إخفاء', input.type === 'password' ? 'Show' : 'Hide');
  });
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawPhone = digitsToLatin($('#auth-phone').value.trim());
    const phone = rawPhone.replace(/[\s().-]/g, '');
    const password = $('#auth-password').value;
    const termsAccepted = $('#auth-terms').checked;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      showToast(txt('اكتبي الرقم بالصيغة الدولية، مع رمز الدولة مثل +218912345678.', 'Enter your phone number in international format, including country code, e.g. +218912345678.'));
      $('#auth-phone').focus();
      return;
    }
    if (password.length < 12 || !/[\p{L}]/u.test(password) || !/\p{N}/u.test(password)) {
      showToast(txt('اجعلي كلمة المرور ١٢ حرفًا على الأقل، مع حروف وأرقام.', 'Use at least 12 characters, including letters and numbers.'));
      $('#auth-password').focus();
      return;
    }
    if (!termsAccepted) {
      showToast(txt('وافقي على الشروط وسياسة الخصوصية للمتابعة.', 'Accept the Terms and Privacy Policy to continue.'));
      $('#auth-terms').focus();
      return;
    }
    if (!$('#auth-age-confirm').checked) { showToast(txt('أكدي تاريخ ميلادك ومسار الحماية المناسب.', 'Confirm your date of birth and the applicable safety pathway.')); return; }
    if (backendProbe) await backendProbe;
    backendChallengeId = '';
    backendRegistrationToken = '';
    backendFlow = !previewOnly;
    if (backendFlow) {
      try {
        const endpoint = authMode === 'register' ? '/api/auth/register/start' : '/api/auth/login/start';
        const data = await apiRequest(endpoint, {
          method: 'POST',
          body: JSON.stringify(authMode === 'register'
            ? { phone, password, birthDate: $('#age-gate-birthdate').value, countryCode: $('#age-gate-country').value }
            : { phone, password }),
        });
        backendChallengeId = data.challengeId;
        $('#otp-demo-note').textContent = data.developmentCode
          ? txt(`رمز التطوير المحلي: ${data.developmentCode} — لا تستخدم هذا الوضع للإنتاج.`, `Local development code: ${data.developmentCode} — never use this mode in production.`)
          : txt('أرسلنا رمز التحقق إلى هاتفك.', 'We sent a verification code to your phone.');
      } catch (error) {
        showToast(apiErrorMessage(error.apiCode));
        return;
      }
    } else {
      $('#otp-demo-note').textContent = txt('محاكاة فقط: لا توجد خدمة رسائل متصلة. أدخلي أي ٦ أرقام للمتابعة.', 'Preview only: SMS is not connected. Enter any six digits to continue.');
    }
    $('#masked-phone').textContent = `${phone.slice(0, 4)} •••• ${phone.slice(-3)}`;
    $('#auth-form').hidden = true;
    $('#auth-switch').hidden = true;
    $('#otp-panel').hidden = false;
    $('#otp-code').focus();
  });
  $('#otp-code').addEventListener('input', (event) => {
    const converted = digitsToLatin(event.currentTarget.value).replace(/\D/g, '').slice(0, 6);
    event.currentTarget.value = converted;
    $('#enter-preview').disabled = converted.length !== 6;
  });
  $('#auth-back').addEventListener('click', () => {
    $('#otp-panel').hidden = true;
    $('#auth-form').hidden = false;
    $('#auth-switch').hidden = false;
    $('#otp-code').value = '';
    $('#enter-preview').disabled = true;
    $('#auth-phone').focus();
  });
  $('#enter-preview').addEventListener('click', () => {
    if ($('#otp-code').value.length !== 6) return;
    if (backendFlow) {
      const endpoint = authMode === 'register' ? '/api/auth/register/verify' : '/api/auth/login/verify';
      apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ challengeId: backendChallengeId, code: $('#otp-code').value }) })
        .then(async (result) => {
          $('#auth-phone').value = '';
          $('#auth-password').value = '';
          $('#otp-code').value = '';
          if (authMode === 'register') {
            backendRegistrationToken = result.registrationToken;
            showOnboarding(false);
            return;
          }
          const session = await apiRequest('/api/session');
          const user = session.user;
          const counts = session.counts || {};
          backendSessionActive = true;
          backendUserId = user.id;
          profilePostCount = Number(counts.posts || 0);
          profileVideoCount = Number(counts.videos || 0);
          $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(Number(counts.friends || 0)) : enNumber.format(Number(counts.friends || 0));
          $('#profile-posts-count').textContent = currentLocale === 'ar' ? arNumber.format(profilePostCount) : enNumber.format(profilePostCount);
          $('#profile-videos-count').textContent = currentLocale === 'ar' ? arNumber.format(profileVideoCount) : enNumber.format(profileVideoCount);
          $('#profile-user-name').textContent = user.display_name;
          $('#profile-user-name').dataset.userContent = 'true';
          $('#profile-handle').textContent = `@${user.username}`;
          $('#profile-handle').dataset.userContent = 'true';
          $('#profile-bio').textContent = user.bio || txt('مرحبًا بكم في عالمي على ChatWave.', 'Welcome to my world on ChatWave.');
          $('#profile-bio').dataset.userContent = 'true';
          $('#private-account').checked = user.visibility === 'private';
          $('#post-audience option[value="public"]').disabled = user.visibility === 'private';
          $('.mini-profile > span:last-child').textContent = user.display_name;
          $('.mini-profile > span:last-child').dataset.userContent = 'true';
          $('.mini-profile .avatar').textContent = [...user.display_name][0] || 'C';
          $('#profile-avatar').textContent = [...user.display_name][0] || 'C';
          $('#auth-gate').hidden = true;
          $('#app-shell').hidden = false;
          document.body.classList.add('signed-in-preview');
          setView('home');
          setSidebarCollapsed(true);
          translatePage(currentLocale);
          loadServerPosts();
          loadServerConversations();
          loadServerChannels();
          renderFriends();
          await processPendingLinks();
        })
        .catch((error) => showToast(apiErrorMessage(error.apiCode)));
      return;
    }
    $('#auth-password').value = '';
    $('#auth-phone').value = '';
    $('#otp-code').value = '';
    if (authMode === 'register') showOnboarding(false);
    else {
      authGate.hidden = true;
      appShell.hidden = false;
      document.body.classList.add('signed-in-preview');
      setView('home');
      setSidebarCollapsed(true);
    }
  });
  ['auth-language-choice', 'language-choice'].forEach((selector) => $(selector)?.addEventListener('change', (event) => translatePage(event.currentTarget.value)));

  const showToast = (message) => {
    const translations = {
      'نوع الملف غير مسموح. استخدمي صورة أو فيديو أو مستندًا من الأنواع المحددة.': 'This file type is not allowed. Choose one of the supported image, video, or document formats.',
      'اكتبي الرقم بالصيغة الدولية، مع رمز الدولة مثل +218912345678.': 'Enter your phone number in international format, including the country code, for example +218912345678.',
      'اجعلي كلمة المرور ١٢ حرفًا على الأقل، مع حروف وأرقام.': 'Use at least 12 characters, including letters and numbers.',
      'وافقي على الشروط وسياسة الخصوصية للمتابعة.': 'Accept the Terms of Service and Privacy Policy to continue.',
      'أكدي أن عمرك يسمح باستخدام الخدمة في بلدك.': 'Confirm you meet the age requirements for your country.',
      'أكملي الاسم وتاريخ الميلاد والبلد والجنس للمتابعة.': 'Enter your name, date of birth, country, and gender to continue.',
      'اختاري صورة JPG أو PNG أو WebP لا تتجاوز ٨ ميغابايت.': 'Choose a JPG, PNG, or WebP image up to 8 MB.',
      'وصلتِ إلى الحد الأسبوعي: ٣ يوميات.': 'You have reached the weekly limit of 3 stories.',
      'المعاينة تعرض إعداد الحساب الخاص.': 'Previewing a private account.',
      'المعاينة تعرض إعداد الحساب العام.': 'Previewing a public account.',
      'اختاري صديقًا من قائمة جهات الاتصال لبدء محادثة.': 'Choose a friend from your contacts to start a conversation.',
      'أنتِ تشاهدين أحدث يوميات أصدقائك.': 'You are viewing your friends’ latest stories.',
      'لا توجد إشعارات جديدة.': 'There are no new notifications.',
      'اختاري محادثة أولًا.': 'Choose a conversation first.',
      'اختاري محادثة قبل إرفاق ملف.': 'Choose a conversation before attaching a file.',
      'أُرفق الملف في المحادثة التجريبية فقط.': 'The file was attached to this preview conversation only.',
      'نتائج البحث في منشورات هذه الصفحة.': 'Showing search results in this page’s posts.',
      'تم عرض جميع المنشورات.': 'Showing all posts.',
      'شاهدوا هذا المنشور على ChatWave': 'See this post on ChatWave',
      'نُسخ نص المشاركة.': 'Share text copied.',
      'حُفظ المنشور في قائمتك التجريبية.': 'Post saved to your preview list.',
      'أُزيل المنشور من المحفوظات.': 'Post removed from saved items.',
      'أُضيف تعليقك لهذه الجلسة.': 'Your comment was added to this session.',
      'ارفعي ملف فيديو بصيغة MP4 أو MOV.': 'Choose an MP4 or MOV video file.',
      'مدة الريل يجب أن تكون بين ٦٠ و٩٠ ثانية.': 'A Reel must be between 60 and 90 seconds long.',
      'تعذر قراءة مدة الفيديو. اختاري ملفًا آخر.': 'Could not read the video duration. Choose another file.',
      'اكتبي شيئًا أو أضيفي صورة أو ملفًا أولًا.': 'Write something or add a photo or file first.',
      'اختاري فيديو قبل رفعه إلى القناة.': 'Choose a video before uploading it to your channel.',
      'انتظري التحقق من مدة الفيديو، ويجب أن تكون بين ٦٠ و٩٠ ثانية.': 'Wait for the video duration check. It must be between 60 and 90 seconds.',
      'يمكنك مشاركة المنشور عند ربط المنصة بالخادم.': 'Post sharing will be available when the platform service is connected.',
      'أُلغيت متابعة المنشئ.': 'Creator unfollowed.',
      'أُضيف المنشئ إلى متابعاتك.': 'Creator added to your follows.',
      'تم إلغاء متابعة القناة.': 'Channel unfollowed.',
      'أُضيفت القناة إلى متابعاتك التجريبية.': 'Channel added to your preview follows.',
      'أُنشئت قناتك في المعاينة المحلية.': 'Your channel was created in the local preview.',
      'نُزّلت نسخة محادثات المعاينة الحالية فقط.': 'Only the current preview conversations were downloaded.',
      'اختاري نوع البلاغ واكتبي تفاصيل المشكلة.': 'Choose a report category and describe the issue.',
    };
    toast.textContent = currentLocale === 'en' ? (translations[message] || copy[message] || message) : message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2700);
  };

  const openSimpleModal = (title, copy) => {
    $('#modal-title').textContent = title;
    $('#modal-copy').textContent = copy;
    $('#simple-modal').hidden = false;
    translatePage(currentLocale);
  };

  const setView = (name) => {
    const target = $(`[data-view="${name}"]`);
    if (!target) return;
    views.forEach((view) => view.classList.toggle('active', view === target));
    navLinks.forEach((link) => link.classList.toggle('active', link.classList.contains('utility-link') ? name === 'support' && link.dataset.viewLink === 'support' : link.dataset.viewLink === name && link.classList.contains('nav-link')));
    if (name === 'videos') renderVideos();
    if (name === 'friends') renderFriends();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setSidebarCollapsed = (collapsed) => {
    appShell.classList.toggle('sidebar-collapsed', collapsed);
    sidebarToggle.textContent = collapsed ? '›' : '‹';
    const label = txt(collapsed ? 'إظهار أسماء الأقسام' : 'إخفاء أسماء الأقسام', collapsed ? 'Expand navigation' : 'Collapse navigation');
    sidebarToggle.setAttribute('aria-label', label);
    sidebarToggle.title = label;
  };
  $$('.nav-link, .utility-link').forEach((link) => {
    const label = $('span', link)?.textContent || link.textContent.trim();
    link.setAttribute('aria-label', label);
    link.title = label;
  });

  navLinks.forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    setView(link.dataset.viewLink);
    setSidebarCollapsed(true);
  }));

  const modalClose = (modal) => {
    modal.hidden = true;
    if (modal?.id === 'compose-modal') {
      const selected = fileState.media || fileState.document;
      const assetId = selected?.assetId;
      if (fileState.media?.url) { URL.revokeObjectURL(fileState.media.url); objectUrls.delete(fileState.media.url); }
      fileState.media = null;
      fileState.document = null;
      mediaInput.value = '';
      documentInput.value = '';
      paintAttachmentPreview();
      if (backendSessionActive && assetId) apiRequest(`/api/media/${assetId}/cancel`, { method: 'POST', body: '{}' }).catch((error) => showToast(apiErrorMessage(error.apiCode)));
    }
  };
  $$('.modal-close, .modal-ok').forEach((button) => button.addEventListener('click', () => modalClose(button.closest('.modal'))));
  $$('.modal').forEach((modal) => modal.addEventListener('click', (event) => {
    if (event.target === modal) modalClose(modal);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $$('.modal').forEach((modal) => modalClose(modal));
  });

  $('#jump-compose').addEventListener('click', () => {
    uploadMode = 'post';
    $('.compose-heading h2').textContent = 'منشور جديد';
    $('#compose-modal').hidden = false;
    $('#post-text').focus({ preventScroll: true });
  });
  const openVideoComposer = (mode) => {
    uploadMode = mode;
    reelDurationState = 'idle';
    $('.compose-heading h2').textContent = mode === 'reel' ? 'إنشاء ريل' : 'رفع فيديو للقناة';
    $('#post-text').placeholder = mode === 'reel' ? 'أضيفي وصفًا قصيرًا للريل…' : 'اكتبي وصف الفيديو…';
    $('#post-audience').value = 'public';
    $('#compose-modal').hidden = false;
    mediaInput.click();
  };
  $('#upload-video').addEventListener('click', () => openVideoComposer('video'));
  $('#upload-reel').addEventListener('click', () => openVideoComposer('reel'));

  const mediaInput = $('#media-input');
  const documentInput = $('#file-input');
  $('#pick-image').addEventListener('click', () => mediaInput.click());
  $('#pick-file').addEventListener('click', () => documentInput.click());
  const storyRemaining = () => Math.max(0, 3 - weeklyStoryCount);
  const updateStoryQuota = () => {
      $('#story-quota').textContent = currentLocale === 'ar' ? `المتبقي: ${arNumber.format(storyRemaining())} من ٣` : `${enNumber.format(storyRemaining())} stories left`;
    $$('.story-create, #add-story').forEach((button) => {
      button.disabled = weeklyStoryCount >= 3;
      button.setAttribute('aria-disabled', String(weeklyStoryCount >= 3));
    });
  };
  const requestStoryUpload = () => {
    if (weeklyStoryCount >= 3) {
      showToast('وصلتِ إلى الحد الأسبوعي: ٣ يوميات.');
      return;
    }
    $('#story-input').click();
  };
  updateStoryQuota();
  $('#add-story').addEventListener('click', requestStoryUpload);
  $$('.story-create').forEach((button) => button.addEventListener('click', requestStoryUpload));

  const addObjectUrl = (file) => {
    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    return url;
  };

  const attachmentPreview = $('#attachment-preview');
  const paintAttachmentPreview = () => {
    attachmentPreview.replaceChildren();
    const selected = fileState.media || fileState.document;
    if (!selected) {
      attachmentPreview.hidden = true;
      return;
    }
    attachmentPreview.hidden = false;
    if (fileState.media && fileState.media.url) {
      const preview = isVideoFile(fileState.media.file) ? document.createElement('video') : document.createElement('img');
      preview.src = fileState.media.url;
      if (preview.tagName === 'VIDEO') preview.controls = true;
      preview.alt = fileState.media.file.name;
      attachmentPreview.append(preview);
    }
    const name = document.createElement('span');
    name.textContent = `${selected.file.name}  ·  ${Math.max(1, Math.round(selected.file.size / 1024))} كيلوبايت`;
    attachmentPreview.append(name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button';
    remove.textContent = 'إزالة';
    remove.addEventListener('click', async () => {
      const assetId = selected.assetId;
      fileState.media = null;
      fileState.document = null;
      paintAttachmentPreview();
      if (backendSessionActive && assetId) {
        try { await apiRequest(`/api/media/${assetId}/cancel`, { method: 'POST', body: '{}' }); }
        catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      }
    });
    attachmentPreview.append(remove);
  };

  mediaInput.addEventListener('change', async () => {
    const file = mediaInput.files?.[0];
    if (!file) return;
    if (!validateFile(file, 'media')) { mediaInput.value = ''; return; }
    if (uploadMode !== 'post' && !isVideoFile(file)) {
      showToast(txt('ارفعي ملف فيديو بصيغة MP4 أو MOV.', 'Choose an MP4 or MOV video file.'));
      mediaInput.value = '';
      return;
    }
    fileState.media = { file, url: addObjectUrl(file), uploadState: backendSessionActive ? 'uploading' : 'local' };
    const selectedMedia = fileState.media;
    fileState.document = null;
    paintAttachmentPreview();
    if (backendSessionActive) {
      try {
        const stored = await uploadToQuarantine(file, isVideoFile(file) ? 'video' : 'image');
        if (fileState.media === selectedMedia) {
          Object.assign(selectedMedia, stored);
          showToast(txt('رُفع الملف إلى التخزين الخاص وهو بانتظار فحص الأمان؛ لا يمكن نشره بعد.', 'The file is in private storage awaiting a safety scan; it cannot be published yet.'));
        } else await apiRequest(`/api/media/${stored.assetId}/cancel`, { method: 'POST', body: '{}' });
      } catch (error) {
        if (fileState.media === selectedMedia) selectedMedia.uploadState = 'failed';
        showToast(apiErrorMessage(error.apiCode || error.message));
      }
    }
    if (uploadMode === 'reel') {
      reelDurationState = 'pending';
      $('#publish-post').disabled = true;
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = fileState.media.url;
      probe.onloadedmetadata = () => {
        if (probe.duration < 60 || probe.duration > 90) {
          reelDurationState = 'invalid';
          fileState.media = null;
          mediaInput.value = '';
          paintAttachmentPreview();
          showToast(txt('مدة الريل يجب أن تكون بين ٦٠ و٩٠ ثانية.', 'A Reel must be between 60 and 90 seconds long.'));
        } else {
          reelDurationState = 'valid';
        }
        $('#publish-post').disabled = false;
        probe.removeAttribute('src');
        probe.load();
      };
      probe.onerror = () => {
        reelDurationState = 'invalid';
        $('#publish-post').disabled = false;
        showToast(txt('تعذر قراءة مدة الفيديو. اختاري ملفًا آخر.', 'Could not read the video duration. Choose another file.'));
      };
    }
  });
  documentInput.addEventListener('change', async () => {
    const file = documentInput.files?.[0];
    if (!file) return;
    if (!validateFile(file, 'document')) { documentInput.value = ''; return; }
    fileState.document = { file, uploadState: backendSessionActive ? 'uploading' : 'local' };
    const selectedDocument = fileState.document;
    fileState.media = null;
    paintAttachmentPreview();
    if (backendSessionActive) {
      try {
        const stored = await uploadToQuarantine(file, 'file');
        if (fileState.document === selectedDocument) {
          Object.assign(selectedDocument, stored);
          showToast(txt('رُفع المستند إلى التخزين الخاص وهو بانتظار فحص الأمان؛ لا يمكن نشره بعد.', 'The document is in private storage awaiting a safety scan; it cannot be published yet.'));
        } else await apiRequest(`/api/media/${stored.assetId}/cancel`, { method: 'POST', body: '{}' });
      } catch (error) {
        if (fileState.document === selectedDocument) selectedDocument.uploadState = 'failed';
        showToast(apiErrorMessage(error.apiCode || error.message));
      }
    }
  });

  const makeSvg = (useId) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${useId}`);
    svg.append(use);
    return svg;
  };

  const newPost = ({ text, media, attachment, audience }) => {
    const article = document.createElement('article');
    article.className = 'post card';
    article.dataset.kind = media ? (isVideoFile(media.file) ? 'video' : 'image') : 'text';
    article.dataset.likes = '0';
    article.dataset.comments = '0';
    article.dataset.views = '0';
    article.dataset.ageMinutes = '0';
    article.dataset.search = `${text} ${media?.file.name || ''} ${attachment?.file.name || ''}`.toLocaleLowerCase('ar');

    const head = document.createElement('div');
    head.className = 'post-head';
    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar-me';
    const authorName = $('#profile-user-name')?.textContent || txt('مريم خالد', 'Mariam Khaled');
    avatar.textContent = [...authorName][0] || 'C';
    const author = document.createElement('div');
    author.className = 'post-author';
    author.innerHTML = `<strong>${escapeText(authorName)}</strong><span>${txt('الآن', 'Now')} · <svg class="tiny-icon"><use href="#i-users"/></svg> ${audience === 'public' ? txt('الجميع', 'Everyone') : txt('الأصدقاء', 'Friends')}</span>`;
    $('strong', author).dataset.userContent = 'true';
    const more = document.createElement('button');
    more.className = 'more-button';
    more.setAttribute('aria-label', 'خيارات المنشور');
    more.append(makeSvg('i-more'));
    head.append(avatar, author, more);
    article.append(head);

    if (text) {
      const copy = document.createElement('p');
      copy.className = 'post-copy';
      copy.dataset.userContent = 'true';
      copy.textContent = text;
      article.append(copy);
    }
    if (media) {
      const preview = document.createElement(isVideoFile(media.file) ? 'video' : 'img');
      preview.src = media.url;
      preview.alt = media.file.name;
      if (preview.tagName === 'VIDEO') preview.controls = true;
      Object.assign(preview.style, { display: 'block', width: '100%', maxHeight: '390px', objectFit: 'cover', borderRadius: '14px' });
      article.append(preview);
    }
    if (attachment) {
      const chip = document.createElement('div');
      chip.className = 'attachment-preview';
      chip.append(makeSvg('i-file'));
      const label = document.createElement('span');
      label.textContent = ` ${attachment.file.name} · ملف مرفق`;
      chip.append(label);
      article.append(chip);
    }

    const stats = document.createElement('div');
    stats.className = 'post-stats';
    stats.innerHTML = '<span>❤️ <b class="like-total">0</b> reactions</span><span class="post-views">◉ <b class="view-total">0</b> views</span><button class="comments-toggle">0 comments</button>';
    const actions = document.createElement('div');
    actions.className = 'post-actions';
    [['i-heart', 'إعجاب', 'like-button'], ['i-comment', 'تعليق', 'comments-toggle'], ['i-send', 'مشاركة', 'share-button'], ['i-bookmark', 'حفظ', 'save-button']].forEach(([icon, label, buttonClass]) => {
      const button = document.createElement('button');
      button.className = `post-action ${buttonClass}`;
      button.append(makeSvg(icon));
      const span = document.createElement('span');
      span.textContent = label;
      button.append(span);
      actions.append(button);
    });
    const panel = document.createElement('div');
    panel.className = 'comments-panel';
    panel.hidden = true;
    const entry = document.createElement('div');
    entry.className = 'comment-entry';
    const input = document.createElement('input');
    input.placeholder = 'اكتبي تعليقًا…';
    input.setAttribute('aria-label', 'اكتبي تعليقًا');
    const send = document.createElement('button');
    send.className = 'send-comment';
    send.setAttribute('aria-label', 'إرسال التعليق');
    send.append(makeSvg('i-send'));
    entry.append(input, send);
    panel.append(entry);
    article.append(stats, actions, panel);
    return article;
  };

  const loadServerPosts = async () => {
    if (!backendSessionActive) return;
    try {
      const result = await apiRequest('/api/posts');
      $$('#feed-list [data-server-post]').forEach((post) => post.remove());
      $$('#feed-list > .post:not([data-server-post])').forEach((post) => post.remove());
      [...result.posts].reverse().forEach((post) => {
        const article = document.createElement('article');
        article.className = 'post card';
        article.dataset.serverPost = 'true';
        article.dataset.backendId = post.id;
        article.dataset.audience = post.audience;
        article.dataset.kind = 'text';
        article.dataset.likes = '0';
        article.dataset.comments = '0';
        article.dataset.views = '0';
        article.dataset.ageMinutes = String(Math.max(0, Math.floor((Date.now() - new Date(post.created_at).getTime()) / 60000)));
        article.dataset.search = `${post.display_name} ${post.username} ${post.body}`.toLocaleLowerCase(currentLocale);
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(post.created_at).getTime()) / 60000));
        const relative = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' });
        const time = elapsed < 60 ? relative.format(-elapsed, 'minute') : relative.format(-Math.floor(elapsed / 60), 'hour');
        const icon = post.audience === 'public' ? txt('العامة', 'Public') : txt('الأصدقاء', 'Friends');
        article.innerHTML = `<div class="post-head"><span class="avatar avatar-me">${escapeText([...post.display_name][0] || 'C')}</span><div class="post-author"><strong data-user-content="true">${escapeText(post.display_name)}</strong><span>${escapeText(time)} <i>•</i> ${escapeText(icon)}</span></div><button class="more-button" aria-label="خيارات المنشور"><svg class="icon"><use href="#i-more"></use></svg></button></div><p class="post-copy" data-user-content="true">${escapeText(post.body)}</p><div class="post-stats"><span>❤️ <b class="like-total">0</b> ${txt('تفاعلاً', 'reactions')}</span><span class="post-views">◉ <b class="view-total">0</b> ${txt('مشاهدة', 'views')}</span><button class="comments-toggle">0 ${txt('تعليقات', 'comments')}</button></div><div class="post-actions"><button class="post-action like-button"><svg class="icon"><use href="#i-heart"></use></svg><span>${txt('إعجاب', 'Like')}</span></button><button class="post-action comments-toggle"><svg class="icon"><use href="#i-comment"></use></svg><span>${txt('تعليق', 'Comment')}</span></button><button class="post-action share-button"><svg class="icon"><use href="#i-send"></use></svg><span>${txt('مشاركة', 'Share')}</span></button><button class="post-action save-button"><svg class="icon"><use href="#i-bookmark"></use></svg><span>${txt('حفظ', 'Save')}</span></button></div><div class="comments-panel" hidden><div class="comment-entry"><input placeholder="${txt('اكتبي تعليقًا…', 'Write a comment…')}" aria-label="${txt('اكتبي تعليقًا…', 'Write a comment…')}"><button class="send-comment" aria-label="${txt('إرسال التعليق', 'Send comment')}"><svg class="icon"><use href="#i-send"></use></svg></button></div></div>`;
        $('#feed-list').prepend(article);
      });
      applyFeedScope();
      sortFeed();
      translatePage(currentLocale);
    } catch (error) {
      if (error.status !== 401) showToast(apiErrorMessage(error.apiCode));
    }
  };

  $('#publish-post').addEventListener('click', async () => {
    const text = $('#post-text').value.trim();
    if (!text && !fileState.media && !fileState.document) {
      showToast(txt('اكتبي شيئًا أو أضيفي صورة أو ملفًا أولًا.', 'Write something or add a photo or file first.'));
      $('#post-text').focus();
      return;
    }
    if (uploadMode === 'reel' && (!fileState.media || !isVideoFile(fileState.media.file))) {
      showToast(txt('اختاري فيديو مدته من ٦٠ إلى ٩٠ ثانية لإنشاء الريل.', 'Choose a video that is 60–90 seconds long to create a Reel.'));
      return;
    }
    if (uploadMode === 'video' && (!fileState.media || !isVideoFile(fileState.media.file))) {
      showToast(txt('اختاري فيديو قبل رفعه إلى القناة.', 'Choose a video before uploading it to your channel.'));
      return;
    }
    if (uploadMode === 'reel' && reelDurationState !== 'valid') {
      showToast(txt('انتظري التحقق من مدة الفيديو، ويجب أن تكون بين ٦٠ و٩٠ ثانية.', 'Wait for the video duration check. It must be between 60 and 90 seconds.'));
      return;
    }
    const audience = $('#post-audience').value;
    let storedPostId = '';
    if (backendSessionActive) {
      if (fileState.media || fileState.document) {
        showToast(txt('الملفات تبقى في الحجر الخاص حتى يكتمل فحص الأمان؛ لا يمكن نشرها بعد.', 'Media stays in private quarantine until the security scanner is connected; it cannot be published yet.'));
        return;
      }
      try {
        const result = await apiRequest('/api/posts', { method: 'POST', body: JSON.stringify({ body: text, audience }) });
        storedPostId = result.post.id;
      } catch (error) {
        showToast(apiErrorMessage(error.apiCode));
        return;
      }
    }
    const article = newPost({ text, media: fileState.media, attachment: fileState.document, audience });
    if (storedPostId) {
      article.dataset.backendId = storedPostId;
      article.dataset.serverPost = 'true';
    }
    profilePostCount += 1;
    if (uploadMode === 'video' || uploadMode === 'reel') profileVideoCount += 1;
    $('#profile-posts-count').textContent = currentLocale === 'ar' ? arNumber.format(profilePostCount) : enNumber.format(profilePostCount);
    $('#profile-videos-count').textContent = currentLocale === 'ar' ? arNumber.format(profileVideoCount) : enNumber.format(profileVideoCount);
    article.dataset.audience = audience;
    $('#feed-list').prepend(article);
    if (uploadMode === 'reel') {
      const reelPreview = article.cloneNode(true);
      reelPreview.classList.add('reel-uploaded');
      $('#reel-stream').prepend(reelPreview);
    }
    if ($('#view-videos').classList.contains('active')) renderVideos();
    $('#post-text').value = '';
    fileState.media = null;
    fileState.document = null;
    mediaInput.value = '';
    documentInput.value = '';
    paintAttachmentPreview();
    $('#post-audience').value = 'friends';
    $('#compose-modal').hidden = true;
    applyFeedScope();
    translatePage(currentLocale);
    showToast(uploadMode === 'reel' ? txt('أُضيف الريل إلى معاينة الفيديوهات.', 'The Reel was added to the video preview.') : txt('أُضيف المنشور إلى هذه الجلسة التجريبية.', 'The post was added to this preview session.'));
    uploadMode = 'post';
    reelDurationState = 'idle';
    $('#publish-post').disabled = false;
    $('.compose-heading h2').textContent = 'منشور جديد';
    $('#post-text').placeholder = 'اكتبي شيئًا جميلًا…';
  });

  $('#mood-button').addEventListener('click', () => {
    openSimpleModal('كيف تشعرين اليوم؟', 'اختاري رمزًا وأضيفيه إلى منشورك: 😊  💛  🌷  🎉  ☕');
    const ok = $('.modal-ok', $('#simple-modal'));
    ok.textContent = '😊';
    ok.onclick = () => {
      $('#post-text').value += `${$('#post-text').value ? ' ' : ''}😊`;
      modalClose($('#simple-modal'));
      $('#post-text').focus();
      ok.textContent = 'حسنًا';
      ok.onclick = null;
    };
  });

  const updateLikeTotal = (post, add) => {
    const total = $('.like-total', post);
    const digits = (total.textContent.match(/[٠-٩0-9]+/) || ['٠'])[0];
    const parsed = Number(digits.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))));
    total.textContent = currentLocale === 'ar' ? arNumber.format(Math.max(0, parsed + add)) : enNumber.format(Math.max(0, parsed + add));
    post.dataset.likes = String(Math.max(0, parsed + add));
    if ($('#view-videos').classList.contains('active')) sortVideoFeed();
    sortFeed();
  };

  document.addEventListener('click', async (event) => {
    const like = event.target.closest('.like-button');
    if (like) {
      like.classList.toggle('liked');
      updateLikeTotal(like.closest('.post'), like.classList.contains('liked') ? 1 : -1);
      return;
    }
    const toggle = event.target.closest('.comments-toggle');
    if (toggle) {
      const panel = $('.comments-panel', toggle.closest('.post'));
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('input', panel)?.focus();
      return;
    }
    const sendComment = event.target.closest('.send-comment');
    if (sendComment) {
      const panel = sendComment.closest('.comments-panel');
      const input = $('input', panel);
      const value = input.value.trim();
      if (!value) return;
      const line = document.createElement('div');
      line.className = 'comment-line';
      const avatar = document.createElement('span');
      avatar.className = 'avatar avatar-small avatar-me';
      avatar.textContent = 'م';
      const copy = document.createElement('p');
      copy.dataset.userContent = 'true';
      const author = document.createElement('strong');
      author.textContent = 'أنتِ';
      copy.append(author, document.createTextNode(` ${value}`));
      panel.insertBefore(line, panel.firstChild);
      line.append(avatar, copy);
      const post = sendComment.closest('.post');
      if (post) {
        post.dataset.comments = String(Number(post.dataset.comments || 0) + 1);
        const count = $('.post-stats button.comments-toggle', post);
        if (count) count.textContent = `${post.dataset.comments} ${txt('تعليقات', 'comments')}`;
        sortFeed();
        if ($('#view-videos').classList.contains('active')) sortVideoFeed();
      }
      input.value = '';
      showToast(txt('أُضيف تعليقك لهذه الجلسة.', 'Your comment was added to this session.'));
      return;
    }
    const share = event.target.closest('.share-button');
    if (share) {
      const text = 'شاهدوا هذا المنشور على ChatWave';
      try {
        await navigator.clipboard.writeText(text);
        showToast('نُسخ نص المشاركة.');
      } catch {
      showToast(txt('يمكنك مشاركة المنشور عند ربط المنصة بالخادم.', 'Post sharing will be available when the platform service is connected.'));
      }
      return;
    }
    const save = event.target.closest('.save-button');
    if (save) {
      const saved = save.classList.toggle('saved');
      const label = $('span', save);
      if (label) label.textContent = saved ? 'تم الحفظ' : 'حفظ';
      showToast(saved ? 'حُفظ المنشور في قائمتك التجريبية.' : 'أُزيل المنشور من المحفوظات.');
      return;
    }
    const reelFollow = event.target.closest('.reel-follow');
    if (reelFollow) {
      const following = reelFollow.dataset.following === 'true';
      reelFollow.dataset.following = String(!following);
      reelFollow.textContent = following ? 'متابعة' : 'تتابعينها ✓';
      showToast(following ? txt('أُلغيت متابعة المنشئ.', 'Creator unfollowed.') : txt('أُضيف المنشئ إلى متابعاتك.', 'Creator added to your follows.'));
      return;
    }
    const reelNext = event.target.closest('.reel-next');
    if (reelNext) {
      const next = reelNext.closest('.reel-card')?.nextElementSibling;
      if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const play = event.target.closest('.video-play');
    if (play) {
      const post = play.closest('.post');
      if (post) {
        const current = Number(post.dataset.views || 0) + 1;
        post.dataset.views = String(current);
        const count = $('.view-total', post);
        if (count) count.textContent = currentLocale === 'ar' ? arNumber.format(current) : enNumber.format(current);
      }
      showToast(txt('المحتوى المصوّر هنا للعرض التجريبي؛ تشغيل الفيديو الفعلي يتطلب رفع الملف إلى خدمة الفيديو.', 'These are preview visuals; actual video playback requires connecting a video service.'));
    }
    const moreButton = event.target.closest('.more-button');
    if (moreButton) {
      openSimpleModal(moreButton.closest('.post') ? 'خيارات المنشور' : 'خيارات المحادثة', moreButton.closest('.post') ? 'إدارة المنشور والإبلاغ عنه ستتوفر عند توصيل الحسابات والخادم.' : 'إعدادات المحادثة والإبلاغ عنها ستتوفر عند توصيل الحسابات والخادم.');
    }
  });

  const sortVideoFeed = () => {
    const host = $('#video-feed');
    if (!host) return;
    const sort = $('#video-sort')?.value || 'views';
    const key = sort === 'engagement' ? (post) => Number(post.dataset.likes || 0) + Number(post.dataset.comments || 0)
      : sort === 'recent' ? (post) => -Number(post.dataset.ageMinutes || 0)
        : (post) => Number(post.dataset[sort] || 0);
    [...host.children].sort((a, b) => key(b) - key(a)).forEach((post) => host.append(post));
  };
  const renderVideos = () => {
    const host = $('#video-feed');
    const videoPosts = $$('#feed-list .post[data-kind="video"]').map((post) => {
      const clone = post.cloneNode(true);
      clone.hidden = false;
      return clone;
    });
    host.replaceChildren(...videoPosts);
    // The video shelf and Reels stream are independent collections in this local preview.
    sortVideoFeed();
    $$('.reel-card').forEach((card, index) => {
      card.dataset.views ||= String([8200, 5400, 7100][index] || 0);
      card.dataset.likes ||= String([860, 604, 390][index] || 0);
      card.dataset.comments ||= String([42, 27, 19][index] || 0);
      if (!$('.reel-next', card)) {
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'reel-next';
        down.setAttribute('aria-label', txt('المقطع التالي', 'Next clip'));
        down.title = txt('المقطع التالي', 'Next clip');
        down.textContent = '↓';
        $('.reel-overlay', card)?.append(down);
      }
    });
  };
  $$('.video-mode').forEach((button) => button.addEventListener('click', () => {
    const showReels = button.dataset.videoMode === 'reels';
    $$('.video-mode').forEach((tab) => tab.classList.toggle('selected', tab === button));
    $('#watch-view').hidden = showReels;
    $('#reels-view').hidden = !showReels;
    if (showReels) {
      $('#reel-stream').scrollTop = 0;
      const first = $('.reel-card', $('#reel-stream'));
      first?.classList.add('reel-current');
      first?.setAttribute('tabindex', '-1');
      first?.focus({ preventScroll: true });
    }
  }));

  let feedSort = 'recent';
  const sortFeed = () => {
    const host = $('#feed-list');
    const key = feedSort === 'engagement'
      ? (post) => Number(post.dataset.likes || 0) + Number(post.dataset.comments || 0)
      : feedSort === 'views' ? (post) => Number(post.dataset.views || 0) : (post) => -Number(post.dataset.ageMinutes || 0);
    [...host.children].sort((a, b) => key(b) - key(a)).forEach((post) => host.append(post));
  };
  $('#feed-filter').addEventListener('click', () => {
    const menu = $('#feed-sort-menu');
    const open = menu.hidden;
    menu.hidden = !open;
    $('#feed-filter').setAttribute('aria-expanded', String(open));
  });
  $$('#feed-sort-menu [data-feed-sort]').forEach((button) => button.addEventListener('click', () => {
    feedSort = button.dataset.feedSort;
    $$('#feed-sort-menu [data-feed-sort]').forEach((item) => item.classList.toggle('selected', item === button));
    $('#feed-filter').firstChild.textContent = `${button.textContent} `;
    $('#feed-sort-menu').hidden = true;
    $('#feed-filter').setAttribute('aria-expanded', 'false');
    sortFeed();
  }));
  $('#video-sort')?.addEventListener('change', sortVideoFeed);
  $('#channel-sort')?.addEventListener('change', (event) => {
    const host = $('.channel-list');
    const cards = [...host.children];
    if (event.currentTarget.value === 'subscribers') cards.sort((a, b) => Number(b.dataset.subscribers || 0) - Number(a.dataset.subscribers || 0));
    else cards.sort((a, b) => Number(b.dataset.createdAt || 0) - Number(a.dataset.createdAt || 0));
    cards.forEach((card) => host.append(card));
  });
  $$('.channel-card').forEach((card, index) => { card.dataset.createdAt ||= String(Date.now() - index); });

  const sidebarToggle = $('#sidebar-toggle');
  sidebarToggle.addEventListener('click', () => {
    setSidebarCollapsed(!appShell.classList.contains('sidebar-collapsed'));
  });

  let feedScope = 'all';
  let feedSearch = '';
  const applyFeedScope = () => {
    $$('#feed-list .post').forEach((post) => {
      const scopeMatch = feedScope === 'all' || post.dataset.audience === feedScope;
      const haystack = `${post.dataset.search || ''} ${post.textContent}`.toLocaleLowerCase('ar');
      post.hidden = !scopeMatch || (!!feedSearch && !haystack.includes(feedSearch));
    });
  };
  $$('.scope-button').forEach((button) => button.addEventListener('click', () => {
    feedScope = button.dataset.scope;
    $$('.scope-button').forEach((item) => item.classList.toggle('selected', item === button));
    applyFeedScope();
  }));
  const bindChannelCard = (card) => card.addEventListener('click', async () => {
    const button = $('.channel-follow', card);
    const following = button.dataset.following === 'true';
    if (backendSessionActive && card.dataset.serverChannel === 'true') {
      try {
        if (following) await apiRequest(`/api/channels/${card.dataset.channelId}/follow`, { method: 'DELETE' });
        else await apiRequest('/api/channels/follow', { method: 'POST', body: JSON.stringify(card.dataset.visibility === 'private' ? { inviteToken: card.dataset.inviteToken } : { username: card.dataset.username }) });
        button.dataset.following = String(!following);
        button.textContent = following ? txt('متابعة', 'Follow') : txt('تتابعينها ✓', 'Following ✓');
        showToast(following ? txt('ألغيت متابعة القناة.', 'Channel unfollowed.') : txt('تتابعين القناة الآن.', 'You are now following this channel.'));
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      return;
    }
    button.dataset.following = String(!following);
    button.textContent = following ? txt('متابعة', 'Follow') : txt('تتابعينها ✓', 'Following ✓');
    showToast(following ? txt('تم إلغاء متابعة القناة.', 'Channel unfollowed.') : txt('أُضيفت القناة إلى متابعاتك التجريبية.', 'Channel added to your preview follows.'));
  });
  $$('.channel-card').forEach(bindChannelCard);
  let channelPhotoUrl = '';
  const channelForm = $('#channel-form');
  const channelExtras = document.createElement('div');
  channelExtras.className = 'channel-extra-fields';
  channelExtras.innerHTML = `<label for="channel-description"><span data-locale-ar="نبذة عن القناة" data-locale-en="Channel description">${txt('نبذة عن القناة', 'Channel description')}</span></label><textarea id="channel-description" maxlength="500" rows="2"></textarea><label for="channel-visibility"><span data-locale-ar="خصوصية القناة" data-locale-en="Channel privacy">${txt('خصوصية القناة', 'Channel privacy')}</span></label><select id="channel-visibility"><option value="public" data-locale-ar="عامة — رابط باسم المستخدم" data-locale-en="Public — username link">${txt('عامة — رابط باسم المستخدم', 'Public — username link')}</option><option value="private" data-locale-ar="خاصة — رابط دعوة" data-locale-en="Private — invite link">${txt('خاصة — رابط دعوة', 'Private — invite link')}</option></select><label for="channel-admins"><span data-locale-ar="المشرفون (اختياري)" data-locale-en="Admins (optional)">${txt('المشرفون (اختياري)', 'Admins (optional)')}</span></label><input id="channel-admins" data-placeholder-ar="name.one, name.two" data-placeholder-en="name.one, name.two" placeholder="name.one, name.two"><label class="channel-photo-picker" for="channel-photo-input"><span data-locale-ar="إضافة صورة للقناة (معاينة)" data-locale-en="Add channel photo (preview)">${txt('إضافة صورة للقناة (معاينة)', 'Add channel photo (preview)')}</span></label><input id="channel-photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden><small class="setting-hint"><span data-locale-ar="تُعرض الصورة محليًا فقط حتى يكتمل فحص الملفات الآمن." data-locale-en="The image is local preview only until secure file scanning is connected.">${txt('تُعرض الصورة محليًا فقط حتى يكتمل فحص الملفات الآمن.', 'The image is local preview only until secure file scanning is connected.')}</span></small><div class="channel-created-link" id="channel-created-link" hidden><label for="channel-created-link-input"><span data-locale-ar="رابط القناة" data-locale-en="Channel link">${txt('رابط القناة', 'Channel link')}</span></label><div class="username-entry"><input id="channel-created-link-input" readonly><button class="outline-button" id="copy-channel-link" type="button"><span data-locale-ar="نسخ" data-locale-en="Copy">${txt('نسخ', 'Copy')}</span></button></div></div>`;
  $('#channel-category').after(channelExtras);
  $('#channel-photo-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      showToast(txt('اختاري صورة JPG أو PNG أو WebP حتى ٨ ميغابايت.', 'Choose a JPG, PNG, or WebP image up to 8 MB.'));
      event.currentTarget.value = '';
      return;
    }
    if (channelPhotoUrl) { URL.revokeObjectURL(channelPhotoUrl); objectUrls.delete(channelPhotoUrl); }
    channelPhotoUrl = addObjectUrl(file);
  });
  $('#copy-channel-link').addEventListener('click', async () => {
    const input = $('#channel-created-link-input');
    try { await navigator.clipboard.writeText(input.value); showToast(txt('نُسخ رابط القناة.', 'Channel link copied.')); }
    catch { input.select(); document.execCommand('copy'); showToast(txt('نُسخ رابط القناة.', 'Channel link copied.')); }
  });
  const loadServerChannels = async () => {
    if (!backendSessionActive) return;
    try {
      const { channels } = await apiRequest('/api/channels');
      $$('.channel-card[data-server-channel]').forEach((card) => card.remove());
      channels.forEach((item) => {
        const card = document.createElement('button');
        card.className = 'channel-card';
        card.dataset.serverChannel = 'true';
        card.dataset.channelId = item.id;
        card.dataset.username = item.username;
        card.dataset.visibility = item.visibility;
        card.dataset.inviteToken = item.invite_token || '';
        card.dataset.subscribers = '0';
        const avatar = document.createElement('span'); avatar.className = 'channel-avatar channel-tech'; avatar.textContent = [...item.title][0] || 'C';
        const title = document.createElement('strong'); title.textContent = item.title;
        const meta = document.createElement('small'); meta.textContent = `@${item.username} · ${item.visibility === 'private' ? txt('خاصة', 'Private') : txt('عامة', 'Public')}`;
        const follow = document.createElement('span'); follow.className = 'channel-follow'; follow.dataset.following = String(item.following === true); follow.textContent = item.following ? txt('تتابعينها ✓', 'Following ✓') : txt('متابعة', 'Follow');
        card.append(avatar, title, meta, follow);
        bindChannelCard(card);
        $('.channel-list').prepend(card);
      });
    } catch (error) { if (error.status !== 401) showToast(apiErrorMessage(error.apiCode)); }
  };
  const processPendingLinks = async () => {
    if (!backendSessionActive) return;
    const url = new URL(location.href);
    const groupToken = url.searchParams.get('join');
    const channelToken = url.searchParams.get('channelInvite');
    const channelName = url.searchParams.get('channel');
    if (!groupToken && !channelToken && !channelName) return;
    url.searchParams.delete('join');
    url.searchParams.delete('channelInvite');
    url.searchParams.delete('channel');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    try {
      if (groupToken) {
        const { group } = await apiRequest('/api/groups/join', { method: 'POST', body: JSON.stringify({ inviteToken: groupToken }) });
        await loadServerConversations();
        showToast(group.state === 'requested' ? txt('أُرسل طلب الانضمام إلى مشرفي الجروب.', 'Your join request was sent to the group admins.') : txt('انضممت إلى الجروب.', 'You joined the group.'));
      }
      if (channelToken || channelName) {
        const { channel } = await apiRequest('/api/channels/follow', { method: 'POST', body: JSON.stringify(channelToken ? { inviteToken: channelToken } : { username: channelName }) });
        await loadServerChannels();
        showToast(txt(`تم فتح قناة ${channel.title}.`, `You opened ${channel.title}.`));
      }
    } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
  };
  $('#create-channel').addEventListener('click', () => {
    $('#channel-form').reset();
    $('#channel-created-link').hidden = true;
    $('#channel-form .primary-button').disabled = false;
    $('#channel-form .primary-button').textContent = txt('إنشاء القناة', 'Create channel');
    if (channelPhotoUrl) { URL.revokeObjectURL(channelPhotoUrl); objectUrls.delete(channelPhotoUrl); }
    channelPhotoUrl = '';
    $('#channel-modal').hidden = false;
    $('#channel-name').focus();
  });
  $('#channel-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#channel-name').value.trim();
    const handle = $('#channel-handle').value.trim().replace(/^@/, '').toLowerCase();
    const category = $('option:checked', $('#channel-category')).textContent;
    if (!name || !/^[a-z0-9._]{3,24}$/.test(handle)) {
      showToast(txt('اكتبي اسم مستخدم من ٣ إلى ٢٤ حرفًا لاتينيًا أو رقمًا.', 'Enter a username with 3–24 letters or numbers.'));
      $('#channel-handle').focus();
      return;
    }
    let createdChannel = null;
    if (backendSessionActive) {
      try {
        const adminUsernames = $('#channel-admins').value.split(/[\s,;]+/).map((value) => value.trim().replace(/^@/, '')).filter(Boolean);
        ({ channel: createdChannel } = await apiRequest('/api/channels', { method: 'POST', body: JSON.stringify({ title: name, username: handle, description: $('#channel-description').value.trim(), visibility: $('#channel-visibility').value, adminUsernames }) }));
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); return; }
    }
    const card = document.createElement('button');
    card.className = 'channel-card';
    card.dataset.serverChannel = createdChannel ? 'true' : 'false';
    card.dataset.subscribers = '0';
    card.dataset.createdAt = String(Date.now());
    const avatar = document.createElement('span');
    avatar.className = 'channel-avatar channel-tech';
    avatar.textContent = name.slice(0, 1);
    if (channelPhotoUrl) avatar.style.background = `center / cover no-repeat url("${channelPhotoUrl}")`;
    const title = document.createElement('strong');
    title.textContent = name;
    const meta = document.createElement('small');
    meta.textContent = `@${handle} · ${category}`;
    const follow = document.createElement('span');
    follow.className = 'channel-follow';
    follow.textContent = 'متابعة';
    card.append(avatar, title, meta, follow);
    bindChannelCard(card);
    $('.channel-list').prepend(card);
    if (createdChannel) {
      $('#channel-form .primary-button').disabled = true;
      $('#channel-form .primary-button').textContent = txt('تم إنشاء القناة', 'Channel created');
      $('#channel-created-link-input').value = createdChannel.visibility === 'private'
        ? `${location.origin}${location.pathname}?channelInvite=${encodeURIComponent(createdChannel.invite_token)}`
        : `${location.origin}${location.pathname}?channel=${encodeURIComponent(createdChannel.username)}`;
      $('#channel-created-link').hidden = false;
      await loadServerChannels();
    } else {
      $('#channel-form').reset();
      $('#channel-created-link').hidden = true;
      $('#channel-modal').hidden = true;
    }
    translatePage(currentLocale);
    showToast(createdChannel ? txt('أُنشئت القناة على الخادم. صورة القناة ستُرفع بعد تفعيل الفحص.', 'Channel created on the server. Its photo can be uploaded once scanning is active.') : txt('أُنشئت قناتك في المعاينة المحلية.', 'Your channel was created in the local preview.'));
  });

  const friends = [
    { name: 'نور إبراهيم', username: '@noor.ontheroad', letter: 'ن', avatar: 'story-noor', detail: 'صديقتان مشتركتان' },
    { name: 'عمر ناصر', username: '@omar.reads', letter: 'ع', avatar: 'story-omar', detail: 'من مجتمع القراءة' },
    { name: 'ليلى الحداد', username: '@layla.haddad', letter: 'ل', avatar: 'story-layla', detail: 'صديقة من الجامعة' },
    { name: 'يوسف علي', username: '@yousef.cooks', letter: 'ي', avatar: 'story-yousef', detail: 'مهتم بالطبخ والتصوير' },
    { name: 'سارة منصور', username: '@sara.reads', letter: 'س', avatar: 'story-sara', detail: '٤ أصدقاء مشتركون' },
    { name: 'هند سالم', username: '@hind.travels', letter: 'هـ', avatar: 'avatar-me', detail: 'تحب السفر والفن' },
  ];
  const addedFriends = new Set();
  const renderServerFriends = async (query = '') => {
    const host = $('#friends-grid');
    if (!host || !backendSessionActive) return;
    host.replaceChildren();
    const cleanQuery = query.trim().replace(/^@/, '');
    try {
      let people = [];
      let requests = [];
      if (cleanQuery.length >= 3) {
        const result = await apiRequest(`/api/people/search?username=${encodeURIComponent(cleanQuery)}`);
        people = result.people || [];
      } else if (!cleanQuery) {
        const results = await Promise.all([apiRequest('/api/friends'), apiRequest('/api/friend-requests')]);
        people = results[0].friends || [];
        $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(people.length) : enNumber.format(people.length);
        requests = results[1].requests || [];
      } else {
        const hint = document.createElement('p');
        hint.className = 'setting-hint';
        hint.textContent = txt('اكتبي ٣ أحرف على الأقل من اسم المستخدم للبحث.', 'Type at least 3 characters of a username to search.');
        host.append(hint);
        return;
      }
      const makeCard = (person, action, label) => {
        const card = document.createElement('article');
        card.className = 'friend-card';
        const avatar = document.createElement('span');
        avatar.className = 'avatar avatar-me';
        avatar.textContent = [...person.display_name][0] || 'C';
        const name = document.createElement('h3');
        name.textContent = person.display_name;
        name.dataset.userContent = 'true';
        const username = document.createElement('span');
        username.className = 'friend-username';
        username.textContent = `@${person.username}`;
        username.dataset.userContent = 'true';
        const button = document.createElement('button');
        button.className = `primary-button ${action}`;
        button.textContent = label;
        button.dataset.username = person.username;
        card.append(avatar, name, username, button);
        return card;
      };
      requests.forEach((person) => host.append(makeCard(person, 'backend-friend-accept', txt('قبول الطلب', 'Accept request'))));
      people.forEach((person) => {
        const isExistingFriend = !cleanQuery;
        host.append(makeCard(person, isExistingFriend ? 'backend-start-chat' : 'backend-friend-request', isExistingFriend ? txt('مراسلة', 'Message') : txt('إضافة صديق', 'Add friend')));
      });
      if (!requests.length && !people.length) {
        const empty = document.createElement('p');
        empty.className = 'setting-hint';
        empty.textContent = cleanQuery ? txt('لم نعثر على حساب بهذا الاسم.', 'No account found with that username.') : txt('لا توجد نتائج بعد. ابحثي باسم المستخدم لإضافة صديق.', 'No friends yet. Search by username to add someone.');
        host.append(empty);
      }
      translatePage(currentLocale);
    } catch (error) {
      const message = document.createElement('p');
      message.className = 'setting-hint';
      message.textContent = apiErrorMessage(error.apiCode);
      host.append(message);
    }
  };
  const renderFriends = () => {
    const host = $('#friends-grid');
    if (!host) return;
    const query = ($('#friends-search')?.value || '').trim().toLocaleLowerCase('ar');
    if (backendSessionActive) { renderServerFriends(query); return; }
    host.replaceChildren();
    const usernameQuery = query.replace(/^@/, '');
    friends.filter((friend) => !usernameQuery || friend.username.slice(1).toLocaleLowerCase('ar').includes(usernameQuery)).forEach((friend) => {
      const card = document.createElement('article');
      card.className = 'friend-card';
      const avatar = document.createElement('span');
      avatar.className = `avatar ${friend.avatar}`;
      avatar.textContent = friend.letter;
      const name = document.createElement('h3');
      name.textContent = friend.name;
      const username = document.createElement('span');
      username.className = 'friend-username';
      username.textContent = friend.username;
      const detail = document.createElement('p');
      detail.textContent = friend.detail;
      const button = document.createElement('button');
      const isAdded = addedFriends.has(friend.name);
      button.className = isAdded ? 'outline-button added-friend' : 'primary-button add-card-friend';
      button.textContent = isAdded ? 'تمت الإضافة ✓' : 'إضافة صديق';
      button.dataset.friendName = friend.name;
      card.append(avatar, name, username, detail, button);
      host.append(card);
    });
    translatePage(currentLocale);
  };

  $('#friends-search').addEventListener('input', renderFriends);
  document.addEventListener('click', async (event) => {
    const requestButton = event.target.closest('.backend-friend-request');
    if (requestButton) {
      try {
        const result = await apiRequest('/api/friend-requests', { method: 'POST', body: JSON.stringify({ username: requestButton.dataset.username }) });
        showToast(result.state === 'accepted' ? txt('أصبحتما صديقين ويمكنكما بدء محادثة.', 'You are now friends and can start a chat.') : txt('أُرسل طلب الصداقة.', 'Friend request sent.'));
        renderServerFriends($('#friends-search').value);
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      return;
    }
    const acceptButton = event.target.closest('.backend-friend-accept');
    if (acceptButton) {
      try {
        await apiRequest(`/api/friend-requests/${encodeURIComponent(acceptButton.dataset.username)}/accept`, { method: 'POST', body: '{}' });
        showToast(txt('قُبل طلب الصداقة.', 'Friend request accepted.'));
        await Promise.all([renderServerFriends($('#friends-search').value), loadServerConversations()]);
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      return;
    }
    const messageButton = event.target.closest('.backend-start-chat');
    if (messageButton) {
      try {
        await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ kind: 'direct', participantUsernames: [messageButton.dataset.username] }) });
        await loadServerConversations();
        const conversation = $$('.conversation').find((item) => item.dataset.peerUsername === messageButton.dataset.username);
        if (conversation) renderChat(conversation.dataset.name, conversation.dataset.class);
        setView('messages');
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
      return;
    }
    const addCard = event.target.closest('.add-card-friend');
    const addSmall = event.target.closest('.add-friend');
    if (addCard) {
      const name = addCard.dataset.friendName;
      if (addedFriends.has(name)) return;
      addedFriends.add(name);
      renderFriends();
      $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(addedFriends.size) : enNumber.format(addedFriends.size);
      showToast(txt(`أُضيف ${name} إلى قائمة الأصدقاء التجريبية.`, `${name} was added to your preview friends.`));
      return;
    }
    if (addSmall) {
      const row = addSmall.closest('.suggestion-row');
      const name = $('strong', row).textContent;
      addedFriends.add(name);
      addSmall.classList.add('added');
      addSmall.textContent = '✓';
      addSmall.setAttribute('aria-label', `تمت إضافة ${name}`);
      $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(addedFriends.size) : enNumber.format(addedFriends.size);
      showToast(txt(`أُضيف ${name} إلى قائمة الأصدقاء التجريبية.`, `${name} was added to your preview friends.`));
    }
  });

  $('#global-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const query = event.currentTarget.value.trim().toLocaleLowerCase('ar');
    feedSearch = query;
    setView('home');
    applyFeedScope();
    showToast(query ? txt('نتائج البحث في منشورات هذه الصفحة.', 'Showing search results in this page’s posts.') : txt('تم عرض جميع المنشورات.', 'Showing all posts.'));
  });

  const storyModal = $('#story-modal');
  const showStory = (name, url = '') => {
    activeStory = { name, url, savedAt: new Date().toISOString() };
    $('#story-modal-name').textContent = name;
    const ownStoryName = txt('يوميتك', 'Your story');
    $('#story-modal-copy').textContent = name === 'يوميتك' || name === 'Your story' || name === ownStoryName ? txt('لحظة جديدة من يومك ✨', 'A new moment from your day ✨') : txt(`شاركت ${name} لحظة جميلة مع ChatWave ✨`, `${name} shared a lovely moment on ChatWave ✨`);
    const art = $('.story-modal-art');
    art.replaceChildren();
    art.style.background = url && !storyVideoUrls.has(url) ? `center / cover no-repeat url("${url}")` : 'radial-gradient(circle at 40% 45%, #f7d5a0, #b66f78 60%, #5d558e)';
    if (url && storyVideoUrls.has(url)) {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      art.append(video);
    }
    storyModal.hidden = false;
  };
  const renderStoryArchive = () => {
    const host = $('#story-archive-list');
    host.replaceChildren();
    if (!savedStories.length) {
      const empty = document.createElement('p');
      empty.className = 'story-archive-empty';
      empty.textContent = txt('احفظي يومية من شاشة العرض لتظهر هنا.', 'Save a story from its viewer to see it here.');
      host.append(empty);
    }
    savedStories.forEach((story) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'story-archive-item';
      if (story.url) item.style.backgroundImage = `linear-gradient(0deg,#17152bcc,transparent 65%),url("${story.url}")`;
      const name = document.createElement('strong');
      name.textContent = story.name;
      const date = document.createElement('small');
      date.textContent = new Date(story.savedAt).toLocaleDateString(currentLocale === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' });
      item.append(name, date);
      item.addEventListener('click', () => showStory(story.name, story.url || ''));
      host.append(item);
    });
    $('#story-archive-count').textContent = currentLocale === 'ar' ? `${arNumber.format(savedStories.length)} محفوظة` : `${enNumber.format(savedStories.length)} saved`;
  };
  $('#toggle-story-archive').addEventListener('click', () => {
    const archive = $('#story-archive');
    archive.hidden = !archive.hidden;
    if (!archive.hidden) renderStoryArchive();
  });
  $('#save-story').addEventListener('click', () => {
    if (!activeStory) return;
    if (!savedStories.some((story) => story.name === activeStory.name && story.url === activeStory.url)) savedStories.unshift({ ...activeStory });
    renderStoryArchive();
    $('#story-archive').hidden = false;
    storyModal.hidden = true;
    showToast(txt('حُفظت اليومية في أرشيف المعاينة على هذا الجهاز.', 'Story saved to this device’s preview archive.'));
  });
  $$('.story[data-story]').forEach((button) => button.addEventListener('click', () => showStory(button.dataset.story)));
  $('#all-stories').addEventListener('click', () => showToast(txt('أنتِ تشاهدين أحدث يوميات أصدقائك.', 'You are viewing your friends’ latest stories.')));
  $('#story-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (backendSessionActive) {
      showToast(txt('رفع اليوميات إلى الحساب سيتاح بعد ربط فحص الملفات ومسار نشرها.', 'Story uploads will be enabled after secure scanning and publishing are connected.'));
      event.currentTarget.value = '';
      return;
    }
    if (weeklyStoryCount >= 3) {
      event.currentTarget.value = '';
      updateStoryQuota();
      showToast('وصلتِ إلى الحد الأسبوعي: ٣ يوميات.');
      return;
    }
    if (!validateFile(file, 'story')) { event.currentTarget.value = ''; return; }
    const storyUrl = addObjectUrl(file);
    if (isVideoFile(file)) storyVideoUrls.add(storyUrl);
    fileState.storyUrl = storyUrl;
    weeklyStoryCount += 1;
    try { localStorage.setItem(storyUsageKey, String(weeklyStoryCount)); } catch { /* The demo continues if browser storage is unavailable. */ }
    updateStoryQuota();
    const story = document.createElement('button');
    story.className = 'story';
    const storyName = txt('يوميتك', 'Your story');
    const storyInitial = [...($('#profile-user-name').textContent || 'C')][0] || 'C';
    story.innerHTML = `<span class="story-ring"><span class="story-avatar avatar-me">${escapeText(storyInitial)}</span></span><span>${escapeText(storyName)}</span>`;
    story.addEventListener('click', () => showStory(txt('يوميتك', 'Your story'), storyUrl));
    $('#story-list').insertBefore(story, $('#story-list').children[1] || null);
    showStory(storyName, storyUrl);
    setTimeout(() => {
      story.remove();
      if (!savedStories.some((saved) => saved.url === storyUrl)) {
        URL.revokeObjectURL(storyUrl);
        objectUrls.delete(storyUrl);
        storyVideoUrls.delete(storyUrl);
      }
      if (fileState.storyUrl === storyUrl) fileState.storyUrl = '';
    }, 24 * 60 * 60 * 1000);
    showToast(txt(`أُضيفت يوميتك؛ متبقي ${arNumber.format(storyRemaining())} من ٣ لهذا الأسبوع.`, `Your story was added. ${storyRemaining()} of 3 weekly stories remain.`));
    event.currentTarget.value = '';
  });

  let activeMessageFilter = 'all';
  const messageHistory = new Map([
    ['ليلى الحداد', [{ from: 'them', text: 'وصلتني صور البحر، المكان يجنن! 💙' }, { from: 'mine', text: 'كان الجو رائعًا فعلًا، نروح سوا المرة الجاية؟' }, { from: 'them', text: 'أكيد! خلينا نرتب لها قريبًا ✨' }]],
    ['يوسف علي', [{ from: 'them', text: 'تمام، أرسلها لك بعد قليل 🍋' }]],
    ['سارة منصور', [{ from: 'them', text: 'شكرًا يا جميلة 💜' }]],
    ['مجموعة الأصدقاء', [{ from: 'them', text: 'عمر: نشوفكم الجمعة؟' }]],
    ['نور إبراهيم', [{ from: 'them', text: 'أهلًا مريم! سعيدة بالتواصل معك 🌷' }]],
    ['عمر ناصر', [{ from: 'them', text: 'أهلًا! كيف أخبارك؟' }]],
  ]);

  const addMessage = (text, from = 'mine', file = null) => {
    const message = document.createElement('div');
    message.className = `message-bubble${from === 'mine' ? ' mine' : ''}`;
    if (file) {
      const upload = file.file ? file : { file, url: '' };
      if (upload.url && (isVideoFile(upload.file) || ['jpg', 'jpeg', 'png', 'webp'].includes(extensionOf(upload.file)))) {
        const mediaPreview = document.createElement(isVideoFile(upload.file) ? 'video' : 'img');
        mediaPreview.src = upload.url;
        mediaPreview.alt = upload.file.name;
        if (mediaPreview.tagName === 'VIDEO') mediaPreview.controls = true;
        Object.assign(mediaPreview.style, { display: 'block', width: 'min(230px, 55vw)', maxHeight: '190px', objectFit: 'cover', borderRadius: '10px', marginBottom: '6px' });
        message.append(mediaPreview);
      }
      const line = document.createElement('div');
      line.className = 'chat-attachment';
      line.append(makeSvg('i-file'));
      const label = document.createElement('span');
      label.textContent = upload.file.name;
      line.append(label);
      message.append(line);
    } else {
      const copy = document.createElement('span');
      copy.textContent = text;
      message.append(copy);
    }
    const time = document.createElement('small');
    time.className = 'message-time';
    time.textContent = txt('الآن', 'Now');
    message.append(time);
    $('#chat-messages').append(message);
    $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  };

  const loadServerConversations = async () => {
    if (!backendSessionActive) return;
    try {
      const { conversations } = await apiRequest('/api/conversations');
      const host = $('#conversation-list');
      host.replaceChildren();
      conversations.forEach((item) => {
        const name = item.kind === 'direct' ? item.peer_name : (item.title || txt('مجموعة جديدة', 'New group'));
        const conversation = document.createElement('button');
        conversation.className = 'conversation';
        conversation.dataset.name = name;
        conversation.dataset.backendId = item.id;
        conversation.dataset.peerUsername = item.peer_username || '';
        conversation.dataset.kind = item.kind;
        conversation.dataset.role = item.my_role || 'member';
        conversation.dataset.description = item.description || '';
        conversation.dataset.visibility = item.visibility || 'private';
        conversation.dataset.joinMode = item.join_mode || 'invite';
        conversation.dataset.allowForwarding = String(item.allow_forwarding !== false);
        conversation.dataset.inviteToken = item.invite_token || '';
        conversation.dataset.letter = [...name][0] || 'C';
        conversation.dataset.class = 'story-noor';
        conversation.dataset.category = item.kind === 'group' ? 'groups' : item.kind === 'channel' ? 'channels' : item.kind === 'bot' ? 'bots' : 'private contacts';
        conversation.dataset.unread = 'false';
        conversation.dataset.pinned = 'false';
        const avatar = document.createElement('span');
        avatar.className = 'avatar story-noor';
        avatar.textContent = conversation.dataset.letter;
        const details = document.createElement('span');
        details.className = 'conversation-details';
        const title = document.createElement('strong');
        title.textContent = name;
        title.dataset.userContent = 'true';
        const preview = document.createElement('span');
        preview.textContent = txt('محادثة محفوظة على الخادم', 'Server conversation');
        details.append(title, preview);
        const meta = document.createElement('span');
        meta.className = 'conversation-meta';
        const time = document.createElement('time');
        time.textContent = new Intl.DateTimeFormat(currentLocale, { month: 'short', day: 'numeric' }).format(new Date(item.created_at));
        meta.append(time);
        conversation.append(avatar, details, meta);
        conversation.addEventListener('click', () => renderChat(name, conversation.dataset.class));
        host.append(conversation);
      });
      currentConversationId = '';
      currentChat = '';
      $('#chat-active').hidden = true;
      $('#chat-empty').hidden = false;
      translatePage(currentLocale);
    } catch (error) {
      if (error.status !== 401) showToast(apiErrorMessage(error.apiCode));
    }
  };

  const renderChat = async (name, avatarClass = '') => {
    const selectedConversation = $$('.conversation').find((item) => item.dataset.name === name);
    if (isMinorPreview && selectedConversation?.dataset.category?.includes('strangers')) {
      showToast(txt('تقتصر الرسائل في وضع القاصر التجريبي على جهات الاتصال المقبولة.', 'In youth preview mode, messages are limited to approved contacts.'));
      return;
    }
    currentChat = name;
    currentConversationId = selectedConversation?.dataset.backendId || '';
    groupSettingsButton.hidden = !(selectedConversation?.dataset.kind === 'group' && ['owner', 'admin'].includes(selectedConversation.dataset.role));
    messageSecurityNote.hidden = !backendSessionActive || !currentConversationId;
    $('#chat-empty').hidden = true;
    $('#chat-active').hidden = false;
    $('#chat-name').textContent = name;
    $('#chat-name').dataset.userContent = 'true';
    const avatar = $('#chat-avatar');
    avatar.className = `avatar ${avatarClass || 'story-noor'}`;
    avatar.textContent = friends.find((friend) => friend.name === name)?.letter || name.slice(0, 1);
    const feed = $('#chat-messages');
    feed.replaceChildren();
    const day = document.createElement('span');
    day.className = 'chat-day';
    day.textContent = txt('اليوم', 'Today');
    feed.append(day);
    if (backendSessionActive && currentConversationId) {
      try {
        const result = await apiRequest(`/api/conversations/${currentConversationId}/messages`);
        const rows = result.messages || [];
        messageHistory.set(name, rows.map((message) => ({ from: message.sender_id === backendUserId ? 'mine' : 'them', text: message.body })));
        rows.forEach((message) => addMessage(message.body, message.sender_id === backendUserId ? 'mine' : 'them'));
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
    } else {
      (messageHistory.get(name) || []).forEach((message) => addMessage(message.text, message.from, message.file));
    }
    $$('.conversation').forEach((conversation) => {
      conversation.classList.toggle('selected', conversation.dataset.name === name);
      if (conversation.dataset.name === name && conversation.dataset.unread === 'true') {
        conversation.dataset.unread = 'false';
        $('.conversation-meta b', conversation)?.remove();
      }
    });
    applyMessageFilters();
    translatePage(currentLocale);
    $('#chat-input').focus();
  };

  const openChatByName = (name) => {
    setView('messages');
    let conversation = $$('.conversation').find((item) => item.dataset.name === name);
    if (backendSessionActive && !conversation) {
      setView('friends');
      showToast(txt('ابحثي عن صديق باسم المستخدم، ثم اختاري مراسلة.', 'Search for an accepted friend by username, then choose Message.'));
      return;
    }
    if (!conversation) {
      conversation = document.createElement('button');
      conversation.className = 'conversation';
      const friend = friends.find((item) => item.name === name);
      const avatarClass = friend?.avatar || 'story-noor';
      const letter = friend?.letter || name.slice(0, 1);
      conversation.dataset.name = name;
      conversation.dataset.letter = letter;
      conversation.dataset.class = avatarClass;
      conversation.dataset.category = 'private contacts';
      conversation.dataset.unread = 'false';
      conversation.dataset.pinned = 'false';
      conversation.innerHTML = `<span class="avatar ${escapeText(avatarClass)}">${escapeText(letter)}</span><span class="conversation-details"><strong data-user-content="true">${escapeText(name)}</strong><span>${txt('ابدئي محادثة جديدة', 'Start a new conversation')}</span></span><span class="conversation-meta"><time>${txt('الآن', 'Now')}</time></span>`;
      $('#conversation-list').prepend(conversation);
      messageHistory.set(name, []);
      conversation.addEventListener('click', () => renderChat(name, avatarClass));
      applyMessageFilters();
    }
    renderChat(name, conversation.dataset.class || '');
  };

  $$('.conversation').forEach((conversation) => conversation.addEventListener('click', () => renderChat(conversation.dataset.name, conversation.dataset.class)));
  $$('[data-chat-open]').forEach((button) => button.addEventListener('click', () => openChatByName(button.dataset.chatOpen)));
  $('#start-chat').addEventListener('click', () => backendSessionActive
    ? (setView('friends'), showToast(txt('ابحثي عن صديق باسم المستخدم لبدء محادثة.', 'Search for a friend by username to start a chat.')))
    : openChatByName('نور إبراهيم'));
  $('#new-message').addEventListener('click', () => {
    if (backendSessionActive) {
      setView('friends');
      showToast(txt('ابحثي عن صديق مقبول باسم المستخدم، ثم ابدئي المحادثة من بطاقته.', 'Find an accepted friend by username and start a chat from their card.'));
      return;
    }
    setView('messages');
    activeMessageFilter = 'contacts';
    $$('.message-filters [data-message-filter]').forEach((button) => button.classList.toggle('selected', button.dataset.messageFilter === activeMessageFilter));
    applyMessageFilters();
    showToast(txt('اختاري صديقًا من قائمة جهات الاتصال لبدء محادثة.', 'Choose a friend from your contacts to start a conversation.'));
  });

  const groupAction = document.createElement('button');
  groupAction.type = 'button';
  groupAction.className = 'outline-button group-create-action';
  groupAction.innerHTML = `<span aria-hidden="true">＋</span> ${txt('جروب جديد', 'New group')}`;
  $('#new-message').before(groupAction);
  const groupSettingsButton = document.createElement('button');
  groupSettingsButton.type = 'button';
  groupSettingsButton.className = 'chat-tool group-settings-action';
  groupSettingsButton.setAttribute('aria-label', txt('إعدادات الجروب', 'Group settings'));
  groupSettingsButton.textContent = '⚙';
  groupSettingsButton.hidden = true;
  $('.chat-header').append(groupSettingsButton);
  const messageSecurityNote = document.createElement('div');
  messageSecurityNote.className = 'chat-security-note';
  messageSecurityNote.dataset.localeAr = 'التشفير التام بين الطرفين غير مفعّل بعد؛ يمكن للخادم قراءة نص الرسائل المحفوظة.';
  messageSecurityNote.dataset.localeEn = 'End-to-end encryption is not active yet; the server can read stored message text.';
  messageSecurityNote.textContent = currentLocale === 'ar' ? messageSecurityNote.dataset.localeAr : messageSecurityNote.dataset.localeEn;
  $('.chat-header').after(messageSecurityNote);

  const createGroupModal = () => {
    let modal = $('#group-modal');
    const created = !modal;
    if (!modal) modal = document.createElement('div');
    modal.id = 'group-modal';
    modal.className = 'modal';
    modal.hidden = true;
    modal.innerHTML = `<button class="modal-close" type="button" aria-label="${txt('إغلاق', 'Close')}">×</button><form class="simple-modal-content group-modal-content" id="group-form"><span class="modal-sparkle">👥</span><h2 id="group-modal-title"></h2><p id="group-modal-copy"></p><label for="group-name">${txt('اسم الجروب', 'Group name')}</label><input id="group-name" maxlength="80" required><label for="group-description">${txt('الوصف', 'Description')}</label><textarea id="group-description" maxlength="500" rows="2"></textarea><label for="group-members">${txt('إضافة أصدقاء عبر اسم المستخدم', 'Add friends by username')}</label><input id="group-members" placeholder="name.one, name.two"><small class="setting-hint">${txt('اختياري؛ أضيفي أسماء المستخدمين مفصولة بفواصل. يجب أن يكونوا أصدقاء مقبولين.', 'Optional, comma-separated usernames. They must be accepted friends.')}</small><label for="group-visibility">${txt('خصوصية الجروب', 'Group privacy')}</label><select id="group-visibility"><option value="private">${txt('خاص', 'Private')}</option><option value="public">${txt('عام', 'Public')}</option></select><label for="group-join-mode">${txt('طريقة الانضمام', 'How people can join')}</label><select id="group-join-mode"><option value="invite">${txt('برابط دعوة', 'Invite link')}</option><option value="request">${txt('طلب انضمام بموافقة مشرف', 'Request approval')}</option><option value="open">${txt('انضمام مباشر', 'Open joining')}</option></select><label class="report-consent group-forward-setting"><input id="group-forwarding" type="checkbox" checked><span>${txt('السماح بإعادة توجيه الرسائل', 'Allow message forwarding')}</span></label><div class="group-manage-area" id="group-manage-area" hidden></div><button class="primary-button" id="group-save" type="submit"></button><div class="group-invite-result" id="group-invite-result" hidden><label for="group-invite-link">${txt('رابط الانضمام', 'Invite link')}</label><div class="username-entry"><input id="group-invite-link" readonly><button class="outline-button" id="copy-group-invite" type="button">${txt('نسخ', 'Copy')}</button></div></div></form>`;
    if (created) {
      document.body.append(modal);
      modal.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
    }
    $('.modal-close', modal).addEventListener('click', () => { modal.hidden = true; });
    return modal;
  };
  const groupInviteUrl = (token) => `${location.origin}${location.pathname}?join=${encodeURIComponent(token)}`;
  const openGroupModal = async (mode, group = null) => {
    const modal = createGroupModal();
    const editing = mode === 'edit';
    const form = $('#group-form', modal);
    $('#group-modal-title', modal).textContent = editing ? txt('إعدادات الجروب', 'Group settings') : txt('إنشاء جروب', 'Create a group');
    $('#group-modal-copy', modal).textContent = editing ? txt('تحكّم بالخصوصية والرابط والصلاحيات.', 'Manage privacy, joining, and group permissions.') : txt('ابدأ مجموعة للأصدقاء وحدد طريقة الانضمام.', 'Start a group for friends and choose how people can join.');
    $('#group-save', modal).textContent = editing ? txt('حفظ الإعدادات', 'Save settings') : txt('إنشاء الجروب', 'Create group');
    $('#group-name', modal).value = group?.dataset.name || '';
    $('#group-description', modal).value = group?.dataset.description || '';
    $('#group-members', modal).value = '';
    $('#group-members', modal).hidden = editing;
    $('#group-visibility', modal).value = group?.dataset.visibility || 'private';
    $('#group-join-mode', modal).value = group?.dataset.joinMode || 'invite';
    $('#group-forwarding', modal).checked = group?.dataset.allowForwarding !== 'false';
    $('#group-visibility', modal).disabled = editing && !['owner', 'admin'].includes(group?.dataset.role);
    $('#group-join-mode', modal).disabled = $('#group-visibility', modal).disabled;
    $('#group-forwarding', modal).disabled = $('#group-visibility', modal).disabled;
    $('#group-name', modal).readOnly = editing && !['owner', 'admin'].includes(group?.dataset.role);
    $('#group-description', modal).readOnly = $('#group-name', modal).readOnly;
    $('#group-manage-area', modal).hidden = !editing;
    $('#group-invite-result', modal).hidden = true;
    if (editing) {
      if (group.dataset.inviteToken) {
        $('#group-invite-link', modal).value = groupInviteUrl(group.dataset.inviteToken);
        $('#group-invite-result', modal).hidden = false;
      }
      try {
        const { members } = await apiRequest(`/api/conversations/${group.dataset.backendId}/members`);
        const canPromote = group.dataset.role === 'owner';
        const area = $('#group-manage-area', modal);
        area.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = txt('الأعضاء والصلاحيات', 'Members and roles');
        area.append(title);
        members.forEach((member) => {
          const row = document.createElement('label');
          row.className = 'group-member-row';
          const memberName = document.createElement('span');
          memberName.textContent = `${member.display_name} · @${member.username}`;
          row.append(memberName);
          if (canPromote && member.role !== 'owner') {
            const role = document.createElement('select');
            role.setAttribute('aria-label', `${txt('صلاحية', 'Role')} ${member.username}`);
            role.innerHTML = `<option value="member">${txt('عضو', 'Member')}</option><option value="admin">${txt('مشرف', 'Admin')}</option>`;
            role.value = member.role;
            role.addEventListener('change', async () => {
              try {
                await apiRequest(`/api/conversations/${group.dataset.backendId}/members/${encodeURIComponent(member.username)}/role`, { method: 'PATCH', body: JSON.stringify({ role: role.value }) });
                showToast(txt('تم تحديث صلاحية العضو.', 'Member role updated.'));
              } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
            });
            row.append(role);
          } else {
            const roleName = document.createElement('small');
            roleName.textContent = member.role === 'owner' ? txt('المالك', 'Owner') : member.role === 'admin' ? txt('مشرف', 'Admin') : txt('عضو', 'Member');
            row.append(roleName);
          }
          area.append(row);
        });
        if (['owner', 'admin'].includes(group.dataset.role)) {
          const { requests } = await apiRequest(`/api/conversations/${group.dataset.backendId}/join-requests`);
          if (requests.length) {
            const requestHeading = document.createElement('strong');
            requestHeading.textContent = txt('طلبات الانضمام', 'Join requests');
            area.append(requestHeading);
            requests.forEach((request) => {
              const row = document.createElement('div');
              row.className = 'group-member-row';
              const who = document.createElement('span');
              who.textContent = request.username ? `@${request.username}` : txt('طلب جديد', 'New request');
              row.append(who);
              ['accept', 'decline'].forEach((decision) => {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'outline-button group-request-action';
                action.textContent = decision === 'accept' ? txt('قبول', 'Accept') : txt('رفض', 'Decline');
                action.addEventListener('click', async () => {
                  try {
                    await apiRequest(`/api/conversations/${group.dataset.backendId}/join-requests/${request.id}`, { method: 'POST', body: JSON.stringify({ accept: decision === 'accept' }) });
                    row.remove();
                    showToast(txt('تمت مراجعة الطلب.', 'Request reviewed.'));
                  } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
                });
                row.append(action);
              });
              area.append(row);
            });
          }
        }
        if (group.dataset.role === 'owner') {
          const rotate = document.createElement('button');
          rotate.type = 'button';
          rotate.className = 'outline-button';
          rotate.textContent = txt('إنشاء رابط دعوة جديد وإبطال القديم', 'Create a new invite link and revoke the old one');
          rotate.addEventListener('click', async () => {
            try {
              const result = await apiRequest(`/api/conversations/${group.dataset.backendId}/settings`, { method: 'PATCH', body: JSON.stringify({ rotateInviteLink: true }) });
              group.dataset.inviteToken = result.group.invite_token;
              $('#group-invite-link', modal).value = groupInviteUrl(result.group.invite_token);
              $('#group-invite-result', modal).hidden = false;
              showToast(txt('أُنشئ رابط جديد وأُبطل الرابط السابق.', 'A new link was created and the old link was revoked.'));
            } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
          });
          area.append(rotate);
        }
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const name = $('#group-name', modal).value.trim();
      if (!name) return;
      const payload = {
        title: name,
        description: $('#group-description', modal).value.trim(),
        visibility: $('#group-visibility', modal).value,
        joinMode: $('#group-join-mode', modal).value,
        allowForwarding: $('#group-forwarding', modal).checked,
      };
      try {
        if (editing) {
          const result = await apiRequest(`/api/conversations/${group.dataset.backendId}/settings`, { method: 'PATCH', body: JSON.stringify(payload) });
          await loadServerConversations();
          if (result.group.invite_token) {
            $('#group-invite-link', modal).value = groupInviteUrl(result.group.invite_token);
            $('#group-invite-result', modal).hidden = false;
          }
          showToast(txt('حُفظت إعدادات الجروب.', 'Group settings saved.'));
        } else if (backendSessionActive) {
          const usernames = $('#group-members', modal).value.split(/[\s,;]+/).map((value) => value.trim().replace(/^@/, '')).filter(Boolean);
          const result = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ kind: 'group', ...payload, participantUsernames: usernames }) });
          await loadServerConversations();
          const link = groupInviteUrl(result.conversation.invite_token);
          $('#group-invite-link', modal).value = link;
          $('#group-invite-result', modal).hidden = false;
          $('#group-save', modal).disabled = true;
          $('#group-save', modal).textContent = txt('تم إنشاء الجروب', 'Group created');
          showToast(txt('أُنشئ الجروب وحُفظ على الخادم.', 'Group created and saved on the server.'));
        } else {
          const conversation = document.createElement('button');
          conversation.className = 'conversation';
          Object.assign(conversation.dataset, { name, letter: [...name][0] || 'G', class: 'story-noor', category: 'groups', unread: 'false', pinned: 'false', description: payload.description, visibility: payload.visibility, joinMode: payload.joinMode, allowForwarding: String(payload.allowForwarding), role: 'owner' });
          conversation.innerHTML = `<span class="avatar story-noor">${escapeText([...name][0] || 'G')}</span><span class="conversation-details"><strong>${escapeText(name)}</strong><span>${txt('جروب تجريبي', 'Preview group')}</span></span>`;
          $('#conversation-list').prepend(conversation);
          conversation.addEventListener('click', () => renderChat(name, 'story-noor'));
          showToast(txt('أُنشئ الجروب في المعاينة المحلية فقط.', 'Group created in the local preview only.'));
        }
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); return; }
      if (!editing) { if (!backendSessionActive) modal.hidden = true; renderChat(name, 'story-noor'); }
    };
    $('#copy-group-invite', modal).onclick = async () => {
      const input = $('#group-invite-link', modal);
      try { await navigator.clipboard.writeText(input.value); showToast(txt('نُسخ رابط الجروب.', 'Group link copied.')); }
      catch { input.select(); document.execCommand('copy'); showToast(txt('نُسخ رابط الجروب.', 'Group link copied.')); }
    };
    modal.hidden = false;
    if (!editing) $('#group-name', modal).focus();
  };
  groupAction.addEventListener('click', () => openGroupModal('create'));
  groupSettingsButton.addEventListener('click', () => {
    const active = $$('.conversation').find((item) => item.dataset.backendId === currentConversationId);
    if (active?.dataset.kind === 'group' || active?.dataset.category === 'groups') openGroupModal('edit', active);
  });
  const sendChatMessage = async () => {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text || !currentChat) {
      if (!currentChat) showToast('اختاري محادثة أولًا.');
      return;
    }
    const activeConversation = $$('.conversation').find((item) => item.dataset.name === currentChat);
    if (isMinorPreview && activeConversation?.dataset.category?.includes('strangers')) {
      showToast(txt('لا يمكنك الرد على طلبات الغرباء في وضع القاصر التجريبي.', 'You cannot reply to stranger requests in youth preview mode.'));
      return;
    }
    if (backendSessionActive) {
      if (!currentConversationId) {
        showToast(txt('اختاري محادثة خادمية أو ابدئي محادثة مع صديق مقبول.', 'Choose a server conversation or start one with an accepted friend.'));
        return;
      }
      try {
        await apiRequest(`/api/conversations/${currentConversationId}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
      } catch (error) { showToast(apiErrorMessage(error.apiCode)); return; }
    }
    const messages = messageHistory.get(currentChat) || [];
    messages.push({ from: 'mine', text });
    messageHistory.set(currentChat, messages);
    addMessage(text);
    input.value = '';
    const conversation = $$('.conversation').find((item) => item.dataset.name === currentChat);
    if (conversation) $('.conversation-details > span', conversation).textContent = text;
  };
  $('#send-message').addEventListener('click', sendChatMessage);
  $('#chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  const splitEmoji = (value) => {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(currentLocale, { granularity: 'grapheme' }).segment(value)].map((item) => item.segment);
    }
    // Keep the picker working in embedded browsers without Intl.Segmenter.
    return Array.from(value);
  };
  const emojiSets = [
    ['😊😀😃😄😁😆😅😂🤣🥲🥹☺️😊🙂🙃😉😌😍🥰😘😗😙😚😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔🫡🤐🤨😐😑😶🫥😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵‍💫🤯🤠🥳🥸😎🤓🧐'],
    ['👋🤚🖐️✋🖖🫱🫲🫳🫴👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆🖕👇☝️🫵👍👎✊👊🤛🤜👏🙌🫶🤲🙏✍️💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁️👅👄'],
    ['❤️🧡💛💚💙🩵💜🖤🩶🤍🤎💔❤️‍🔥❤️‍🩹❣️💕💞💓💗💖💘💝💟♥️💌💋💤💢💥💫💦💨🕳️💬🗨️🗯️💭'],
    ['🐵🐒🦍🦧🐶🐕🦮🐕‍🦺🐩🐺🦊🦝🐱🐈🐈‍⬛🦁🐯🐅🐆🐴🫎🫏🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿️🦫🦔🦇🐻🐻‍❄️🐨🐼🦥🦦🦨🦘🦡🐾'],
    ['🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🫒🥑🍆🥔🥕🌽🌶️🫑🥒🥬🥦🧄🧅🍄🥜🫘🌰🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍺🍻🥂🍷🥃🍸🍹🧋🧃🥤🧉🧊'],
    ['⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸️🥌🎿⛷️🏂🪂🏋️🤼🤸⛹️🤺🏇🧘🏄🏊🤽🚣🧗🚵🚴🏆🥇🥈🥉🏅🎖️🏵️🎗️🎫🎟️🎪🤹🎭🩰🎨🎬🎤🎧🎼🎹🥁🪘🎷🎺🪗🎸🪕🎻🪇'],
    ['🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🛻🚚🚛🚜🛵🏍️🛺🚲🛴🛹🛼🚏🛣️🛤️⛽🛞🚨🚥🚦🛑🚧⚓🛟⛵🚤🛳️⛴️🛥️🚢✈️🛩️🛫🛬🪂💺🚁🚟🚠🚡🛰️🚀🛸🌍🌎🌏🌐🗺️🧭🏔️⛰️🌋🗻🏕️🏖️🏜️🏝️🏞️🏟️🏛️🏗️🧱🪨🪵🛖🏘️🏚️🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩️🕋⛲⛺🌁🌃🏙️🌄🌅🌆🌇🌉🎠🎡🎢'],
    ['⌚📱📲💻⌨️🖥️🖨️🖱️🖲️🕹️🗜️💽💾💿📀📼📷📸📹🎥📽️🎞️📞☎️📟📠📺📻🎙️🎚️🎛️🧭⏱️⏲️⏰🕰️⌛⏳📡🔋🪫🔌💡🔦🕯️🪔🧯🛢️💸💵💴💶💷🪙💰💳🧾💎⚖️🪜🧰🪛🔧🔨⚒️🛠️⛏️🪚🔩⚙️🪤🧱🪝🧲🔫💣🧨🪓🔪🗡️⚔️🛡️🚬⚰️🪦⚱️🏺🪄🪅🎁🎈🎏🎀🪄🪩🪆🧸🪡🧵🪢🧶🧹🪣🧽🧼🪥🪒🧴🛁🛀🧻🪠🚽🚰🚿🛌🛏️🪑🛋️🪞🪟🛍️🛒🎃🎄🎆🎇🧨✨🎉🎊🎋🎍🎎🎐🎑🧧🎀🎁🎗️🎟️🎫'],
    ['😀😃😄😁😆😅😂🤣🥲🥹😊😇🙂🙃😉😍🥰😘😋😜🤪😎🥳😏😔😴😭😤😡🤯🥶🥵🤢🤮🤧🤠🤡👻💀☠️👽👾🤖🎃😺😸😹😻😼😽🙀😿😾'],
    ['🇺🇸🇬🇧🇨🇦🇦🇺🇳🇿🇮🇪🇫🇷🇩🇪🇪🇸🇮🇹🇵🇹🇳🇱🇧🇪🇨🇭🇦🇹🇸🇪🇳🇴🇩🇰🇫🇮🇮🇸🇵🇱🇺🇦🇷🇺🇹🇷🇸🇦🇦🇪🇶🇦🇰🇼🇧🇭🇴🇲🇾🇪🇪🇬🇲🇦🇩🇿🇹🇳🇱🇧🇯🇴🇮🇶🇵🇸🇮🇷🇮🇳🇵🇰🇧🇩🇯🇵🇰🇷🇨🇳🇹🇼🇭🇰🇹🇭🇻🇳🇵🇭🇮🇩🇲🇾🇸🇬🇿🇦🇳🇬🇰🇪🇧🇷🇦🇷🇲🇽🇨🇱🇨🇴🇵🇪🇯🇲🇬🇷🇨🇾🇮🇱🇺🇳']
  ];
  let emojiTarget = null;
  const emojiPicker = document.createElement('div');
  emojiPicker.className = 'emoji-picker';
  emojiPicker.hidden = true;
  emojiPicker.setAttribute('role', 'dialog');
  emojiPicker.setAttribute('aria-label', txt('اختيار رمز تعبيري', 'Choose an emoji'));
  emojiSets.forEach((set, index) => {
    const section = document.createElement('div');
    section.className = 'emoji-section';
    const heading = document.createElement('strong');
    heading.textContent = [txt('وجوه', 'Faces'), txt('إيماءات', 'Gestures'), txt('قلوب', 'Hearts'), txt('حيوانات', 'Animals'), txt('طعام', 'Food'), txt('رياضة وفن', 'Sports & arts'), txt('سفر وأماكن', 'Travel & places'), txt('أدوات واحتفالات', 'Objects & celebrations'), txt('وجوه إضافية', 'More faces'), txt('أعلام', 'Flags')][index];
    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    splitEmoji(set).forEach((emoji) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'emoji-choice';
      button.textContent = emoji;
      button.setAttribute('aria-label', emoji);
      button.addEventListener('click', () => {
        if (!emojiTarget) return;
        const input = emojiTarget;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
        emojiPicker.hidden = true;
      });
      grid.append(button);
    });
    section.append(heading, grid);
    emojiPicker.append(section);
  });
  document.body.append(emojiPicker);
  const openEmojiPicker = (button, input) => {
    emojiTarget = input;
    const rect = button.getBoundingClientRect();
    emojiPicker.hidden = false;
    const width = Math.min(340, window.innerWidth - 24);
    emojiPicker.style.width = `${width}px`;
    emojiPicker.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    emojiPicker.style.top = `${Math.max(12, Math.min(rect.top - Math.min(320, emojiPicker.offsetHeight + 12), window.innerHeight - Math.min(380, emojiPicker.offsetHeight) - 12))}px`;
  };
  $('#chat-emoji').addEventListener('click', () => openEmojiPicker($('#chat-emoji'), $('#chat-input')));
  const addCommentEmojiButtons = (root = document) => {
    $$('.comment-entry', root).forEach((entry) => {
      if ($('.comment-emoji', entry)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comment-emoji';
      button.textContent = '😊';
      button.setAttribute('aria-label', txt('إضافة رمز تعبيري', 'Add emoji'));
      button.addEventListener('click', () => openEmojiPicker(button, $('input', entry)));
      $('.send-comment', entry)?.before(button);
    });
  };
  addCommentEmojiButtons();
  const commentEmojiObserver = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) addCommentEmojiButtons(node.matches?.('.comment-entry') ? node.parentElement || document : node);
  })));
  commentEmojiObserver.observe($('#feed-list'), { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (!emojiPicker.hidden && !emojiPicker.contains(event.target) && !event.target.closest('#chat-emoji, .comment-emoji')) emojiPicker.hidden = true;
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') emojiPicker.hidden = true; });
  $('#attach-chat').addEventListener('click', () => $('#chat-file-input').click());
  $('#chat-file-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!validateFile(file, 'chat')) { event.currentTarget.value = ''; return; }
    if (!currentChat) {
      showToast('اختاري محادثة قبل إرفاق ملف.');
      return;
    }
    if (backendSessionActive) {
      showToast(txt('إرسال المرفقات سيُتاح بعد تفعيل فحص الملفات الآمن.', 'Attachments will be enabled after secure file scanning is connected.'));
      event.currentTarget.value = '';
      return;
    }
    const messages = messageHistory.get(currentChat) || [];
    const upload = { file, url: mediaExtensions.has(extensionOf(file)) && !documentExtensions.has(extensionOf(file)) ? addObjectUrl(file) : '' };
    messages.push({ from: 'mine', file: upload });
    messageHistory.set(currentChat, messages);
    addMessage('', 'mine', upload);
    showToast('أُرفق الملف في المحادثة التجريبية فقط.');
    event.currentTarget.value = '';
  });

  const applyMessageFilters = () => {
    const query = $('#chat-search').value.trim().toLocaleLowerCase('ar');
    $$('.conversation').forEach((conversation) => {
      const category = (conversation.dataset.category || '').split(/\s+/);
      const matchesFilter = activeMessageFilter === 'all'
        || (activeMessageFilter === 'unread' ? conversation.dataset.unread === 'true'
          : activeMessageFilter === 'pinned' ? conversation.dataset.pinned === 'true'
            : category.includes(activeMessageFilter));
      const matchesQuery = !query || `${conversation.dataset.name} ${$('.conversation-details strong', conversation)?.textContent || ''}`.toLocaleLowerCase('ar').includes(query);
      conversation.hidden = !matchesFilter || !matchesQuery;
    });
  };
  $('#chat-search').addEventListener('input', applyMessageFilters);
  $$('.message-filters [data-message-filter]').forEach((button) => button.addEventListener('click', () => {
    activeMessageFilter = button.dataset.messageFilter;
    $$('.message-filters [data-message-filter]').forEach((tab) => tab.classList.toggle('selected', tab === button));
    applyMessageFilters();
  }));
  $('.notification-button').addEventListener('click', () => showToast(txt('لا توجد إشعارات جديدة.', 'There are no new notifications.')));
  $('#edit-profile').addEventListener('click', () => {
    $('#edit-profile-name').value = $('#profile-user-name').textContent;
    $('#edit-profile-username').value = $('#profile-handle').textContent.replace(/^@/, '');
    $('#edit-profile-bio').value = $('#profile-bio').textContent;
    $('#profile-edit-modal').hidden = false;
    translatePage(currentLocale);
    $('#edit-profile-name').focus();
  });
  $('#profile-edit-photo-input').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      showToast(txt('اختاري صورة JPG أو PNG أو WebP لا تتجاوز ٨ ميغابايت.', 'Choose a JPG, PNG, or WebP image up to 8 MB.'));
      event.currentTarget.value = '';
      return;
    }
    if (profilePhotoUrl) { URL.revokeObjectURL(profilePhotoUrl); objectUrls.delete(profilePhotoUrl); }
    profilePhotoUrl = URL.createObjectURL(file);
    objectUrls.add(profilePhotoUrl);
    $('#edit-profile-photo-placeholder').style.background = `center / cover no-repeat url("${profilePhotoUrl}")`;
    $('#edit-profile-photo-placeholder').textContent = '';
  });
  $('#profile-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#edit-profile-name').value.trim();
    const username = $('#edit-profile-username').value.trim().replace(/^@/, '');
    if (!name || !/^[A-Za-z0-9._]{3,24}$/.test(username)) {
      showToast(txt('أدخلي اسمًا واسم مستخدم صحيحًا من ٣ إلى ٢٤ حرفًا.', 'Enter a name and a valid 3–24 character username.'));
      return;
    }
    if (backendSessionActive) {
      try {
        await apiRequest('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: name, username, bio: $('#edit-profile-bio').value.trim(), visibility: $('#private-account').checked ? 'private' : 'public' }) });
      } catch (error) {
        showToast(apiErrorMessage(error.apiCode));
        return;
      }
    }
    $('#profile-user-name').textContent = name;
    $('#profile-user-name').dataset.userContent = 'true';
    $('#profile-handle').textContent = `@${username}`;
    $('#profile-handle').dataset.userContent = 'true';
    $('#profile-bio').textContent = $('#edit-profile-bio').value.trim();
    $('#profile-bio').dataset.userContent = 'true';
    $('#profile-feed-heading').textContent = currentLocale === 'ar' ? `منشورات ${name}` : `Posts by ${name}`;
    $('.mini-profile > span:last-child').textContent = name;
    $('.mini-profile > span:last-child').dataset.userContent = 'true';
    $('.mini-profile .avatar').textContent = [...name][0] || 'C';
    $('#profile-avatar').textContent = [...name][0] || 'C';
    if (profilePhotoUrl) {
      $('#profile-avatar').style.background = `center / cover no-repeat url("${profilePhotoUrl}")`;
      $('.mini-profile .avatar').style.background = `center / cover no-repeat url("${profilePhotoUrl}")`;
    }
    $$('#feed-list .post .post-author strong').forEach((author) => { if (author.textContent === 'Mariam Khaled' || author.textContent === 'مريم خالد') author.textContent = name; });
    $('#profile-edit-modal').hidden = true;
    translatePage(currentLocale);
    showToast(txt('تم تحديث ملفك في المعاينة.', 'Your preview profile has been updated.'));
  });
  $('#change-phone').addEventListener('click', () => openSimpleModal('تغيير رقم الهاتف', 'يتطلب ذلك إعادة التحقق من الرقم القديم والجديد برسائل SMS عند توصيل خدمة الحسابات.'));
  $('#password-action').addEventListener('click', () => openSimpleModal('تغيير كلمة المرور', 'تغيير كلمة المرور وإبطال الجلسات الأخرى يحتاجان إلى خادم مصادقة آمن.'));
  $('#account-sessions').addEventListener('click', () => openSimpleModal('الأجهزة المتصلة', 'ستظهر هنا جلسات الحساب مع خيار تسجيل الخروج من أي جهاز. لا توجد جلسات حقيقية في المعاينة.'));
  $('#export-account').addEventListener('click', () => openSimpleModal('طلب نسخة بياناتك', 'سيقدم الإصدار الفعلي طلب تنزيل مؤمّنًا لبيانات الحساب والمنشورات والملفات.'));
  const clearLocalSession = () => {
    backendSessionActive = false;
    backendUserId = '';
    currentConversationId = '';
    currentChat = '';
    $('#app-shell').hidden = true;
    $('#auth-gate').hidden = false;
    $('#age-check-form').hidden = true;
    $('#minor-gate').hidden = true;
    $('#auth-form').hidden = false;
    $('#auth-switch').hidden = false;
    $('#otp-panel').hidden = true;
    $('#auth-phone').value = '';
    $('#auth-password').value = '';
    $('#otp-code').value = '';
    document.body.classList.remove('signed-in-preview');
    if (authMode !== 'login') $('#auth-mode-switch').click();
    $('#auth-phone').focus();
  };
  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.id = 'logout-account';
  logoutButton.className = 'outline-button';
  logoutButton.textContent = txt('تسجيل الخروج بأمان', 'Secure sign out');
  $('#account-sessions').after(logoutButton);
  logoutButton.addEventListener('click', async () => {
    try {
      if (backendSessionActive) await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
      clearLocalSession();
      showToast(txt('تم تسجيل الخروج وإبطال الجلسة.', 'Signed out and session revoked.'));
    } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
  });
  $('#deactivate-account').addEventListener('click', async () => {
    if (!backendSessionActive) { openSimpleModal('تعطيل مؤقت', 'يتطلب التعطيل الفعلي الاتصال بخدمة الحساب.'); return; }
    if (!window.confirm(txt('سيُخفى الحساب وتُنهى جلساته. يمكنك استعادته بالتحقق من رقمك وتعيين كلمة مرور جديدة. متابعة؟', 'This hides your account and revokes its sessions. You can restore it by verifying your phone and setting a new password. Continue?'))) return;
    try {
      await apiRequest('/api/account/deactivate', { method: 'POST', body: '{}' });
      clearLocalSession();
      showToast(txt('عُطّل الحساب مؤقتًا. استخدمي استعادة الحساب لتفعيله.', 'Account deactivated. Use account recovery to reactivate it.'));
    } catch (error) { showToast(apiErrorMessage(error.apiCode)); }
  });
  $('#delete-account').addEventListener('click', () => openSimpleModal('حذف الحساب', 'قبل الحذف الفعلي سيظهر تأكيد نهائي وتوضيح للبيانات التي ستُحذف ومدة الاحتفاظ القانونية. لا يُحذف شيء من هذه المعاينة.'));
  $('#private-account').addEventListener('change', async (event) => {
    if (backendSessionActive) {
      const user = { displayName: $('#profile-user-name').textContent, username: $('#profile-handle').textContent.replace(/^@/, ''), bio: $('#profile-bio').textContent, visibility: event.currentTarget.checked ? 'private' : 'public' };
      try {
        await apiRequest('/api/profile', { method: 'PATCH', body: JSON.stringify(user) });
      } catch (error) {
        event.currentTarget.checked = !event.currentTarget.checked;
        showToast(apiErrorMessage(error.apiCode));
        return;
      }
    }
    const publicOption = $('#post-audience').querySelector('option[value="public"]');
    publicOption.disabled = event.currentTarget.checked;
    if (event.currentTarget.checked) $('#post-audience').value = 'friends';
    showToast(backendSessionActive
      ? (event.currentTarget.checked ? txt('أصبح ملفك خاصًا.', 'Your profile is now private.') : txt('أصبح ملفك عامًا.', 'Your profile is now public.'))
      : (event.currentTarget.checked ? 'المعاينة تعرض إعداد الحساب الخاص.' : 'المعاينة تعرض إعداد الحساب العام.'));
  });
  $('#post-audience').querySelector('option[value="public"]').disabled = $('#private-account').checked;
  $('#backup-chats').addEventListener('click', () => {
    const archive = [...messageHistory.entries()].map(([name, messages]) => ({
      conversation: name,
      messages: messages.map((message) => ({
        sender: message.from,
        text: message.text || '',
        attachment: message.file ? (message.file.file?.name || message.file.name || '') : '',
      })),
    }));
    const blob = new Blob([JSON.stringify({ kind: 'chatwave-demo-chat-backup', savedAt: new Date().toISOString(), conversations: archive }, null, 2)], { type: 'application/json' });
    const url = addObjectUrl(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chatwave-demo-chat-backup.json';
    link.click();
    showToast(txt('نُزّلت نسخة محادثات المعاينة الحالية فقط.', 'Only the current preview conversations were downloaded.'));
  });
  $('#report-attachment').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    if (file && !validateFile(file, 'report')) event.currentTarget.value = '';
  });
  $('#report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const category = $('#report-category').value;
    const details = $('#report-details').value.trim();
    if (!category || !details) {
      showToast(txt('اختاري نوع البلاغ واكتبي تفاصيل المشكلة.', 'Choose a report category and describe the issue.'));
      return;
    }
    const confirmation = $('#report-confirmation');
    confirmation.textContent = txt('محاكاة: لم يُرسل البلاغ إلى الدعم ولم يُحفظ. عند ربط الخدمة سيُنشأ رقم متابعة ويصل إلى صندوق دعم ChatWave.', 'Preview only: this report was not sent or saved. When support is connected, you will receive a case number and it will go to the ChatWave support inbox.');
    confirmation.hidden = false;
  });

  if (!previewOnly) {
    backendProbe = apiRequest('/api/session').then(async (session) => {
      if (!session?.user) {
        previewOnly = true;
        showToast(txt('خدمة الحسابات غير متصلة؛ فُعّلت المعاينة المحلية.', 'Account services are unavailable; local preview is enabled.'));
        return;
      }
      const { user, counts = {} } = session;
      backendSessionActive = true;
      backendUserId = user.id;
      profilePostCount = Number(counts.posts || 0);
      profileVideoCount = Number(counts.videos || 0);
      $('#profile-friends-count').textContent = currentLocale === 'ar' ? arNumber.format(Number(counts.friends || 0)) : enNumber.format(Number(counts.friends || 0));
      $('#profile-posts-count').textContent = currentLocale === 'ar' ? arNumber.format(profilePostCount) : enNumber.format(profilePostCount);
      $('#profile-videos-count').textContent = currentLocale === 'ar' ? arNumber.format(profileVideoCount) : enNumber.format(profileVideoCount);
      $('#profile-user-name').textContent = user.display_name;
      $('#profile-user-name').dataset.userContent = 'true';
      $('#profile-handle').textContent = `@${user.username}`;
      $('#profile-handle').dataset.userContent = 'true';
      $('#profile-bio').textContent = user.bio || txt('مرحبًا بكم في عالمي على ChatWave.', 'Welcome to my world on ChatWave.');
      $('#profile-bio').dataset.userContent = 'true';
      $('.mini-profile > span:last-child').textContent = user.display_name;
      $('.mini-profile > span:last-child').dataset.userContent = 'true';
      $('.mini-profile .avatar').textContent = [...user.display_name][0] || 'C';
      $('#profile-avatar').textContent = [...user.display_name][0] || 'C';
      $('#private-account').checked = user.visibility === 'private';
      $('#post-audience option[value="public"]').disabled = user.visibility === 'private';
      $('#auth-gate').hidden = true;
      $('#app-shell').hidden = false;
      document.body.classList.add('signed-in-preview');
      setView('home');
      setSidebarCollapsed(true);
      translatePage(currentLocale);
      loadServerPosts();
      loadServerConversations();
      await loadServerChannels();
      await processPendingLinks();
    }).catch((error) => {
      if (error.apiCode === 'api_unavailable' || [404, 500, 502, 503, 504].includes(error.status) || !error.status) {
        previewOnly = true;
        showToast(txt('خدمة الحسابات غير متصلة؛ فُعّلت المعاينة المحلية.', 'Account services are unavailable; local preview is enabled.'));
      }
    });
  }

  window.addEventListener('beforeunload', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  window.chatwaveReady = true;
})();
