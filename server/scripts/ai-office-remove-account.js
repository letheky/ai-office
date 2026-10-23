const fs = require('fs');
const path = require('path');
const os = require('os');
const { TARGETS } = require('../src/services/aiOfficeAccountRemoval');
// Only the worker's configured profile is used. Request payloads never supply paths.
function removeAccount(db, config, row, env = process.env) {
  const payload = JSON.parse(row.payload_json || '{}');
  const target = TARGETS[payload.accountId];
  if (!target || target[0] !== config.workerId || target[1] !== row.provider || row.machine_id !== config.workerId || !config.providers.includes(row.provider))
    throw new Error('Lệnh gỡ không thuộc đúng tài khoản/provider của worker');
  const marker = db.prepare('SELECT * FROM ai_office_removed_accounts WHERE account_id=? AND command_id=? AND worker_id=? AND provider=?')
    .get(payload.accountId, row.id, config.workerId, row.provider);
  if (!marker) throw new Error('Không có xác nhận quản trị đã lưu cho lệnh gỡ');
  if (db.prepare("SELECT 1 FROM ai_office_jobs WHERE executor=? AND provider=? AND status='running'").get(config.workerId, row.provider))
    throw new Error('Tài khoản còn công việc đang chạy; chưa xóa phiên đăng nhập');
  const home = row.provider === 'codex' ? (env.CODEX_HOME || path.join(os.homedir(), '.codex')) : (env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const filename = path.join(path.resolve(home), row.provider === 'codex' ? 'auth.json' : '.credentials.json');
  try {
    if (fs.lstatSync(home).isSymbolicLink() || fs.lstatSync(filename).isSymbolicLink()) throw new Error('Không xóa hồ sơ đăng nhập qua liên kết tượng trưng');
    if (row.provider === 'codex') fs.unlinkSync(filename);
    else {
      const credentials = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (Object.hasOwn(credentials, 'claudeAiOauth')) {
        delete credentials.claudeAiOauth;
        const temp = `${filename}.remove-${row.id}`;
        try { fs.writeFileSync(temp, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, filename); }
        finally { try { fs.unlinkSync(temp); } catch {} }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Không gỡ được phiên đăng nhập VPS; tài khoản vẫn bị khóa nhận việc');
  }
  return 'removed';
}
module.exports = { removeAccount };
