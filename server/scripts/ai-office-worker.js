const { promptFor } = require('./ai-office-prompt');
const { appendEvents, takeInputs, acknowledgeInput, closeInputs, eventQueue } = require('../src/services/aiOfficeLive');
const { answerSession, phases, STOPPED } = require('./ai-office-session');
const { prepareDirectMedia, preparePreviousMedia, prepareDocuments, cleanupDirectMedia } = require('./ai-office-direct-media');
const { removeAccount } = require('./ai-office-remove-account');
const { readUsage, consumeResetCredit } = require('./ai-office-usage');
const { workerConfig, workerState, executeCommand } = require('./ai-office-worker-state');
const { readTools, readProfile } = require('./ai-office-host');
const { discoverModels } = require('../src/services/aiOfficeModels');
const { prepareProject, publishProject } = require('./ai-office-project-run');
const media = require('../src/routes/aiOfficeMedia');
const outputImages = require('./ai-office-output-images');
// Run as a separate VPS service under the account authenticated to Claude/Codex.
// Admin jobs have CLI tools; member jobs receive scoped data without file tools.
const path = require('path');
const fs = require('fs');
const Database = require('../src/db/sqlite');

const DB_PATH = path.resolve(__dirname, '../data/office.db');
const WORK_ROOT = process.env.AI_OFFICE_WORK_ROOT || path.join(__dirname, '../../.runtime/work');
const CLAUDE_BIN = process.env.AI_OFFICE_CLAUDE_BIN || 'claude';
const CODEX_BIN = process.env.AI_OFFICE_CODEX_BIN || 'codex';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;


