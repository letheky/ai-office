const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
test('standalone HTTP: auth, clean database, worker lifecycle, follow-up and password-gated deletion',async()=>{
 process.env.SYNC_USER='test-admin';process.env.SYNC_PASS='test-password-for-local-tests';
 const Database=require('../server/src/db/sqlite');
 const db=new Database(':memory:');require('../server/src/db/database').__setDbForTests(db);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
 assert(tables.every(name=>name.startsWith('ai_office_')||['app_settings','sqlite_sequence'].includes(name)));
 const server=require('../server/src/index').listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const auth='Basic '+Buffer.from(`${process.env.SYNC_USER}:${process.env.SYNC_PASS}`).toString('base64');
 async function api(url,body,method=body?'POST':'GET') {
  const response=await fetch(base+'/api/ai-office'+url,{method,headers:{authorization:auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:response.status,...await response.json()};
 }
 try {
  assert.equal((await fetch(base+'/ai-office/')).status,401);
  const page=await fetch(base+'/ai-office/',{headers:{authorization:auth}});assert.equal(page.status,200);assert.match(await page.text(),/Office AI/);
  const caps=await api('/capabilities');assert.equal(caps.status,200);assert.deepEqual(caps.data.shops,[]);assert.deepEqual(caps.data.machines,[]);
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal((await api('/worker/heartbeat',{id,name:'Test worker',providers:['codex'],models:{codex:[{id:'gpt-6.1-sol',efforts:['low','medium','high']}]}})).status,200);
  const created=await api('/tasks',{question:'Đọc và giải thích đoạn mã tôi cung cấp',executor:id,provider:'codex',model:'gpt-6.1-sol',split:'off'});
  assert.equal(created.success,true,JSON.stringify(created));const job=created.data;
  const next=await api('/worker/next?machine='+id);assert.equal(next.data.id,job.id);
  assert.equal((await api('/worker/next?machine='+id)).data,null);
  const result=await api(`/worker/jobs/${job.id}/result`,{machine:id,result:'Kết quả giả lập, không gọi AI.'});assert.equal(result.status,200);
  const duplicate=await api(`/worker/jobs/${job.id}/result`,{machine:id,result:'Không ghi hai lần'});assert.equal(duplicate.status,409);
  assert.equal((await api('/tasks')).data.find(item=>item.id===job.id).status,'done');
  assert.equal((await api(`/tasks/${job.id}`,{},'DELETE')).status,401);
  const second=await api('/tasks',{question:'Giải thích thêm',parentId:job.id,executor:id,provider:'codex',split:'off'});assert.equal(second.success,true,JSON.stringify(second));
 } finally { await new Promise(resolve=>server.close(resolve));db.close(); }
});
test('runtime isolates inherited accounts and strips API credentials from CLI environment',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'office-runtime-test-'));
 try {
  fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync(path.join(root,'scripts/runtime.js'),path.join(temp,'scripts/runtime.js'));
  fs.writeFileSync(path.join(temp,'.env'),'OFFICE_USER=test\nOFFICE_PASSWORD=test-runtime-password-1234\n');
  const script=`require(${JSON.stringify(path.join(temp,'scripts/runtime.js'))}).configure();const assert=require('node:assert/strict');assert.equal(process.env.CODEX_HOME,${JSON.stringify(path.join(temp,'.runtime/profiles/codex'))});assert.equal(process.env.CLAUDE_CONFIG_DIR,${JSON.stringify(path.join(temp,'.runtime/profiles/claude'))});assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.AI_OFFICE_SERVER_URL,'http://127.0.0.1:3010');const env=require('./server/scripts/ai-office-cli').subscriptionEnv();assert.equal(env.OFFICE_PASSWORD,undefined);assert.equal(env.SYNC_PASS,undefined);`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,NODE_PATH:path.join(root,'node_modules'),CODEX_HOME:'/do-not-use',CLAUDE_CONFIG_DIR:'/do-not-use',OPENAI_API_KEY:'dummy-must-be-removed',AI_OFFICE_SERVER_URL:'https://example.invalid'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readdirSync(path.join(temp,'.runtime/profiles/codex')).length,0);
 } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
