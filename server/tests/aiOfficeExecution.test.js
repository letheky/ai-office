const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeExecution, normalizeExecution } = require('../scripts/ai-office-execution');
test('captures actual model and per-turn effort from the matching CLI session', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-execution-'));
  try {
    const dir = path.join(home, '.claude/projects/-home-user-sync-app');
    fs.mkdirSync(dir, { recursive: true });
    const id = '2c6a75ed-f787-4473-81e5-aa270ff685bd';
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), 'invalid\n' + JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5' }, perTurnEffort: 'medium' }));
    assert.deepEqual(claudeExecution({ session_id: id }, '/home/user/sync-app', home), { model: 'claude-opus-5-5', effort: 'medium', usage: null });
  } finally { fs.rmSync(home, { recursive: true }); }
});
test('missing transcripts do not invent effort or model', () => {
  assert.deepEqual(claudeExecution({ modelUsage: { 'claude-opus-5-5': {} } }, '/missing'), { model: 'claude-opus-5-5', effort: null, usage: null });
  assert.deepEqual(claudeExecution({ usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000, output_tokens: 42 } }, '/missing').usage, { input: 1015, cached: 1000, output: 42 });
  assert.deepEqual(normalizeExecution(null), { model: null, effort: null, usage: null });
  assert.deepEqual(normalizeExecution({ model: {}, effort: 'medium\n' }), { model: null, effort: 'medium', usage: null });
});
test('task API returns saved execution metadata and leaves legacy values unknown', async () => {
  const express = require('express');
  const { freshDb } = require('./helpers/testDb');
  const { getDb } = require('../src/db/database');
  freshDb();
  const db = getDb();
  db.prepare(`INSERT INTO ai_office_jobs (id,created_by,question,kind,provider,selection_reason,status,execution_json)
    VALUES ('known','owner','Top 5','sales','claude','test','done',?)`).run(JSON.stringify({ model: 'claude-opus-5-5', effort: 'medium' }));
  db.prepare(`INSERT INTO ai_office_jobs (id,created_by,question,kind,provider,selection_reason,status) VALUES ('legacy','owner','Old','sales','claude','test','done')`).run();
  const app = express();
  app.use((req, res, next) => { req.auth = { username: 'owner', role: 'admin', shops: '*' }; next(); });
  app.use('/office', require('../src/routes/aiOffice'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const id of ['known', 'legacy']) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/office/tasks/${id}`);
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).data.execution, id === 'known'
        ? { model: 'claude-opus-5-5', effort: 'medium', usage: null } : { model: null, effort: null, usage: null });
    }
  } finally { server.close(); }
});
