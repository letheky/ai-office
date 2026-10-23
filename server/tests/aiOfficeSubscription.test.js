const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codexSubscription, claudeSubscription, normalizeSubscription } = require('../scripts/ai-office-subscription');
const { normalizeUsage } = require('../src/services/aiOfficeQuota');
const { readUsage } = require('../scripts/ai-office-usage');
const now = Date.now();
const end = Math.floor(now / 1000) + 86400;
const authWith = claims => ({ tokens: { id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` } });
test('only explicit ChatGPT entitlement end determines subscription expiration', () => {
  const auth = authWith({ exp: 1, 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_subscription_active_until: new Date(end * 1000).toISOString() } });
  const active = codexSubscription(auth, null, null, now);
  assert.equal(active.plan, 'plus'); assert.equal(active.validUntil, end); assert.equal(active.status, 'active');
  assert.equal(active.renewsAt, null);
  const expired = codexSubscription(authWith({ 'https://api.openai.com/auth': { chatgpt_subscription_active_until: 1 } }), null, null, now);
  assert.equal(expired.status, 'expired');
  const unknown = codexSubscription(authWith({ exp: end }), { rateLimits: { planType: 'plus', primary: { resetsAt: end } }, rateLimitResetCredits: { credits: [{ expiresAt: end }] } }, null, now);
  assert.equal(unknown.plan, 'plus'); assert.equal(unknown.validUntil, null); assert.equal(unknown.status, 'unknown');
});
test('Claude credential/profile expiry and status do not imply entitlement end', () => {
  const sub = claudeSubscription({ claudeAiOauth: { subscriptionType: 'max', expiresAt: end * 1000 } }, { organization: { subscription_status: 'active', created_at: end, expires_at: end } }, now);
  assert.equal(sub.plan, 'max'); assert.equal(sub.validUntil, null); assert.equal(sub.status, 'active');
  assert.equal(claudeSubscription({ claudeAiOauth: { subscriptionType: 'pro', expiresAt: end * 1000 } }, null, now).status, 'unknown');
  assert.equal(codexSubscription(null, null, { account: { planType: 'team' } }, now).plan, 'team');
});
test('malformed, null and stale metadata stays unknown, strips nested secrets', () => {
  for (const input of [null, {}, { tokens: { id_token: 'bad' } }, { tokens: { id_token: 42 } }]) {
    assert.equal(codexSubscription(input, null, null, now).status, 'unknown');
  }
  assert.equal(normalizeSubscription({ validUntil: end, checkedAt: now, source: 'untrusted' }, now).validUntil, null);
  const stale = normalizeSubscription({ plan: 'plus', validUntil: end, checkedAt: now - 300001, source: 'codex-auth', status: 'active' }, now);
  assert.equal(stale.status, 'unknown'); assert.equal(stale.validUntil, end);
  const normalized = normalizeUsage({ codex: { checkedAt: now, windows: [], subscription: { plan: 'plus', source: 'codex-auth', validUntil: end, checkedAt: now, token: 'secret', email: 'private@example.com', note: 'secret' } } });
  assert.equal(JSON.stringify(normalized).includes('secret'), false);
  assert.equal(JSON.stringify(normalized).includes('private@example.com'), false);
  assert.equal(normalized.codex.subscription.status, 'active');
});
test('Claude plan metadata survives invalid CLI credentials without network usage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-subscription-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { subscriptionType: 'pro', expiresAt: end * 1000 } }));
  t.after(() => { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  const usage = await readUsage('claude', path.join(dir, 'missing-cli'));
  assert.equal(usage.status, 'unknown'); assert.equal(usage.subscription.plan, 'pro');
  assert.equal(usage.subscription.validUntil, null);
});
