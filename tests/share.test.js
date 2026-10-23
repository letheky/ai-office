const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {spawnSync}=require('child_process');
test('source archive excludes credentials, runtime, database, user files, logs and git history',()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'office-share-test-'));
 try {
  for(const name of ['package.json','package-lock.json','.env.example','.gitignore','README.md','AGENTS.md','WORKER-GUIDE.md','CHANGELOG.md','scripts','tests','server','local','demos']) fs.cpSync(path.join(root,name),path.join(temp,name),{recursive:true,filter:source=>!/(?:^|\/)(?:data|node_modules)$/.test(source)});
  for(const name of ['.env','.runtime/profiles/codex/auth.json','.runtime/profiles/claude/.credentials.json','server/data/office.db','local/data/secret.log','output/private.txt','.git/config']) {
   const file=path.join(temp,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'PRIVATE_TEST_SENTINEL');
  }
  const run=spawnSync(process.execPath,['scripts/share.js'],{cwd:temp,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const archive=path.join(temp,'release/office-ai-source.tar.gz');
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});assert.equal(listing.status,0);
  assert.match(listing.stdout,/office-Ai\/\.env.example/);
  assert.doesNotMatch(listing.stdout,/\/(?:\.runtime|data|output|node_modules|\.git)\//);
  assert(!listing.stdout.split('\n').includes('office-Ai/.env'));
  const extracted=path.join(temp,'extracted');fs.mkdirSync(extracted);
  assert.equal(spawnSync('tar',['-xzf',archive,'-C',extracted]).status,0);
  function inspect(dir) {for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {const file=path.join(dir,entry.name);if(entry.isDirectory())inspect(file);else if(!file.endsWith('share.test.js'))assert(!fs.readFileSync(file,'utf8').includes('PRIVATE_TEST_SENTINEL'));}}
  inspect(extracted);
  // Source files themselves must also be checked rather than trusting ignore rules.
  fs.writeFileSync(path.join(temp,'server/src/leak.js'),'const key="sk-'+ 'x'.repeat(40)+'";');
  const rejected=spawnSync(process.execPath,['scripts/share.js'],{cwd:temp,encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/credential/);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
