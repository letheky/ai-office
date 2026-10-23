// Entitlement metadata only. OAuth expiry and quota/reset expiry are unrelated.
const SOURCES = new Set(['codex-auth', 'codex-account', 'codex-rate-limits', 'claude-credentials', 'claude-profile']);
const UNKNOWN_NOTE = 'Nguồn đăng nhập chưa cung cấp ngày hết hạn gói';
function timestamp(value) {
  if (typeof value === 'string' && value.trim() && !/^\d+(\.\d+)?$/.test(value)) value = Date.parse(value) / 1000;
  else if (typeof value === 'string' && value.trim()) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (value > 1e12) value /= 1000;
  return value < 253402300800 ? Math.floor(value) : null;
}
function planName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9 _-]{0,39}$/i.test(value) ? value : null;
}
function normalizeSubscription(value, now = Date.now()) {
  const v = value && typeof value === 'object' ? value : {};
  const checkedAt = Number.isFinite(v.checkedAt) && v.checkedAt > 0 ? v.checkedAt : 0;
  const source = SOURCES.has(v.source) ? v.source : null;
  const validUntil = source ? timestamp(v.validUntil) : null;
  const sourceUpdatedAt = source ? timestamp(v.sourceUpdatedAt) : null;
  const fresh = checkedAt > 0 && checkedAt <= now + 60000 && now - checkedAt <= 300000 &&
    (!sourceUpdatedAt || (sourceUpdatedAt * 1000 <= now + 60000 && now - sourceUpdatedAt * 1000 <= 300000));
  const profileStatus = source === 'claude-profile' && ['active', 'expired'].includes(v.status) ? v.status : 'unknown';
  return { plan: planName(v.plan), validUntil, renewsAt: source ? timestamp(v.renewsAt) : null,
    status: fresh ? validUntil ? (validUntil * 1000 <= now ? 'expired' : 'active') : profileStatus : 'unknown',
    source, checkedAt, sourceUpdatedAt,
    note: !fresh && checkedAt ? 'Thông tin gói đã cũ; ngày hiệu lực lưu trong phiên có thể thay đổi khi gia hạn' : validUntil ? null : UNKNOWN_NOTE };
}
function codexSubscription(auth, limits, account, checkedAt = Date.now()) {
  let claims = {};
  try {
    const token = auth?.tokens?.id_token;
    if (typeof token === 'string' && token.length < 100000) claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {}
  const entitlement = claims?.['https://api.openai.com/auth'] || {};
  const plan = planName(limits?.rateLimits?.planType) || planName(limits?.planType) || planName(account?.account?.planType) || planName(entitlement.chatgpt_plan_type);
  const validUntil = timestamp(entitlement.chatgpt_subscription_active_until);
  const sourceUpdatedAt = timestamp(entitlement.chatgpt_subscription_last_checked);
  return normalizeSubscription({ plan, validUntil, renewsAt: null, checkedAt, sourceUpdatedAt,
    source: validUntil || planName(entitlement.chatgpt_plan_type) ? 'codex-auth' : planName(limits?.rateLimits?.planType) || planName(limits?.planType) ? 'codex-rate-limits' : account?.account ? 'codex-account' : null }, checkedAt);
}
function claudeSubscription(credentials, profile, checkedAt = Date.now()) {
  // OAuth profile exposes subscription status but does not guarantee an end date.
  // Do not turn status/creation time/credential expiresAt into a plan end date.
  return normalizeSubscription({ plan: planName(credentials?.claudeAiOauth?.subscriptionType),
    validUntil: null, renewsAt: null, checkedAt, status: profile?.organization?.subscription_status,
    source: profile ? 'claude-profile' : credentials?.claudeAiOauth ? 'claude-credentials' : null }, checkedAt);
}
module.exports = { normalizeSubscription, codexSubscription, claudeSubscription, timestamp };
