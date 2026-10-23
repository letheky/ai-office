// Read subscription usage only. Never start inference, buy credits or consume a reset.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { subscriptionEnv, assertSubscription } = require('./ai-office-cli');
const { codexSubscription, claudeSubscription } = require('./ai-office-subscription');
function readJson(filename) { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return null; } }
// One JSON-RPC call to the Codex app-server under this worker's CODEX_HOME.
function codexRpc(binary, method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { env: subscriptionEnv(), stdio: ['pipe','pipe','pipe'], windowsHide: true });
    let buffer = '', done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000); kill.unref();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Usage timeout')), 20000);
    const send = message => child.stdin.write(JSON.stringify(message)+'\n');
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('close', () => { if (!done) finish(new Error('Usage connection closed')); });
    child.stderr.resume();
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1000000) return finish(new Error('Usage response too large'));
      let i;
      while ((i=buffer.indexOf('\n'))>=0) {
        const line = buffer.slice(0,i); buffer = buffer.slice(i+1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        if (response.id === 1) {
          if (response.error) return finish(new Error('Usage initialization failed'));
          send({method:'initialized'}); send(params === undefined ? {id:2,method} : {id:2,method,params});
        } else if (response.id === 2) {
          return finish(response.error ? new Error(`Codex app-server: ${String(response.error.message || 'request failed').slice(0,200)}`) : null, response.result);
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'office_ai_usage',title:'Office AI usage',version:'1.0.0'}}});
  });
}
const codexLimits = binary => codexRpc(binary, 'account/rateLimits/read');
// Free "full reset" grants shown by Codex (read only here; redeeming is consumeResetCredit).
function resetCreditsOf(data) {
  const r = data?.rateLimitResetCredits;
  if (!r) return null;
  return { available: Number(r.availableCount) || 0, credits: (Array.isArray(r.credits) ? r.credits : []).filter(c => c?.status === 'available')
    .map(c => ({ id: c.id, title: c.title || null, resetType: c.resetType || null, expiresAt: c.expiresAt || null })) };
}
// Redeems ONE reset credit. Only ever called for an explicit admin command; the
// idempotency key makes a retried command safe (the backend redeems at most once).
async function consumeResetCredit(binary, { idempotencyKey, creditId }) {
  if (!/^[\w-]{8,100}$/.test(idempotencyKey || '')) throw new Error('Thiếu khoá chống dùng trùng');
  const result = await codexRpc(binary, 'account/rateLimitResetCredit/consume', { idempotencyKey, ...(creditId ? { creditId } : {}) });
  return String(result?.outcome || 'unknown');
}
function windowUsage(id, label, used, reset, minutes) {
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return { id, label, usedPercent: Math.min(100,Math.max(0,used)), remainingPercent: Math.max(0,Math.min(100,100-used)),
    resetsAt: typeof reset === 'number' ? reset : Number.isFinite(Date.parse(reset)) ? Math.floor(Date.parse(reset)/1000) : null,
    windowMinutes: minutes || null };
}
function fromCodex(data) {
  const buckets = { ...(data?.rateLimits ? { codex:data.rateLimits } : {}), ...data?.rateLimitsByLimitId };
  const windows = [];
  for (const [id,bucket] of Object.entries(buckets)) {
    for (const key of ['primary','secondary']) {
      const w = bucket?.[key]; if (!w) continue;
      const period = w.windowDurationMins >= 10080 ? 'Tuần' : w.windowDurationMins === 300 ? 'Phiên 5 giờ' : `Cửa sổ ${w.windowDurationMins || '?'} phút`;
      const value = windowUsage(`${id}:${key}`, `${bucket.limitName || id} · ${period}`, w.usedPercent, w.resetsAt, w.windowDurationMins);
      if (value) windows.push(value);
    }
  }
  return windows;
}
function fromClaude(data) {
  return [['five_hour','Phiên 5 giờ',300],['seven_day','Tuần',10080],['seven_day_sonnet','Tuần · Sonnet',10080],['seven_day_opus','Tuần · Opus',10080]]
    .map(([id,label,minutes]) => windowUsage(id,label,data?.[id]?.utilization,data?.[id]?.resets_at,minutes)).filter(Boolean);
}
async function readUsage(provider, binary) {
  const checkedAt = Date.now();
  const auth = provider === 'codex' ? readJson(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json')) : null;
  const credentials = provider === 'claude' ? readJson(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json')) : null;
  let subscription = provider === 'codex' ? codexSubscription(auth, null, null, checkedAt) : claudeSubscription(credentials, null, checkedAt);
  try {
    assertSubscription(binary,provider);
    let windows;
    let resetCredits = null;
    if (provider === 'codex') {
      let data = null, usageError = null;
      try { data = await codexLimits(binary); } catch (error) { usageError = error; }
      subscription = codexSubscription(auth, data, null, checkedAt);
      if (!subscription.plan) {
        try { subscription = codexSubscription(auth, data, await codexRpc(binary, 'account/read', { refreshToken: false }), checkedAt); } catch {}
      }
      if (usageError) throw usageError;
      windows = fromCodex(data); resetCredits = resetCreditsOf(data);
    }
    else {
      const token = credentials?.claudeAiOauth?.accessToken;
      if (!token) throw new Error('No subscription session');
      const headers = {Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20','User-Agent':'claude-code'};
      const [profileResult, usageResult] = await Promise.allSettled([
        fetch('https://api.anthropic.com/api/oauth/profile', { headers, signal:AbortSignal.timeout(15000) }).then(async response => response.ok ? response.json() : null),
        fetch('https://api.anthropic.com/api/oauth/usage', { headers, signal:AbortSignal.timeout(15000) }),
      ]);
      if (profileResult.status === 'fulfilled' && profileResult.value) subscription = claudeSubscription(credentials, profileResult.value, checkedAt);
      if (usageResult.status !== 'fulfilled') throw new Error('Subscription usage unavailable');
      const response = usageResult.value;
      if (!response.ok) throw new Error('Subscription usage unavailable');
      windows = fromClaude(await response.json());
    }
    return { provider, checkedAt, status: windows.length ? 'ok' : 'unknown', windows, subscription, ...(resetCredits ? { resetCredits } : {}) };
  } catch { return { provider, checkedAt, status:'unknown', windows:[], subscription, note:'Chưa đọc được hạn mức từ phiên đăng nhập' }; }
}
module.exports = { readUsage, fromClaude, fromCodex, resetCreditsOf, consumeResetCredit, codexRpc };
