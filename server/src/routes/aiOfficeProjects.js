// AI Office projects: one shared Google Drive folder per project so every
// machine works from the same inputs and publishes results back for the next step.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { getDb } = require('../db/database');
const { canAction, credentialsValid } = require('../lib/auth');
const drive = require('../../scripts/ai-office-drive');

const router = express.Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'ai-office-upload'), limits: { fileSize: 2 * 1024 ** 3, files: 10 } });
const listCache = new Map();

function publicProject(row) {
  return { id: row.id, name: row.name, folder: row.folder, link: row.drive_link, createdAt: row.created_at };
}
function ownProject(id, username) {
  return getDb().prepare('SELECT * FROM ai_office_projects WHERE id=? AND created_by=?').get(String(id || ''), username);
}
async function projectFiles(row, fresh = false) {
  const hit = listCache.get(row.id);
  if (!fresh && hit && Date.now() - hit.at < 20000) return hit.files;
  const files = await drive.listProject(row.folder);
  listCache.set(row.id, { at: Date.now(), files });
  return files;
}
const editor = (req, res, next) => canAction(req.auth, 'ai-analysis', 'edit') ? next()
  : res.status(403).json({ success: false, error: 'Không có quyền sửa dự án' });

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM ai_office_projects WHERE created_by=? ORDER BY created_at DESC LIMIT 100')
    .all(req.auth.username);
  res.json({ success: true, data: { configured: !!drive.driveRoot(), projects: rows.map(publicProject) } });
});

router.post('/', editor, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 80) return res.status(400).json({ success: false, error: 'Tên dự án cần 1–80 ký tự' });
  const id = randomUUID();
  const folder = `du-an/${drive.slugify(name)}-${id.slice(0, 8)}`;
  try {
    const created = await drive.createProjectFolder(folder);
    getDb().prepare(`INSERT INTO ai_office_projects(id,created_by,name,folder,drive_folder_id,drive_link) VALUES(?,?,?,?,?,?)`)
      .run(id, req.auth.username, name, folder, created.folderId, created.link);
    res.status(201).json({ success: true, data: publicProject(ownProject(id, req.auth.username)) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/:id/files', async (req, res) => {
  const row = ownProject(req.params.id, req.auth.username);
  if (!row) return res.status(404).json({ success: false, error: 'Không thấy dự án' });
  try { res.json({ success: true, data: await projectFiles(row, req.query.fresh === '1') }); }
  catch (error) { res.status(502).json({ success: false, error: error.message }); }
});

router.post('/:id/files', editor, upload.array('file', 10), async (req, res) => {
  const row = ownProject(req.params.id, req.auth.username);
  const files = req.files || [];
  try {
    if (!row) return res.status(404).json({ success: false, error: 'Không thấy dự án' });
    const sub = drive.SUBDIRS.includes(req.body?.folder) && req.body.folder !== 'buoc' ? req.body.folder : 'dau-vao';
    if (!files.length) return res.status(400).json({ success: false, error: 'Chưa chọn tệp' });
    const saved = [];
    for (const file of files) {
      // multer decodes multipart names as latin1; Vietnamese names need UTF-8.
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
      saved.push(await drive.uploadFile(row.folder, sub, file.path, name));
    }
    listCache.delete(row.id);
    res.status(201).json({ success: true, data: { folder: sub, saved } });
  } catch (error) { res.status(502).json({ success: false, error: error.message }); }
  finally { for (const file of files) fs.unlink(file.path, () => {}); }
});

router.delete('/:id/files', editor, async (req, res) => {
  const row = ownProject(req.params.id, req.auth.username);
  if (!row) return res.status(404).json({ success: false, error: 'Không thấy dự án' });
  if (typeof req.body?.password !== 'string' || !credentialsValid(req.auth.username, req.body.password))
    return res.status(401).json({ success: false, error: 'Nhập đúng mật khẩu phần mềm để xóa tệp' });
  const busy = getDb().prepare("SELECT 1 FROM ai_office_jobs WHERE project_id=? AND status IN ('pending','running','waiting') LIMIT 1").get(row.id);
  if (busy) return res.status(409).json({ success: false, error: 'Dự án có việc đang chạy hoặc chờ; hãy đợi hoàn thành trước khi xóa tệp' });
  try {
    await drive.deleteProjectFile(row, req.body?.path);
    listCache.delete(row.id);
    res.json({ success: true, data: { path: req.body.path } });
  } catch (error) { res.status(502).json({ success: false, error: `Không xóa được tệp Drive: ${error.message}` }); }
});

router.delete('/:id', editor, async (req, res) => {
  const row = ownProject(req.params.id, req.auth.username);
  if (!row) return res.status(404).json({ success: false, error: 'Không thấy dự án' });
  if (typeof req.body?.password !== 'string' || !credentialsValid(req.auth.username, req.body.password))
    return res.status(401).json({ success: false, error: 'Nhập đúng mật khẩu phần mềm để xóa dự án' });
  const db = getDb();
  const linked = db.prepare('SELECT COUNT(*) AS n FROM ai_office_jobs WHERE project_id=?').get(row.id).n;
  if (linked) return res.status(409).json({ success: false, error: `Dự án còn gắn với ${linked} lượt việc. Hãy xóa luồng công việc liên quan trước.` });
  try {
    await drive.deleteProjectFolder(row);
    db.prepare('DELETE FROM ai_office_projects WHERE id=? AND created_by=?').run(row.id, req.auth.username);
    listCache.delete(row.id);
    res.json({ success: true, data: { id: row.id } });
  } catch (error) { res.status(502).json({ success: false, error: `Không xóa được thư mục Drive: ${error.message}` }); }
});

module.exports = { router, ownProject, projectFiles, publicProject };
