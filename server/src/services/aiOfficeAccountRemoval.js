// Persistent deny-list: heartbeats and worker restarts cannot re-enable removed accounts.
const TARGETS = { 'vps:claude': ['vps', 'claude'], 'vps:codex': ['vps', 'codex'], 'vps:chatgpt-1:codex': ['vps:chatgpt-1', 'codex'] };
const REMOVAL_ERROR = 'Tài khoản AI đã được gỡ khỏi VPS; chọn tài khoản khác để giao lại việc';
function removedAccounts(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_office_removed_accounts'").get()) return [];
  return db.prepare('SELECT * FROM ai_office_removed_accounts').all();
}
function isAccountRemoved(db, id) { return removedAccounts(db).some(a => a.account_id === id); }
function requestRemoval(db, accountId, username, commandId) {
  if (!TARGETS[accountId]) throw Object.assign(new Error('Chỉ gỡ tài khoản AI trên VPS đã định danh'), { status: 400 });
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM ai_office_removed_accounts WHERE account_id=?').get(accountId);
    if (previous) return { id: previous.command_id, accountId, status: db.prepare('SELECT status FROM ai_office_commands WHERE id=?').get(previous.command_id)?.status || 'error', existing: true };
    const [workerId, provider] = TARGETS[accountId];
    if (!db.prepare('SELECT 1 FROM ai_office_worker_heartbeat WHERE id=?').get(workerId)) throw Object.assign(new Error('Không thấy tài khoản trên VPS'), { status: 404 });
    if (db.prepare("SELECT 1 FROM ai_office_jobs WHERE executor=? AND provider=? AND status='running'").get(workerId, provider))
      throw Object.assign(new Error('Tài khoản đang chạy công việc; chờ hoàn tất rồi gỡ'), { status: 409 });
    db.prepare('INSERT INTO ai_office_removed_accounts(account_id,worker_id,provider,command_id,removed_by,removed_at) VALUES(?,?,?,?,?,?)')
      .run(accountId, workerId, provider, commandId, username, Date.now());
    let cancelledJobs = 0;
    const mark = db.prepare("UPDATE ai_office_jobs SET status='error',error=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','waiting')");
    const rows = db.prepare("SELECT * FROM ai_office_jobs WHERE status IN ('pending','waiting')").all();
    for (const job of rows) {
      let selection = {}; try { selection = JSON.parse(job.selection_json || '{}'); } catch {}
      if (job.plan_id && job.team_role !== 'plan') {
        try { selection = JSON.parse(db.prepare('SELECT selection_json FROM ai_office_jobs WHERE id=?').get(job.plan_id)?.selection_json || '{}'); } catch {}
      }
      const accountOnly = selection.accounts?.length && selection.accounts.every(id => isAccountRemoved(db, id));
      if ((job.status === 'pending' && job.executor === workerId && job.provider === provider) || accountOnly)
        cancelledJobs += mark.run(REMOVAL_ERROR, job.id).changes;
    }
    db.prepare("UPDATE ai_office_commands SET status='error',error=?,finished_at=? WHERE machine_id=? AND provider=? AND status IN ('pending','sent')")
      .run(REMOVAL_ERROR, Date.now(), workerId, provider);
    db.prepare("INSERT INTO ai_office_commands(id,machine_id,kind,provider,payload_json,created_by,created_at) VALUES(?,?,'remove_account',?,?,?,?)")
      .run(commandId, workerId, provider, JSON.stringify({ accountId }), username, Date.now());
    return { id: commandId, accountId, status: 'pending', cancelledJobs, existing: false };
  })();
}
module.exports = { TARGETS, REMOVAL_ERROR, removedAccounts, isAccountRemoved, requestRemoval };
