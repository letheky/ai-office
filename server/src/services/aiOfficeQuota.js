const { normalizeSubscription } = require('../../scripts/ai-office-subscription');
function normalizeUsage(value) {
  const result = {};
  for (const provider of ['claude','codex']) {
    const u = value?.[provider]; if (!u || typeof u !== 'object') continue;
    result[provider] = { provider, checkedAt: Number.isFinite(u.checkedAt) ? u.checkedAt : null,
      status: u.status === 'ok' ? 'ok' : 'unknown',
      windows: (Array.isArray(u.windows) ? u.windows : []).slice(0,20).flatMap(w => {
        if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return [];
        const usedPercent = Math.max(0,Math.min(100,w.usedPercent));
        return [{ id:String(w.id || '').slice(0,80),label:String(w.label || '').slice(0,100),usedPercent,remainingPercent:100-usedPercent,
          resetsAt:Number.isFinite(w.resetsAt) ? w.resetsAt : null,windowMinutes:Number.isFinite(w.windowMinutes) ? w.windowMinutes : null }];
      }) };
    if (u.subscription && typeof u.subscription === 'object') result[provider].subscription = normalizeSubscription(u.subscription);
    const rc = u.resetCredits;
    if (provider === 'codex' && rc && typeof rc === 'object') result[provider].resetCredits = { available: Math.max(0, Math.min(20, Number(rc.available) || 0)),
      credits: (Array.isArray(rc.credits) ? rc.credits : []).slice(0, 10).filter(c => /^[\w-]{1,100}$/.test(c?.id || ''))
        .map(c => ({ id: c.id, title: String(c.title || '').slice(0, 80), resetType: String(c.resetType || '').slice(0, 40),
          expiresAt: Number.isFinite(c.expiresAt) ? c.expiresAt : null })) };
  }
  return result;
}
function usageOf(row) { try { return normalizeUsage(JSON.parse(row.usage_json || '{}')); } catch { return {}; } }
function quotaState(usage, model = '', now = Date.now()) {
  if (usage?.status !== 'ok' || !usage.checkedAt || usage.checkedAt > now + 60000 || now-usage.checkedAt > 300000) return { status:'unknown',remaining:null };
  const applicable = usage.windows.filter(w => {
    if (w.resetsAt && w.resetsAt*1000 <= now) return false;
    if (w.id === 'seven_day_sonnet') return /sonnet/.test(model);
    if (w.id === 'seven_day_opus') return /opus/.test(model);
    if (usage.provider === 'codex') return w.id.startsWith('codex:');
    return true;
  });
  if (!applicable.length) return {status:'unknown',remaining:null};
  const remaining = Math.min(...applicable.map(w=>w.remainingPercent));
  return {status:remaining<=0?'exhausted':remaining<=10?'low':'ready',remaining};
}
module.exports = { normalizeUsage, usageOf, quotaState };
