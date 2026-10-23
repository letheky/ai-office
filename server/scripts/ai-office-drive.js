// Shared Google Drive storage for AI Office projects, accessed through rclone.
// Used by the server (create folders, list, upload) and by workers (download
// inputs before a job, upload results after). Only `rclone copy`/`copyto`/`rcat`
// are used: nothing ever deletes or overwrites files at the destination folder
// of another step, so a failed or repeated job cannot destroy earlier work.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SUBDIRS = ['dau-vao', 'ke-hoach', 'buoc', 'hoan-thien'];
const KINDS = { 'dau-vao': 'input', 'ke-hoach': 'plan', buoc: 'step', 'hoan-thien': 'final' };

function rcloneBin(env = process.env) {
  if (env.AI_OFFICE_RCLONE_BIN) return env.AI_OFFICE_RCLONE_BIN;
  const local = path.join(os.homedir(), '.local/bin', process.platform === 'win32' ? 'rclone.exe' : 'rclone');
  return fs.existsSync(local) ? local : 'rclone';
}
// Remote root, e.g. "aioffice:" (a drive remote restricted by root_folder_id).
function driveRoot(env = process.env) {
  const value = String(env.AI_OFFICE_DRIVE_REMOTE || '').trim();
  return /^[\w.-]+:[^\0]*$/.test(value) ? value.replace(/\/+$/, '') : null;
}
function remotePath(root, ...parts) {
  const rel = parts.filter(Boolean).join('/');
  if (rel.split('/').some(part => part === '..' || part === '.')) throw new Error('Đường dẫn Drive không hợp lệ');
  return root.endsWith(':') ? `${root}${rel}` : `${root}/${rel}`;
}

function rclone(args, { env = process.env, timeout = 600000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(rcloneBin(env), args, { env, timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const lines = String(stderr || error.message).split('\n').filter(line => /ERROR|CRITICAL|Failed/i.test(line));
          return reject(new Error(`Drive lỗi: ${(lines.at(-1) || error.message).replace(/^\S+ \S+ /, '').slice(0, 300)}`));
        }
        resolve(stdout);
      });
    if (input) { child.stdin.end(input); }
  });
}

