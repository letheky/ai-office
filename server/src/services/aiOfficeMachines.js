const {usageOf,quotaState} = require('./aiOfficeQuota');
const { toolsOf, profileOf, machinePolicy } = require('./aiOfficeCapabilities');
const ONLINE_MS = 30000;
function modelsOf(row, provider) {
  try { return JSON.parse(row.models_json || '{}')[provider]?.map(model => model.id) || []; } catch { return []; }
}
function workerRows(db, machineId) {
  return db.prepare('SELECT * FROM ai_office_machines WHERE id=? OR host_id=? OR host_id=(SELECT host_id FROM ai_office_machines WHERE id=?)').all(machineId, machineId, machineId);
}
function machineList(db, now = Date.now()) {
  const groups = new Map();
  for (const row of db.prepare('SELECT * FROM ai_office_machines ORDER BY name').all()) {
    const id = row.host_id || row.id;
    if (!groups.has(id)) groups.set(id, { id, name: row.host_name || row.name, members: [] });
    const providers = JSON.parse(row.providers_json);
    groups.get(id).members.push({ id: row.id, label:row.account_label || row.name, usage:usageOf(row), tools:toolsOf(row), profile:profileOf(row), lastSeen:row.last_seen, providers, models:[...new Set(providers.flatMap(provider => modelsOf(row, provider)))], online: now - row.last_seen < ONLINE_MS });
  }
  return [...groups.values()].map(group => {
    const live = group.members.filter(m => m.online);
    const tools = {};
    const lastTools = {};
    for (const member of group.members) for (const [id, tool] of Object.entries(member.tools)) {
      if (!lastTools[id] || tool.checkedAt > lastTools[id].checkedAt) lastTools[id] = tool;
    }
    for (const member of live) for (const [id, tool] of Object.entries(member.tools)) {
      if (now - (tool.checkedAt || 0) > 300000) continue;
      if (!tools[id] || tool.checkedAt > tools[id].checkedAt) tools[id] = tool;
    }
    const profile = group.members.map(m => m.profile).filter(Boolean).sort((a,b) => (b.checkedAt || 0) - (a.checkedAt || 0))[0] || null;
    return { ...group, tools, lastTools, profile, lastSeen: Math.max(...group.members.map(m => m.lastSeen)),
      policy: machinePolicy(group.id, group.name), online: !!live.length, providers: [...new Set((live.length ? live : group.members).flatMap(m => m.providers))] };
  });
}
function connectedProviders(rows, now = Date.now()) {
  return [...new Set(rows.filter(r => now - r.last_seen < ONLINE_MS).flatMap(r => JSON.parse(r.providers_json).filter(p=>quotaState(usageOf(r)[p],'',now).status !== 'exhausted')))];
}
function chooseWorker(db, rows, provider, now = Date.now(), model = '') {
  const supported = rows.filter(row => !model || !modelsOf(row, provider).length || modelsOf(row, provider).includes(model));
  const eligible = supported.filter(row => now - row.last_seen < ONLINE_MS && JSON.parse(row.providers_json).includes(provider) && quotaState(usageOf(row)[provider],model,now).status !== 'exhausted');
  if (!eligible.length) throw new Error(supported.length ? 'Máy này chưa có kết nối AI đã chọn còn hạn mức và đang online' : `Model ${model} không có trên tài khoản AI đã chọn`);
  const load = db.prepare("SELECT count(*) n FROM ai_office_jobs WHERE executor=? AND status IN ('pending','running')");
  const last = db.prepare('SELECT max(created_at) t FROM ai_office_jobs WHERE executor=?');
  return eligible.map(row => ({ row, quota:quotaState(usageOf(row)[provider],model,now), load: load.get(row.id).n, last: last.get(row.id).t || '' }))
    .sort((a, b) => ({ready:0,unknown:1,low:2}[a.quota.status] - {ready:0,unknown:1,low:2}[b.quota.status]) || a.load - b.load || a.last.localeCompare(b.last) || a.row.id.localeCompare(b.row.id))[0].row.id;
}
module.exports = { workerRows, machineList, connectedProviders, chooseWorker, modelsOf };
