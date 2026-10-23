const { promptFor } = require('../../server/scripts/ai-office-prompt');
const { eventQueue } = require('../../server/src/services/aiOfficeLive');
const { listFolders } = require('../../server/scripts/ai-office-workspace');
const { answerSession, STOPPED } = require('../../server/scripts/ai-office-session');
const { readUsage, consumeResetCredit } = require('../../server/scripts/ai-office-usage');
const { discoverModels } = require('../../server/src/services/aiOfficeModels');
const { computerArgs } = require('./ai-office-computer');
const { browserExecution } = require('./ai-office-browser');
const { readTools, readProfile } = require('./ai-office-tools');
const { prepareProject, publishProject } = require('../../server/scripts/ai-office-project-run');
const { prepareDirectMedia, preparePreviousMedia, prepareDocuments, cleanupDirectMedia } = require('../../server/scripts/ai-office-direct-media');
const outputImages = require('../../server/scripts/ai-office-output-images');
// Local AI Office worker: CLI sessions stay on the selected local account.
// The VPS sends only the scoped brief and verified context for each job.
// Configuration is loaded only by scripts/runtime.js.
const { randomUUID } = require('crypto');
const { hostname } = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
const { subscriptionEnv, assertSubscription } = require('../../server/scripts/ai-office-cli');

