const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { promptFor } = require('../scripts/ai-office-prompt');
const router = require('../src/routes/aiOffice');

test('ordinary CLI input contains only the user question, even for old jobs with reports and permissions', () => {
  const question = 'Doanh thu tuần này thế nào?';
  const job = { question, allow_files: 1, kind: 'sales', assigned_agent: 'Mai', context_json: JSON.stringify({
    source: 'report', rows: [{ revenue: 999 }], scope: { admin: true }, session_scope: 'private',
    app_access: { instruction: 'extra' }, conversation_instruction: 'extra', parent_job_id: 'parent',
  }) };
  assert.equal(promptFor(job), question);
});

test('fallback history preserves full questions and answers; selected attachments retain local locations', () => {
  const conversation = [{ question: 'old question', answer: 'A'.repeat(40000) }];
  const result = promptFor({ question: 'Tiếp tục', context_json: JSON.stringify({ conversation, previous_data: { rows: ['omit'] } }) },
    { instructions: 'Tư liệu: /tmp/input; kết quả: /tmp/output' });
  assert.equal(result, JSON.stringify(conversation) + '\n\nTiếp tục\n\nTư liệu: /tmp/input; kết quả: /tmp/output');
});

test('member with explicit AI permissions cannot access any Office endpoint, including project files and worker routes', async () => {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { username: 'member', role: 'member', features: ['ai-analysis'], permissions: { 'ai-analysis': ['view', 'edit', 'delete'] }, shops: '*' }; next(); });
  app.use('/api/ai-office', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const [method, path] of [['GET', '/tasks'], ['POST', '/tasks'], ['GET', '/capabilities'], ['GET', '/projects'], ['GET', '/projects/id/files'], ['POST', '/worker/heartbeat'], ['GET', '/worker/next']]) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ai-office${path}`, { method });
      assert.equal(res.status, 403, method + ' ' + path);
    }
  } finally { server.close(); }
});
