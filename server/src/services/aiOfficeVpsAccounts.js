const { removedAccounts } = require('./aiOfficeAccountRemoval');
// VPS accounts have independent CLI processes, quotas and queues. Never expose auth IDs.
const { usageOf, quotaState } = require('./aiOfficeQuota');
const { toolsOf, profileOf } = require('./aiOfficeCapabilities');
function json(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function vpsAccounts(db, now = Date.now(), includeRemoving = false) {
  const removed = removedAccounts(db);
  const removalState = new Map(removed.map(row => [row.account_id,
    db.prepare('SELECT status,error FROM ai_office_commands WHERE id=?').get(row.command_id) || { status: 'error' }]));
  return db.prepare("SELECT * FROM ai_office_worker_heartbeat WHERE id='vps' OR id LIKE 'vps:%'").all().flatMap(row => {
    const usage = usageOf(row);
    const providers = Object.keys(usage);
    // Old heartbeats without usage predate enabled-provider reporting.
    if (!providers.length) providers.push(...(row.id === 'vps' ? ['claude', 'codex'] : ['codex']));
    if (includeRemoving) for (const account of removed.filter(a => a.worker_id === row.id)) {
      if (!providers.includes(account.provider)) providers.push(account.provider);
    }
    const metadata = json(row.profile_json);
    return providers.filter(provider => {
      const state = removalState.get(`${row.id}:${provider}`);
      return !state || (includeRemoving && state.status !== 'done');
    }).map(provider => ({ id: `${row.id}:${provider}`, workerId: row.id, provider, providers: [provider],
      models: json(row.models_json)[provider]?.map(model => model.id) || [],
      ...(removalState.has(`${row.id}:${provider}`) ? { removalPending: true,
        removalStatus: removalState.get(`${row.id}:${provider}`).status,
        removalError: removalState.get(`${row.id}:${provider}`).error || null } : {}),
      label: provider === 'claude' ? 'Claude Pro' : (String(metadata.accountLabel || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60) || (row.id === 'vps' ? 'ChatGPT 2' : 'ChatGPT 1')),
      online: Number.isFinite(row.seen_at) && now - row.seen_at < 30000 && row.seen_at <= now + 60000,
      lastSeen: row.seen_at, usage: usage[provider] ? { [provider]: usage[provider] } : {},
      profile: profileOf(row), tools: toolsOf(row) }));
  });
}
function eligibleAccounts(accounts, provider, model = '', now = Date.now()) {
  return accounts.filter(a => a.online && !a.removalPending && a.provider === provider && (!model || !a.models?.length || a.models.includes(model)) && quotaState(a.usage[provider], model, now).status !== 'exhausted');
}
function chooseVpsAccount(db, accounts, provider, model = '', now = Date.now()) {
  const load = db.prepare("SELECT count(*) n FROM ai_office_jobs WHERE executor=? AND status IN ('pending','running')");
  const last = db.prepare('SELECT max(created_at) t FROM ai_office_jobs WHERE executor=?');
  const rank = { ready: 0, unknown: 1, low: 2 };
  const options = eligibleAccounts(accounts, provider, model, now).map(a => ({ ...a, load: load.get(a.workerId).n,
    last: String(last.get(a.workerId).t || ''), quota: quotaState(a.usage[provider], model, now) }));
  if (!options.length) {
    if (accounts.some(a => a.online && !a.removalPending && a.provider === provider && quotaState(a.usage[provider], model, now).status === 'exhausted'))
      throw new Error('AI đã hết hạn mức phiên hoặc tuần; hãy chọn AI khác hoặc chờ reset');
    throw new Error('VPS chưa có tài khoản AI đã chọn còn hạn mức và đang online');
  }
  return options.sort((a, b) => rank[a.quota.status] - rank[b.quota.status] || a.load - b.load || a.last.localeCompare(b.last) || a.id.localeCompare(b.id))[0];
}
module.exports = { vpsAccounts, eligibleAccounts, chooseVpsAccount };
