// Pure state mapping for the 3D "AI crew": one robot per AI account, driven only by data the
// office already polls (capabilities + jobs). No network, no DOM, so it can be tested in Node.
import { accountsOf, localMachines, isVpsExecutor } from './office-accounts.mjs';

const SESSION = new Set(['five_hour', 'codex:primary']);
const WEEKLY = new Set(['seven_day', 'codex:secondary']);
const FRESH_MS = 300000;
export const ERROR_MS = 30 * 60000;

// Same freshness rules as the server's quotaState: stale or missing data is "unknown", never "ready".
export function quotaOf(account, now = Date.now()) {
  const usage = account.usage?.[account.provider];
  const none = { known: false, session: null, week: null, resetsAt: null, lowest: null };
  if (!usage || usage.status !== 'ok' || !usage.checkedAt || usage.checkedAt > now + 60000 || now - usage.checkedAt > FRESH_MS) return none;
  const live = (usage.windows || []).filter(w => Number.isFinite(w.remainingPercent) && !(w.resetsAt && w.resetsAt * 1000 <= now));
  if (!live.length) return none;
  const pick = ids => live.filter(w => ids.has(w.id)).reduce((min, w) => (min === null ? w.remainingPercent : Math.min(min, w.remainingPercent)), null);
  const general = live.filter(w => !/^seven_day_(sonnet|opus)$/.test(w.id));
  const lowest = Math.min(...general.map(w => w.remainingPercent));
  const blocking = general.filter(w => w.remainingPercent <= 0 && w.resetsAt).map(w => w.resetsAt);
  return { known: true, session: pick(SESSION), week: pick(WEEKLY), lowest,
    resetsAt: blocking.length ? Math.max(...blocking) : null };
}

export function crewAccounts(capabilities = {}) {
  const vps = accountsOf(capabilities, 'vps').map(a => ({ ...a, host: 'VPS' }));
  const local = localMachines(capabilities).flatMap(machine =>
    accountsOf(capabilities, machine.id).map(a => ({ ...a, host: machine.name })));
  return [...local, ...vps].filter(a => !a.removalPending);
}

const mine = (job, account) => job.executor === (account.workerId || account.id)
  && (!job.provider || !account.provider || job.provider === account.provider);

// Priority: offline > error > working > exhausted > low > idle. A running job keeps "working" even
// at 0% because the CLI is still producing; a fresh failure outranks it only once the job ended.
export function crewState(account, jobs = [], now = Date.now()) {
  const q = quotaOf(account, now);
  const own = jobs.filter(job => mine(job, account));
  const running = own.find(job => job.status === 'running');
  const lastEnded = own.filter(job => job.status === 'done' || job.status === 'error')
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0];
  const failed = lastEnded?.status === 'error' && now - (lastEnded.finishedAt || 0) <= ERROR_MS ? lastEnded : null;
  let state = 'idle';
  if (!account.online) state = 'offline';
  else if (failed && !running) state = 'error';
  else if (running) state = 'working';
  else if (q.known && q.lowest <= 0) state = 'exhausted';
  else if (q.known && q.lowest <= 10) state = 'low';
  return { id: account.id, label: account.label || 'AI', host: account.host || '', provider: account.provider,
    state, quota: q, job: running || null, failed, workerId: account.workerId || account.id };
}

// One machine at a time: its AI accounts are shared by everything that runs there, so the office
// shows exactly those robots (3 accounts = 3 robots, 2 = 2). Without a machine id, all accounts.
export function machineAccounts(capabilities, machineId) {
  if (!machineId) return crewAccounts(capabilities);
  const host = isVpsExecutor(machineId) ? 'VPS' : localMachines(capabilities).find(m => m.id === machineId)?.name || '';
  return accountsOf(capabilities, machineId).filter(a => !a.removalPending).map(a => ({ ...a, host }));
}

export function crewSummary(capabilities, jobs, now = Date.now(), machineId = null) {
  return machineAccounts(capabilities, machineId).map(a => crewState(a, jobs, now));
}

// Seat, robot style and charging bay must not depend on heartbeat/API ordering.
// Use immutable account identity, never labels, quota or online status.
export function crewLayout(summary) {
  return [...summary].sort((a, b) => {
    const providerOrder = Number(b.provider === 'claude') - Number(a.provider === 'claude');
    if (providerOrder) return providerOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const clock = seconds => new Date(seconds * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const pct = v => (v === null || v === undefined ? '?' : `${Math.round(v)}%`);
const shorten = (text, n) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function crewCaption(s) {
  const quota = `Phiên ${pct(s.quota.session)} · Tuần ${pct(s.quota.week)}`;
  switch (s.state) {
    case 'offline': return { title: 'Ngoại tuyến', detail: 'Máy/worker không gửi tín hiệu' };
    case 'error': return { title: 'Gặp lỗi', detail: shorten(s.failed.error, 70) || 'Việc vừa rồi chưa làm được' };
    case 'working': return { title: 'Đang làm', detail: shorten(s.job.question, 60) };
    case 'exhausted': return { title: 'Hết hạn mức', detail: s.quota.resetsAt ? `Mở lại lúc ${clock(s.quota.resetsAt)} · ${quota}` : quota };
    case 'low': return { title: 'Sắp hết hạn mức', detail: quota };
    default: return { title: 'Sẵn sàng', detail: s.quota.known ? quota : 'Chưa đọc được hạn mức' };
  }
}

// Tiny speech bubble for a working robot, from the CLI phase the worker already reports (job.progress.phase).
const BUBBLES = { waiting_tool: 'chờ trình duyệt…', starting: 'mở phiên…', thinking: 'đang nghĩ…', tool: 'dùng công cụ…', writing: 'đang soạn…', saving: 'đang lưu…' };
export const crewBubble = s => (s.state === 'working' ? BUBBLES[s.job?.progress?.phase] || 'đang làm…' : '');

// Jobs waiting for one of this machine's accounts (pending or waiting), shown as paper on the manager's tray.
export function queuedCount(jobs = [], summary = []) {
  const workers = new Set(summary.map(s => s.workerId));
  return jobs.filter(job => (job.status === 'pending' || job.status === 'waiting') && workers.has(job.executor)).length;
}
