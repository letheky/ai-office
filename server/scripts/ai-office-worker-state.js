const { STOPPED } = require('./ai-office-session');
const { advanceConversations } = require('../src/services/aiOfficeConversation');
const { isAccountRemoved } = require('../src/services/aiOfficeAccountRemoval');
// Every VPS account process shares the app DB, but owns only its exact executor.
function workerConfig(env = process.env) {
  const workerId = String(env.AI_OFFICE_WORKER_ID ?? 'vps').trim();
  if (!/^vps(?::[a-z0-9][a-z0-9-]{0,59})?$/.test(workerId)) throw new Error('AI_OFFICE_WORKER_ID phải là vps hoặc vps:<tài-khoản>');
  const providers = [...new Set(String(env.AI_OFFICE_PROVIDERS ?? 'claude,codex').split(',').map(p => p.trim()).filter(Boolean))];
  if (!providers.length || providers.some(p => !['claude', 'codex'].includes(p))) throw new Error('AI_OFFICE_PROVIDERS chỉ nhận claude,codex');
  const accountLabel = String(env.AI_OFFICE_ACCOUNT_LABEL || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 80);
  return { workerId, providers, accountLabel };
}

function workerState(db, { workerId, providers }) {
  const enabledProviders = () => providers.filter(p => !isAccountRemoved(db, `${workerId}:${p}`));
  const claim = db.transaction(() => {
    advanceConversations(db);
    const active = enabledProviders();
    if (!active.length) return null;
    const row = db.prepare(`SELECT * FROM ai_office_jobs WHERE status='pending' AND executor=?
      AND provider IN (${active.map(() => '?').join(',')}) ORDER BY created_at ASC LIMIT 1`).get(workerId, ...active);
    if (!row) return null;
    const update = db.prepare(`UPDATE ai_office_jobs SET status='running', started_at=CURRENT_TIMESTAMP
      WHERE id=? AND executor=? AND status='pending'`).run(row.id, workerId);
    return update.changes ? row : null;
  });
  return {
    claim, enabledProviders,
    cleanup: () => db.prepare(`UPDATE ai_office_jobs SET status='error', error='Worker khởi động lại trước khi xong',
      finished_at=CURRENT_TIMESTAMP WHERE status='running' AND executor=?`).run(workerId),
    done: (id, result, execution, files) => db.prepare(`UPDATE ai_office_jobs SET status=CASE WHEN cancel_requested=1 THEN 'error' ELSE 'done' END, error=CASE WHEN cancel_requested=1 THEN ? ELSE NULL END, result=CASE WHEN cancel_requested=1 THEN NULL ELSE ? END, execution_json=?, files_json=?, finished_at=CURRENT_TIMESTAMP
      WHERE id=? AND executor=? AND status='running'`).run(STOPPED, result, JSON.stringify(execution), JSON.stringify(files), id, workerId),
    fail: (id, error) => db.prepare(`UPDATE ai_office_jobs SET status='error', error=?, finished_at=CURRENT_TIMESTAMP
      WHERE id=? AND executor=? AND status='running'`).run(error, id, workerId),
    heartbeat: (usage, tools, profile, models) => {
      const filter = value => Object.fromEntries(Object.entries(value || {}).filter(([provider]) => enabledProviders().includes(provider)));
      return db.prepare(`INSERT INTO ai_office_worker_heartbeat(id, seen_at, usage_json,tools_json,profile_json,models_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at,usage_json=excluded.usage_json,tools_json=excluded.tools_json,profile_json=excluded.profile_json,models_json=excluded.models_json`)
      .run(workerId, Date.now(), JSON.stringify(filter(usage)), JSON.stringify(tools), JSON.stringify(profile), JSON.stringify(filter(models)));
    },
    commands: (now = Date.now()) => db.prepare(`SELECT * FROM ai_office_commands WHERE machine_id=? AND
      (status='pending' OR (status='sent' AND sent_at < ?)) AND (kind='remove_account' OR created_at > ?)`).all(workerId, now - 120000, now - 3600000)
      .filter(row => row.kind === 'remove_account' || !isAccountRemoved(db, `${workerId}:${row.provider}`)),
    sendCommand: id => db.prepare("UPDATE ai_office_commands SET status='sent', sent_at=? WHERE id=? AND machine_id=? AND status IN ('pending','sent')").run(Date.now(), id, workerId),
    finishCommand: (id, outcome, error) => db.prepare("UPDATE ai_office_commands SET status=?, outcome=?, error=?, finished_at=? WHERE id=? AND machine_id=? AND status='sent'")
      .run(error ? 'error' : 'done', error ? null : outcome, error, Date.now(), id, workerId),
  };
}

async function executeCommand(row, providers, { consumeResetCredit, codexBin, refreshUsage, heartbeat, removeAccount }) {
  let outcome = 'refreshed';
  if (row.kind === 'remove_account') {
    if (!removeAccount) throw new Error('Worker chưa hỗ trợ gỡ tài khoản');
    outcome = await removeAccount(row);
  } else if (row.kind === 'reset_credit') {
    if (!providers.includes('codex')) throw new Error('Worker này không bật tài khoản ChatGPT');
    outcome = await consumeResetCredit(codexBin, JSON.parse(row.payload_json || '{}'));
  } else if (row.kind !== 'refresh_usage') throw new Error('Lệnh worker không được hỗ trợ');
  await refreshUsage(); heartbeat();
  return outcome;
}

module.exports = { workerConfig, workerState, executeCommand };
