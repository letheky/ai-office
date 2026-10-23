const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const files=['package.json','package-lock.json','.env.example','.gitignore','README.md','AGENTS.md','WORKER-GUIDE.md','CHANGELOG.md'];
const directories=['scripts','tests','server/scripts','server/src','server/tests','local/src','demos/ai-office'];
const extensions=new Set(['.js','.mjs','.py','.json','.html','.css','.txt','.md']);
const forbidden=/(?:^|\/)(?:node_modules|data|output|release|\.runtime|\.git|\.env|auth\.json|\.credentials\.json|rclone\.conf)(?:\/|$)|\.(?:db|sqlite|log|pem|key)(?:$|[.-])/i;
function walk(relative) {
 for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
  const name=path.posix.join(relative,entry.name);
  if(forbidden.test(name)||entry.isSymbolicLink()) throw new Error(`Từ chối đưa tệp nhạy cảm/không mong đợi vào source: ${name}`);
  if(entry.isDirectory()) walk(name);
  else if(entry.isFile()&&extensions.has(path.extname(name))) files.push(name);
  else throw new Error(`Tệp chưa được duyệt để chia sẻ: ${name}`);
 }
}
for(const dir of directories) walk(dir);
for(const name of files) {
 const file=path.join(root,name);
 if(fs.lstatSync(file).isSymbolicLink()) throw new Error('Không đóng gói symlink');
 const source=fs.readFileSync(file,'utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(source)) throw new Error(`Có dấu hiệu credential trong ${name}`);
}
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'office-ai-share-'));
try {
 for(const name of files) { const target=path.join(staging,'office-Ai',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,name),target); }
 const release=path.join(root,'release');fs.mkdirSync(release,{recursive:true});
 const archive=path.join(release,'office-ai-source.tar.gz');
 const result=spawnSync('tar',['-czf',archive,'-C',staging,'office-Ai'],{stdio:'inherit'});
 if(result.error) throw result.error;
 if(result.status!==0) throw new Error('Không tạo được gói source');
 console.log(`Đã đóng gói ${files.length} tệp source: ${archive}`);
} finally { fs.rmSync(staging,{recursive:true,force:true}); }