const dataDir = process.env.AI_OFFICE_DATA_DIR ? path.resolve(process.env.AI_OFFICE_DATA_DIR) : path.join(__dirname, '../data');
// CLIs auto-load project instructions from the working directory and its parents.
// Keep general shop questions outside the repository; load app guides only when needed.
const workDir = path.join(dataDir, 'work');
const identityFile = path.join(dataDir, 'ai-office-machine.json');
fs.mkdirSync(workDir, { recursive: true });
let identity;
try { identity = JSON.parse(fs.readFileSync(identityFile, 'utf8')); } catch {}
if (!identity || !/^[a-f0-9-]{36}$/.test(identity.id || '')) {
  identity = { id: randomUUID() };
  fs.writeFileSync(identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
}
const name = (process.env.AI_OFFICE_MACHINE_NAME || hostname()).slice(0, 60);
const hostIdentity = { hostId: process.env.AI_OFFICE_HOST_ID || null, hostName: process.env.AI_OFFICE_HOST_NAME || hostname() };
const api = axios.create({
  baseURL: `${(process.env.AI_OFFICE_SERVER_URL || 'http://127.0.0.1:3010').replace(/\/$/, '')}/api/ai-office`,
  auth: { username: process.env.SYNC_USER, password: process.env.SYNC_PASS },
  timeout: 20000,
});
const bins = { claude: process.env.AI_OFFICE_CLAUDE_BIN || 'claude', codex: process.env.AI_OFFICE_CODEX_BIN || 'codex' };
const cliEnv = subscriptionEnv;
const enabledProviders = (process.env.AI_OFFICE_PROVIDERS || 'claude,codex').split(',');
const available = Object.entries(bins).filter(([provider, binary]) => {
  if (!enabledProviders.includes(provider)) return false;
  try { assertSubscription(binary, provider); } catch { return false; }
  const args = provider === 'codex' ? ['login', 'status'] : ['auth', 'status'];
  if (spawnSync(binary, args, { env: cliEnv(), windowsHide: true, timeout: 10000, stdio: 'ignore' }).status !== 0) return false;
  return true;
}).map(([provider]) => provider);
// A known subscription reset can pause this account while other accounts keep working.
const pausedUntil = Date.parse(process.env.AI_OFFICE_PAUSED_UNTIL || '') || 0;
const advertisedProviders = () => Date.now() < pausedUntil ? [] : available;
let usage = {};
let tools = {};
let profile = null;
async function refreshUsage() {
  const result = await Promise.all(available.map(async p => [p, await readUsage(p,bins[p])]));
  usage = Object.fromEntries(result);
}
let models = {};
const refreshModels = () => discoverModels().then(value => { models = value; }).catch(() => {});
refreshModels(); setInterval(refreshModels, 600000);
const heartbeatPayload = () => ({ id: identity.id, name, providers: advertisedProviders(), ...hostIdentity, usage, tools, profile, models, accountLabel:process.env.AI_OFFICE_ACCOUNT_LABEL || name });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


// Admin commands arrive with heartbeat replies. reset_credit redeems ONE free Codex
// reset with the server-issued idempotency key (a re-delivered command cannot redeem twice).
const runningCommands = new Set();
async function handleCommands(response) {
  for (const command of response?.data?.data?.commands || []) {
    if (runningCommands.has(command.id)) continue;
    runningCommands.add(command.id);
    let report;
    try {
      let outcome = 'refreshed', result = null;
      if (command.kind === 'browse_folders') { result = listFolders(command.payload?.path); outcome = 'folders'; }
      else if (command.kind === 'reset_credit') {
        if (!available.includes('codex')) throw new Error('Tài khoản này không có ChatGPT');
        outcome = await consumeResetCredit(bins.codex, command.payload);
        console.log(`[ai-office] Dùng lượt reset: ${outcome}`);
      }
      if(command.kind!=='browse_folders') await refreshUsage();
      report = { outcome, ...(result?{result}:{}) };
    } catch (error) { report = { error: String(error.message || error).slice(0, 300) }; }
    try {
      await api.post(`/worker/commands/${command.id}/result`, { machine: identity.id, ...report });
      await api.post('/worker/heartbeat', heartbeatPayload());
    } catch (error) { console.error(`[ai-office] Lệnh ${command.id}: ${error.message}`); }
    finally { runningCommands.delete(command.id); }
  }
}

async function sendResult(id, payload) {
  while (true) {
    try { await api.post(`/worker/jobs/${id}/result`, { machine: identity.id, ...payload }); return; }
    catch (error) {
      if (error.response?.status === 409) return;
      console.error(`[ai-office] Không gửi được kết quả ${id}: ${error.message}`);
      await sleep(5000);
    }
  }
}

async function main() {
  if (!process.env.SYNC_USER || !process.env.SYNC_PASS) throw new Error('Chạy npm run setup trước khi khởi động worker');
  if (!available.length) throw new Error('Claude và Codex CLI chưa đăng nhập trên máy này');
  await Promise.all([refreshUsage(), readTools().then(value => { tools = value; }), readProfile().then(value => { profile = value; })]);
  setInterval(() => refreshUsage().catch(() => {}), 120000);
  setInterval(() => readTools().then(value => { tools = value; }).catch(() => {}), 120000);
  console.log(`[ai-office] ${name} (${identity.id}) · ${available.join(', ')}`);
  await api.post('/worker/heartbeat', heartbeatPayload());
  await api.post('/worker/recover', { id: identity.id });
  setInterval(() => api.post('/worker/heartbeat', heartbeatPayload()).then(handleCommands)
    .catch(error => console.error(`[ai-office] Heartbeat: ${error.message}`)), 10000);
  while (true) {
    try {
      api.post('/worker/heartbeat', heartbeatPayload()).then(handleCommands).catch(() => {});
      const job = (await api.get('/worker/next', { params: { machine: identity.id } })).data.data;
      if (!job) { await sleep(2500); continue; }
      console.log(`[ai-office] Nhận ${job.id} (${job.provider})`);
      const events=eventQueue(), acks=[];
      try {
        const project = await prepareProject(job, dataDir).catch(error => {
          throw new Error(`Không tải được tệp dự án từ Drive chung: ${error.message}`);
        });
        const directImages = await prepareDirectMedia(job, dataDir, async id => {
          const response = await api.get(`/worker/jobs/${job.id}/media/${id}`, {
            params: { machine: identity.id }, responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024,
          });
          return Buffer.from(response.data);
        });
        const previousImages = await preparePreviousMedia(job, dataDir, async id => {
          const response = await api.get(`/worker/jobs/${job.id}/media/${id}`, {
            params: { machine: identity.id }, responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024,
          });
          return Buffer.from(response.data);
        });
        const documents = await prepareDocuments(job, dataDir, async (id, text) => {
          const response = await api.get(`/worker/jobs/${job.id}/media/${id}`, {
            params: { machine: identity.id, ...(text ? { format: 'text' } : {}) },
            responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024,
          });
          return Buffer.from(response.data);
        });
        const control = async () => (await api.post(`/worker/jobs/${job.id}/progress`, { machine: identity.id,consumeInputs:false })).data.data;
        let currentPhase = 'starting';
        let lastReportedPhase = null;
        const report = async () => {
          const phase = currentPhase;
          const sent=events.drain(),sentAcks=acks.splice(0);
          const payload = {events:sent,acks:sentAcks,...(phase === lastReportedPhase ? {} : { phase })};
          let result;
          try { result = (await api.post(`/worker/jobs/${job.id}/progress`, { machine: identity.id, ...payload })).data.data; }
          catch (error) { events.restore(sent);acks.unshift(...sentAcks);if ([404,409].includes(error.response?.status)) return { cancelRequested: true }; throw error; }
          lastReportedPhase = phase;
          return result;
        };
        const { result, execution } = await answerSession({ ...job, created_by: job.created_by }, {
          root: workDir, binary: bins[job.provider], toolArgs: computerArgs(job.provider, !!job.allow_files),
          wrap: (binary, args, env) => browserExecution(binary, args, !!job.allow_files, env, job),
          promptFor: input => promptFor(input, project, documents), images:[...(project?.images||[]),...directImages], previousImages,
          control: report, progress: phase => { currentPhase = phase; }, emit:events.emit, acknowledge:(id,status)=>{acks.push({id,status})},
        });
        if ((await control()).cancelRequested) throw new Error(STOPPED);
        if (!result) throw new Error('AI trả kết quả trống');
        const files = await publishProject(job, project);
        for (const source of outputImages.imagePaths(result)) {
          try {
            const info = fs.statSync(source);
            if (!info.isFile() || info.size > 20 * 1024 * 1024) continue;
            await api.put(`/worker/jobs/${job.id}/image`, fs.readFileSync(source), {
              params:{ machine:identity.id, path:source }, headers:{ 'Content-Type':'application/octet-stream' },
              timeout:120000, maxBodyLength:20 * 1024 * 1024,
            });
          } catch (error) { console.error(`[ai-office] Không chuyển được ảnh kết quả: ${error.message}`); }
        }
        await sendResult(job.id, { result, execution, files,events:events.drain(),acks });
      } catch (error) { await sendResult(job.id, { error: String(error.message || error).slice(0, 600),events:events.drain(),acks }); }
      finally { try { cleanupDirectMedia(job, dataDir); } catch (error) { console.error(`[ai-office] Dọn ảnh tạm: ${error.message}`); } }
    } catch (error) {
      console.error(`[ai-office] ${error.response?.status || ''} ${error.message}`);
      await sleep(10000);
    }
  }
}
main().catch(error => { console.error(`[ai-office] ${error.message}`); process.exit(1); });