function slugify(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'du-an';
}
function safeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[\x00-\x1f<>:"|?*\\/]/g, '_').trim();
  if (!base || base === '.' || base === '..') throw new Error('Tên tệp không hợp lệ');
  return base.slice(0, 180);
}
const driveLink = (id, isDir) => /^[\w-]{10,}$/.test(id || '')
  ? (isDir ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`) : null;

async function createProjectFolder(folder, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung (AI_OFFICE_DRIVE_REMOTE)');
  for (const sub of SUBDIRS) await rclone(['mkdir', remotePath(root, folder, sub)], { env, timeout: 60000 });
  const listed = JSON.parse(await rclone(['lsjson', '--dirs-only', remotePath(root, path.posix.dirname(folder))], { env, timeout: 60000 }));
  const dir = listed.find(item => item.Name === path.posix.basename(folder));
  return { folderId: dir?.ID || null, link: driveLink(dir?.ID, true) };
}

function projectDeletePath(project, relative = '') {
  const folder = String(project?.folder || '');
  const id = String(project?.id || '');
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^du-an\/[a-z0-9-]+-[a-f0-9]{8}$/.test(folder) || !folder.endsWith(`-${id.slice(0, 8)}`))
    throw new Error('Đường dẫn dự án không hợp lệ');
  if (!relative) return folder;
  const parts = String(relative).split('/');
  if (parts.length < 2 || !SUBDIRS.includes(parts[0]) || parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)))
    throw new Error('Đường dẫn tệp dự án không hợp lệ');
  return `${folder}/${parts.join('/')}`;
}

async function deleteProjectFolder(project, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung');
  await rclone(['purge', remotePath(root, projectDeletePath(project))], { env, timeout: 600000 });
}

async function deleteProjectFile(project, relative, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung');
  if (!relative) throw new Error('Đường dẫn tệp dự án không hợp lệ');
  await rclone(['deletefile', remotePath(root, projectDeletePath(project, relative))], { env, timeout: 600000 });
}

async function listProject(folder, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung (AI_OFFICE_DRIVE_REMOTE)');
  const rows = JSON.parse(await rclone(['lsjson', '-R', '--files-only', remotePath(root, folder)], { env, timeout: 120000 }));
  return rows.slice(0, 2000).map(row => {
    const [top, step] = row.Path.split('/');
    return { path: row.Path, name: row.Name, size: row.Size, modTime: row.ModTime, mimeType: row.MimeType || null,
      kind: KINDS[top] || 'other', step: top === 'buoc' ? step : null, link: driveLink(row.ID, false) };
  }).sort((a, b) => String(b.modTime).localeCompare(String(a.modTime)));
}

// Upload a local file into one project subfolder; never replaces an existing name.
async function uploadFile(folder, sub, localFile, name, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung (AI_OFFICE_DRIVE_REMOTE)');
  if (!SUBDIRS.includes(sub)) throw new Error('Thư mục dự án không hợp lệ');
  const clean = safeFileName(name);
  const existing = JSON.parse(await rclone(['lsjson', '--files-only', remotePath(root, folder, sub)], { env, timeout: 60000 }));
  const names = new Set(existing.map(row => row.Name));
  let finalName = clean;
  for (let i = 2; names.has(finalName); i++) {
    const ext = path.extname(clean);
    finalName = `${clean.slice(0, clean.length - ext.length)} (${i})${ext}`;
  }
  await rclone(['copyto', localFile, remotePath(root, folder, sub, finalName)], { env });
  return finalName;
}

// A text-only or newly attached conversation may have no previous output.
// Prepare its step folder so existing workers can safely copy an empty directory.
async function ensureJobFolder(folder, jobId, env = process.env) {
  if (!/^[a-f0-9-]{36}$/.test(jobId || '')) throw new Error('Mã công việc không hợp lệ');
  const root = driveRoot(env);
  if (!root) throw new Error('Chưa cấu hình Drive chung');
  await rclone(['mkdir', remotePath(root, folder, 'buoc', jobId)], { env, timeout:60000 });
}

// Worker: bring the project files a step needs onto this machine.
async function downloadForJob(project, workspace, parentSteps, env = process.env) {
  const root = driveRoot(env);
  if (!root) throw new Error('Máy này chưa cấu hình Drive chung');
  const copied = [];
  for (const sub of ['dau-vao', 'ke-hoach', 'hoan-thien']) {
    await rclone(['copy', remotePath(root, project.folder, sub), path.join(workspace, sub)], { env });
    copied.push(sub);
  }
  const steps = [].concat(parentSteps || []).filter(Boolean);
  for (const step of steps) {
    // One previous step → buoc-truoc/; several (team mode) → buoc-truoc/<first 8 chars of job id>/.
    const target = steps.length === 1 ? path.join(workspace, 'buoc-truoc') : path.join(workspace, 'buoc-truoc', step.slice(0, 8));
    await rclone(['copy', remotePath(root, project.folder, 'buoc', step), target], { env });
    copied.push(path.relative(workspace, target));
  }
  return copied;
}

// Worker: upload the files the AI left in ket-qua/, then verify they all arrived.
async function uploadJobOutput(project, jobId, outputDir, env = process.env, { final = false } = {}) {
  const root = driveRoot(env);
  if (!root) throw new Error('Máy này chưa cấu hình Drive chung');
  if (!fs.existsSync(outputDir) || !fs.readdirSync(outputDir).length) return [];
  const target = remotePath(root, project.folder, 'buoc', jobId);
  await rclone(['copy', outputDir, target], { env });
  await rclone(['check', outputDir, target, '--one-way', '--size-only'], { env });
  // A merged team result is also published as the finished deliverable.
  if (final) await rclone(['copy', outputDir, remotePath(root, project.folder, 'hoan-thien', jobId.slice(0, 8))], { env });
  const rows = JSON.parse(await rclone(['lsjson', '-R', '--files-only', target], { env, timeout: 120000 }));
  return rows.slice(0, 200).map(row => ({ path: `buoc/${jobId}/${row.Path}`, name: row.Name, size: row.Size, link: driveLink(row.ID, false) }));
}

async function driveReady(env = process.env) {
  const root = driveRoot(env);
  if (!root) return { available: false, ready: false };
  try { await rclone(['lsjson', '--dirs-only', '--max-depth', '1', root], { env, timeout: 20000 }); return { available: true, ready: true }; }
  catch { return { available: true, ready: false }; }
}

module.exports = { SUBDIRS, driveRoot, slugify, safeFileName, createProjectFolder, projectDeletePath, deleteProjectFolder, deleteProjectFile, listProject, uploadFile,
  ensureJobFolder, downloadForJob, uploadJobOutput, driveReady, remotePath, rclone };