async function main() {
  const config = workerConfig();
  const db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  const state = workerState(db, config);
  let usage = {};
  let tools = {}, profile = null, models = {};
  const refreshModels = () => discoverModels(process.env, state.enabledProviders()).then(value => { models = value; }).catch(() => {});
  await refreshModels(); const modelsTimer = setInterval(refreshModels, 600000);
  let usageRefresh = null;
  const refreshUsage = () => {
    if (usageRefresh) return usageRefresh;
    usageRefresh = Promise.all(state.enabledProviders().map(async p => [p, await readUsage(p, p === 'codex' ? CODEX_BIN : CLAUDE_BIN)]))
      .then(entries => { usage = Object.fromEntries(entries); }).finally(() => { usageRefresh = null; });
    return usageRefresh;
  };
  await Promise.all([refreshUsage(), readTools().then(value => { tools = value; }), readProfile().then(value => { profile = value; })]);
  const usageTimer = setInterval(() => refreshUsage().catch(() => {}),120000);
  const toolsTimer = setInterval(() => readTools().then(value => { tools = value; }).catch(() => {}),120000);
  const heartbeat = () => state.heartbeat(usage, tools, { ...profile, ...(config.accountLabel ? { accountLabel: config.accountLabel } : {}) }, models);
  heartbeat();
  const heartbeatTimer = setInterval(() => {
    try { heartbeat(); } catch (error) { console.error(`[ai-office] heartbeat: ${error.message}`); }
  }, 10000);
  state.cleanup();
  // Admin commands for the VPS accounts (see routes/aiOffice.js takeCommands).
  let lastCommandCheck = 0;
  const runCommands = async () => {
    if (Date.now() - lastCommandCheck < 4000) return;
    lastCommandCheck = Date.now();
    const rows = state.commands();
    for (const row of rows) {
      if (!state.sendCommand(row.id).changes) continue;
      let outcome = 'refreshed', error = null;
      try {
        outcome = await executeCommand(row, row.kind === 'remove_account' ? config.providers : state.enabledProviders(), {
          consumeResetCredit, codexBin: CODEX_BIN, refreshUsage, heartbeat,
          removeAccount: async command => {
            // An in-flight CLI quota read may refresh auth.json. Let it finish
            // before unlinking; the persistent marker already blocks new reads.
            await usageRefresh;
            return removeAccount(db, config, command);
          },
        });
      } catch (e) { error = String(e.message || e).slice(0, 300); }
      state.finishCommand(row.id, outcome, error);
    }
  };
  while (!stopping) {
    try {
      await runCommands().catch(e => console.error(`[ai-office] commands: ${e.message}`));
      const job = state.claim();
      if (!job) { await sleep(1000); continue; }
      console.log(`[ai-office] ${job.id} ${job.provider} ${job.kind}`);
      const events = eventQueue();
      const flushEvents = () => {
        const rows=events.drain();
        try { db.transaction(()=>appendEvents(db,job.id,rows))(); }
        catch(error){events.restore(rows);throw error;}
      };
      try {
        const projectRow = job.project_id && db.prepare('SELECT id,name,folder FROM ai_office_projects WHERE id=?').get(job.project_id);
        let parentId = null;
        try { parentId = JSON.parse(job.context_json || '{}').parent_job_id || null; } catch {}
        let depIds = [];
        try { depIds = JSON.parse(job.depends_json || '{}').deps || []; } catch {}
        const runJob = { ...job, project: projectRow || null, parentId, depIds, teamRole: job.team_role };
        const project = await prepareProject(runJob, WORK_ROOT).catch(error => {
          throw new Error(`Không tải được tệp dự án từ Drive chung: ${error.message}`);
        });
        const directImages = await prepareDirectMedia(job, WORK_ROOT, async id => {
          if (!media.read(id, job.created_by)) throw new Error('Ảnh trực tiếp không còn trên server');
          return fs.readFileSync(media.source(id));
        });
        const previousImages = await preparePreviousMedia(job, WORK_ROOT, async id => {
          if (!media.read(id, job.created_by)) throw new Error('Ảnh cũ trong cuộc chat đã hết hạn');
          return fs.readFileSync(media.source(id));
        });
        const documents = await prepareDocuments(job, WORK_ROOT, async (id, text) => {
          if (!media.read(id, job.created_by)) throw new Error('Tệp đính kèm đã hết hạn');
          return fs.readFileSync(media.source(id, text));
        });
        const control = (consumeInputs=true) => {
          flushEvents();
          const row=db.prepare('SELECT status,cancel_requested FROM ai_office_jobs WHERE id=?').get(job.id);
          const cancelRequested=!row||row.status!=='running'||!!row.cancel_requested;
          return {cancelRequested,inputs:consumeInputs&&!cancelRequested?takeInputs(db,job):[]};
        };
        const progress = phase => db.prepare("UPDATE ai_office_jobs SET progress_json=? WHERE id=? AND status='running'")
          .run(JSON.stringify({ phase, message: phases[phase], updatedAt: Date.now() }), job.id);
        const { result, execution } = await answerSession(job, { root: path.join(WORK_ROOT, 'work'),
          binary: job.provider === 'codex' ? CODEX_BIN : CLAUDE_BIN,
          promptFor: input => promptFor(input, project, documents), images:[...(project?.images||[]),...directImages], previousImages,
          control, progress, emit:events.emit, acknowledge:(id,status)=>acknowledgeInput(db,job.id,id,status) });
        if (control(false).cancelRequested) throw new Error(STOPPED);
        if (!result) throw new Error('AI trả kết quả trống');
        const files = await publishProject(runJob, project);
        if (control(false).cancelRequested) throw new Error(STOPPED);
        for (const source of outputImages.imagePaths(result)) {
          try {
            const file = outputImages.vpsSource(source);
            if (file) outputImages.save(job.id, source, fs.readFileSync(file));
          } catch (error) { console.error(`[ai-office] Không lưu được ảnh kết quả: ${error.message}`); }
        }
        state.done(job.id, result, execution, files);
      } catch (error) {
        state.fail(job.id, String(error.message || error).slice(0, 600));
        console.error(`[ai-office] ${job.id}: ${error.message}`);
      } finally {
        flushEvents(); closeInputs(db,job.id);
        try { cleanupDirectMedia(job, WORK_ROOT); } catch (error) { console.error(`[ai-office] Dọn ảnh tạm: ${error.message}`); }
      }
    } catch (error) {
      console.error(`[ai-office] worker: ${error.message}`);
      await sleep(3000);
    }
  }
  clearInterval(heartbeatTimer);
  clearInterval(usageTimer);
  clearInterval(toolsTimer);
  clearInterval(modelsTimer);
  db.close();
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
main().catch(error => { console.error(error); process.exitCode = 1; });