test('remote worker accepts only an HTTPS server URL from .env, without credentials',()=>{
 const {serverUrl}=require('../scripts/runtime');
 assert.equal(serverUrl('',3010),'http://127.0.0.1:3010');
 assert.equal(serverUrl('https://office.example.org/',3010),'https://office.example.org');
 assert.equal(serverUrl('http://localhost:4000',3010),'http://localhost:4000');
 for(const bad of ['http://office.example.org','https://user:pass@office.example.org','https://office.example.org/ai-office','ftp://office.example.org','not a url'])
  assert.throws(()=>serverUrl(bad,3010),undefined,bad);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'office-remote-test-'));
 try {
  fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync(path.join(root,'scripts/runtime.js'),path.join(temp,'scripts/runtime.js'));
  fs.writeFileSync(path.join(temp,'.env'),'OFFICE_USER=test\nOFFICE_PASSWORD=test-runtime-password-1234\nAI_OFFICE_SERVER_URL=https://office.example.org\nAI_OFFICE_MACHINE_NAME=PC Windows\n');
  const script=`require(${JSON.stringify(path.join(temp,'scripts/runtime.js'))}).configure();const assert=require('node:assert/strict');assert.equal(process.env.AI_OFFICE_SERVER_URL,'https://office.example.org');assert.equal(process.env.AI_OFFICE_MACHINE_NAME,'PC Windows');`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,NODE_PATH:path.join(root,'node_modules')},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
test('--account gives an extra AI account its own profile and joins the default worker machine',()=>{
 const root=path.join(__dirname,'..');
 const {accountArg}=require('../scripts/runtime');
 assert.equal(accountArg([]),null);assert.equal(accountArg(['--account','1']),null);
 assert.equal(accountArg(['--account=2']),'2');assert.equal(accountArg(['--account','Work']),'work');
 assert.throws(()=>accountArg(['--account','../x']));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'office-account-test-'));
 try {
  fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync(path.join(root,'scripts/runtime.js'),path.join(temp,'scripts/runtime.js'));
  fs.writeFileSync(path.join(temp,'.env'),'OFFICE_USER=test\nOFFICE_PASSWORD=test-runtime-password-1234\nAI_OFFICE_MACHINE_NAME=PC Windows\nAI_OFFICE_ACCOUNT_LABEL=Codex\nAI_OFFICE_ACCOUNT_LABEL_2=Codex phụ\n');
  const run=account=>{
   const script=`require(${JSON.stringify(path.join(temp,'scripts/runtime.js'))}).configure(${JSON.stringify(account)});console.log(JSON.stringify(Object.fromEntries(['CODEX_HOME','AI_OFFICE_DATA_DIR','AI_OFFICE_HOST_ID','AI_OFFICE_HOST_NAME','AI_OFFICE_ACCOUNT_LABEL'].map(k=>[k,process.env[k]]))));`;
   const result=spawnSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,NODE_PATH:path.join(root,'node_modules')},encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  const main=run([]),extra=run(['--account','2']);
  assert.equal(main.AI_OFFICE_HOST_ID,undefined);assert.equal(main.CODEX_HOME,path.join(temp,'.runtime/profiles/codex'));
  assert.equal(extra.CODEX_HOME,path.join(temp,'.runtime/profiles/codex-2'));assert.equal(extra.AI_OFFICE_DATA_DIR,path.join(temp,'.runtime/worker-2'));
  assert.equal(extra.AI_OFFICE_HOST_ID,JSON.parse(fs.readFileSync(path.join(temp,'.runtime/worker/ai-office-machine.json'),'utf8')).id);
  assert.equal(extra.AI_OFFICE_HOST_NAME,'PC Windows');assert.equal(extra.AI_OFFICE_ACCOUNT_LABEL,'Codex phụ');
  assert.equal(run(['--account','3']).AI_OFFICE_ACCOUNT_LABEL,'Codex 3');
 } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
test('Windows launcher resolves npm codex.cmd shims to the bundled native codex.exe',()=>{
 const {windowsCli}=require('../scripts/runtime');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'office-wincli-test-'));
 try {
  const npm=path.join(temp,'npm'),native=path.join(temp,'native');
  const vendor=path.join(npm,'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc');
  fs.mkdirSync(path.join(vendor,'codex'),{recursive:true});fs.mkdirSync(path.join(vendor,'path'));fs.mkdirSync(native);
  fs.writeFileSync(path.join(npm,'codex.cmd'),'');fs.writeFileSync(path.join(vendor,'codex/codex.exe'),'');
  assert.deepEqual(windowsCli('codex',`${native};${npm}`,'win32'),{binary:path.join(vendor,'codex/codex.exe'),tools:path.join(vendor,'path')});
  fs.writeFileSync(path.join(native,'codex.exe'),'');
  assert.deepEqual(windowsCli('codex',`${native};${npm}`,'win32'),{binary:path.join(native,'codex.exe')});
  assert.equal(windowsCli('claude',`${native};${npm}`,'win32'),null);
  assert.equal(windowsCli('codex',`${native};${npm}`,'linux'),null);
 } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
