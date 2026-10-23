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
