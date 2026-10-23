// Keep the AI Office interface byte-for-byte intact during agent file work.
const fs = require('fs');
const path = require('path');

const protectedPaths = ['demos/ai-office/dist', 'frontend/src/pages/AiOfficePage.jsx'];

function listFiles(target, files = []) {
  if (!fs.existsSync(target)) return files;
  const stat = fs.lstatSync(target);
  if (stat.isFile() || stat.isSymbolicLink()) { files.push(target); return files; }
  for (const entry of fs.readdirSync(target)) listFiles(path.join(target, entry), files);
  return files;
}

function listDirs(target, dirs = []) {
  if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory()) return dirs;
  dirs.push(target);
  for (const entry of fs.readdirSync(target)) listDirs(path.join(target, entry), dirs);
  return dirs;
}

function snapshotOfficeUi(repoRoot) {
  const roots = protectedPaths.map(relative => path.resolve(repoRoot, relative));
  const originals = new Map();
  const originalDirs = new Set(roots.flatMap(root => listDirs(root)));
  for (const root of roots) for (const file of listFiles(root)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Không bảo vệ được symbolic link: ${file}`);
    originals.set(file, fs.readFileSync(file));
  }
  return () => {
    let restored = 0;
    for (const root of roots) {
      const now = listFiles(root);
      for (const file of now) {
        if (originals.has(file)) continue;
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Đường dẫn bảo vệ không hợp lệ');
        fs.unlinkSync(file);
        restored++;
      }
    }
    for (const [file, bytes] of originals) {
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        restored++;
      }
    }
    const extraDirs = roots.flatMap(root => listDirs(root)).filter(dir => !originalDirs.has(dir))
      .sort((a, b) => b.length - a.length);
    for (const dir of extraDirs) {
      if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); restored++; }
    }
    return restored;
  };
}

module.exports = { snapshotOfficeUi };
