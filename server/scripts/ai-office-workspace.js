const fs = require('fs');
const path = require('path');
const os = require('os');
function workspacePath(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Đường dẫn thư mục không hợp lệ');
  const expanded = value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error('Hãy nhập đường dẫn tuyệt đối của thư mục trên máy xử lý');
  try {
    const real = fs.realpathSync(expanded);
    if (!fs.statSync(real).isDirectory()) throw new Error('not-directory');
    fs.accessSync(real, fs.constants.R_OK | fs.constants.X_OK);
    return real;
  } catch { throw new Error('Thư mục không tồn tại hoặc worker không có quyền đọc/truy cập'); }
}
function listFolders(value) {
  const current = workspacePath(value || os.homedir(), os.homedir());
  const folders = fs.readdirSync(current, {withFileTypes:true}).flatMap(entry => {
    if (entry.isDirectory()) return [{name:entry.name,path:path.join(current,entry.name)}];
    if (entry.isSymbolicLink()) { try { if (fs.statSync(path.join(current,entry.name)).isDirectory()) return [{name:entry.name,path:path.join(current,entry.name)}]; } catch {} }
    return [];
  }).sort((a,b)=>a.name.localeCompare(b.name));
  return {current,parent:path.dirname(current),folders};
}
function folderResult(value) {
  if (!value || typeof value.current !== 'string' || typeof value.parent !== 'string' || !Array.isArray(value.folders)) return null;
  return {current:value.current,parent:value.parent,folders:value.folders.filter(f=>typeof f?.name==='string'&&typeof f.path==='string').map(f=>({name:f.name,path:f.path}))};
}
module.exports={workspacePath,listFolders,folderResult};
