const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeUsage,quotaState}=require('../src/services/aiOfficeQuota');
const {fromClaude,fromCodex}=require('../scripts/ai-office-usage');
const {freshDb}=require('./helpers/testDb');const {getDb}=require('../src/db/database');
const {workerRows,chooseWorker,connectedProviders}=require('../src/services/aiOfficeMachines');
const now=Date.now(),reset=Math.floor(now/1000)+3600;
function snapshot(used){return {provider:'codex',checkedAt:now,status:'ok',windows:fromCodex({rateLimits:{primary:{usedPercent:used,windowDurationMins:300,resetsAt:reset}}})};}
test('keeps missing usage unknown and converts actual subscription windows',()=>{
 assert.deepEqual(fromClaude({}),[]);
 assert.equal(fromClaude({five_hour:{utilization:100,resets_at:new Date(reset*1000).toISOString()}})[0].remainingPercent,0);
 assert.equal(snapshot(2).windows[0].remainingPercent,98);
 assert.equal(quotaState(snapshot(100),'',now).status,'exhausted');
 assert.equal(quotaState(snapshot(98),'',now).status,'low');
 assert.equal(quotaState(snapshot(2),'',now).status,'ready');
 assert.equal(quotaState(snapshot(100),'',now+400000).status,'unknown');
 assert.equal(quotaState({...snapshot(100),windows:[{...snapshot(100).windows[0],resetsAt:Math.floor(now/1000)-1}]},'',now).status,'unknown');
});
test('never sends credentials from heartbeat usage to public clients',()=>{
 const u=normalizeUsage({codex:{...snapshot(2),accessToken:'secret',windows:[{...snapshot(2).windows[0],cookie:'secret'}]}});
 assert.equal(JSON.stringify(u).includes('secret'),false);
 assert.equal(quotaState(u.codex,'',now).status,'ready');
});
test('chooses healthy account over near-limit account and excludes exhausted accounts',()=>{
 freshDb();const db=getDb();
 for(const [id,used] of [['a',98],['b',2]])db.prepare('INSERT INTO ai_office_machines(id,name,providers_json,last_seen,host_id,usage_json) VALUES(?,?,?,?,?,?)')
 .run(id,id,'["codex"]',now,'host',JSON.stringify({codex:snapshot(used)}));
 assert.equal(chooseWorker(db,workerRows(db,'host'),'codex',now),'b');
 db.prepare('UPDATE ai_office_machines SET usage_json=?').run(JSON.stringify({codex:snapshot(100)}));
 assert.deepEqual(connectedProviders(workerRows(db,'host'),now),[]);
 assert.throws(()=>chooseWorker(db,workerRows(db,'host'),'codex',now),/online/);
});
test('model-specific weekly cap only blocks the affected Claude model',()=>{
 const usage={provider:'claude',checkedAt:now,status:'ok',windows:fromClaude({five_hour:{utilization:10,resets_at:new Date(reset*1000).toISOString()},seven_day_opus:{utilization:100,resets_at:new Date(reset*1000).toISOString()}})};
 assert.equal(quotaState(usage,'claude-opus-5-5',now).status,'exhausted');
 assert.equal(quotaState(usage,'claude-sonnet-5',now).status,'ready');
});
