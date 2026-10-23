// Only user-visible text and structured activity go to the browser. Never relay
// stderr, tool arguments/outputs, environment, auth objects or reasoning traces.
const { randomUUID } = require('crypto');
const {normalizeContext}=require('../../scripts/ai-office-execution');
const activityLabels = {command:'Chạy lệnh',file:'Đọc / sửa tệp',search:'Tìm kiếm',tool:'Dùng công cụ',compact:'Rút gọn ngữ cảnh',workspace:'Thư mục làm việc'};
function safeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  if(value.kind==='context'){const context=normalizeContext(value.context);return context?{kind:'context',context}:null}
  if (value.kind === 'text' && typeof value.text === 'string') return {kind:'text',text:value.text};
  if (value.kind === 'activity' && Object.hasOwn(activityLabels,value.type)) return {kind:'activity',type:value.type,label:activityLabels[value.type]};
  if (value.kind === 'reset') return {kind:'reset'};
  if (value.kind === 'ready') return {kind:'ready',canSteer:value.canSteer===true};
  if (value.kind === 'workspace' && typeof value.path === 'string') return {kind:'workspace',path:value.path};
  return null;
}
function appendEvents(db,jobId,events) {
  const insert=db.prepare('INSERT OR IGNORE INTO ai_office_events(job_id,event_seq,event_json,created_at) VALUES(?,?,?,?)');
  const rows=Array.isArray(events)?events:[];
  for (const value of rows) {
    const event=safeEvent(value);if(!event)continue;
    const added=insert.run(jobId,Number.isSafeInteger(value.seq)&&value.seq>0?`${/^[a-f0-9-]{36}$/i.test(value.runId||'')?value.runId:'legacy'}:${value.seq}`:null,JSON.stringify(event),Date.now());
    if(added.changes&&event.kind==='reset')db.prepare(`UPDATE ai_office_jobs SET execution_json=json_remove(COALESCE(execution_json,'{}'),'$.context') WHERE id=?`).run(jobId);
    if(added.changes&&event.kind==='context')db.prepare(`UPDATE ai_office_jobs SET execution_json=json_set(COALESCE(execution_json,'{}'),'$.context',json(?)) WHERE id=?
      AND COALESCE(json_extract(execution_json,'$.context.measuredAt'),0)<=?`)
      .run(JSON.stringify(event.context),jobId,event.context.measuredAt);
  }
}
function takeInputs(db,job) {
  return db.transaction(()=>{
    const rows=db.prepare("SELECT id,content FROM ai_office_inputs WHERE job_id=? AND status='pending' ORDER BY rowid").all(job.id);
    for(const row of rows) db.prepare("UPDATE ai_office_inputs SET status='sent' WHERE id=? AND status='pending'").run(row.id);
    return rows;
  })();
}
function acknowledgeInput(db,jobId,id,status) {
  if(!['accepted','error','uncertain'].includes(status)) return;
  db.prepare("UPDATE ai_office_inputs SET status=? WHERE id=? AND job_id=? AND status='sent'").run(status,id,jobId);
}
function requestInput(db,job,content) {
  const ready=db.prepare("SELECT event_json FROM ai_office_events WHERE job_id=? AND json_extract(event_json,'$.kind') IN ('ready','reset') ORDER BY id DESC LIMIT 1").get(job.id);
  if(job.provider!=='codex'||job.status!=='running'||job.cancel_requested||!ready||!JSON.parse(ready.event_json).canSteer)
    throw Object.assign(new Error('Lượt này chưa nhận được điều chỉnh trực tiếp; hãy gửi nối tiếp hoặc đợi AI sẵn sàng'),{status:409});
  const id=randomUUID();
  db.prepare("INSERT INTO ai_office_inputs(id,job_id,content,status,created_at) VALUES(?,?,?,'pending',?)").run(id,job.id,content,Date.now());
  return {id,status:'pending'};
}
function closeInputs(db,jobId) {
  db.prepare("UPDATE ai_office_inputs SET status='error' WHERE job_id=? AND status='pending'").run(jobId);
  db.prepare("UPDATE ai_office_inputs SET status='uncertain' WHERE job_id=? AND status='sent'").run(jobId);
}
function eventQueue() {
  const runId=randomUUID();let seq=0,queue=[];
  return {emit:event=>queue.push({...event,runId,seq:++seq}),drain:()=>{const rows=queue;queue=[];return rows},restore:rows=>{queue=[...rows,...queue]}};
}
module.exports={eventQueue,safeEvent,appendEvents,takeInputs,acknowledgeInput,requestInput,closeInputs};
