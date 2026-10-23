// Short-lived attachment relay for native CLI turns. Bytes stay on the server until
// the assigned worker pulls them; Google Drive is not involved.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);

const router = express.Router();
const root = path.join(__dirname, '../../data/ai-office-media');
const upload = multer({ dest: path.join(os.tmpdir(), 'ai-office-media-upload'), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const validId = id => /^[a-f0-9-]{36}$/.test(id || '');
const imageType = name => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })
  [path.extname(String(name || '')).slice(1).toLowerCase()] || null;
function validImage(file, mime) {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(head.toString('ascii',0,6));
  return head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WEBP';
}

function read(id, owner) {
  if (!validId(id)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), 'utf8'));
    return row.owner === owner && fs.existsSync(path.join(root, id)) ? row : null;
  } catch { return null; }
}
function source(id, text = false) { return path.join(root, `${id}${text ? '.txt' : ''}`); }
function remove(id) {
  if (!validId(id)) return;
  for (const file of [source(id), source(id, true), path.join(root, `${id}.json`)]) {
    try { fs.unlinkSync(file); } catch {}
  }
}
function pruneOld() {
  if (!fs.existsSync(root)) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(root).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    try {
      const row = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (row.at < cutoff) remove(row.id);
    } catch {}
  }
}
setInterval(pruneOld, 6 * 60 * 60 * 1000).unref();

router.post('/', (req, res, next) => upload.single('file')(req, res, error => {
  if (error) return res.status(400).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Tệp gửi trực tiếp tối đa 20 MB' : error.message });
  next();
}), async (req, res) => {
  const file = req.file;
  let id;
  try {
    if (!file) return res.status(400).json({ success: false, error: 'Chưa chọn tệp' });
    const name = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
    const extension = path.extname(name).toLowerCase();
    const documentMime = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain' }[extension];
    const mime = documentMime || imageType(name);
    if (!mime || (!documentMime && (file.mimetype !== mime || !validImage(file.path, mime)))) return res.status(400).json({ success: false, error: 'Chỉ nhận ảnh JPG/PNG/WebP/GIF, Excel .xlsx hoặc TXT đến 20 MB; file .xls cần lưu lại thành .xlsx' });
    id = randomUUID();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    pruneOld();
    if (documentMime) {
      try {
        await runFile('python3', [path.join(__dirname, '../../scripts/ai-office-document.py'), file.path, source(id, true), extension], { timeout: 20000, maxBuffer: 4096 });
        fs.chmodSync(source(id, true), 0o600);
      } catch (error) {
        remove(id);
        return res.status(400).json({ success: false, error: 'Không đọc được tệp. Excel cần là .xlsx hợp lệ, không có mật khẩu; TXT dùng UTF-8/UTF-16. Nội dung tối đa 20 MB, Excel giải nén tối đa 100 MB.' });
      }
    }
    fs.copyFileSync(file.path, source(id));
    fs.chmodSync(source(id), 0o600);
    fs.writeFileSync(path.join(root, `${id}.json`), JSON.stringify({ id, owner: req.auth.username, name, mime, at: Date.now() }), { mode: 0o600 });
    return res.status(201).json({ success: true, data: { id, name } });
  } catch (error) { if (id) remove(id); return res.status(500).json({ success: false, error: error.message }); }
  finally { if (file) fs.unlink(file.path, () => {}); }
});

module.exports = { router, read, source, remove, imageType };
