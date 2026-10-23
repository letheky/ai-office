const { randomUUID } = require('crypto');
const { contextOf, continueContext } = require('./aiOfficeConversation');
const { normalizeExecution } = require('../../scripts/ai-office-execution');

const commands = require('../lib/aiOfficeCommands.json');
const {selectionOf}=require('./aiOfficeModels');
const commandError = (message, status=400) => Object.assign(new Error(message), { status });
const isSlash = value => typeof value==='string' && value.trimStart().startsWith('/');
function latestTurn(db, job) {
  if (job.team_role) return job;
  const root=contextOf(job).conversation_root||job.id;
  return db.prepare(`SELECT * FROM ai_office_jobs WHERE created_by=? AND team_role IS NULL
    AND (id=? OR json_extract(context_json,'$.conversation_root')=?) ORDER BY rowid DESC LIMIT 1`)
    .get(job.created_by,root,root)||job;
}
function statusOf(db, job) {
  const latest=latestTurn(db,job);
  const root=contextOf(latest).conversation_root||latest.id;
  const active=db.prepare(`SELECT id,status,provider,executor FROM ai_office_jobs WHERE created_by=?
    AND (id=? OR json_extract(context_json,'$.conversation_root')=?) AND status IN ('pending','running','waiting') ORDER BY rowid`)
    .all(latest.created_by,root,root);
  let selection={},execution=null;
  try{selection=JSON.parse(latest.selection_json||'{}')}catch{}
  const measured=db.prepare(`SELECT execution_json,finished_at FROM ai_office_jobs WHERE created_by=?
    AND (id=? OR json_extract(context_json,'$.conversation_root')=?) AND execution_json IS NOT NULL
    ORDER BY rowid DESC LIMIT 1`).get(latest.created_by,root,root);
  try{execution=normalizeExecution(JSON.parse(measured?.execution_json||'null'))}catch{}
  let contextUsage=null;
  try{contextUsage=normalizeExecution(JSON.parse(latest.execution_json||'null')).context||null}catch{}
  return {jobId:latest.id,status:latest.status,provider:latest.provider,executor:latest.executor||'vps',
    accountId:selection.accountId||latest.executor||'vps',model:selection.model||null,effort:selection.effort||null,
    workspace:selection.workspace||null,active,execution,measuredAt:measured?.finished_at||null,
    contextUsage,contextNote:'Context ước tính từ lần gọi model gần nhất, không phải token cộng dồn hay hạn mức gói. Chưa có số đo thì không suy đoán phần trăm.'};
}
function commandJob(db, source, requestId, command='compact', args='') {
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')) throw commandError('Thiếu mã yêu cầu nén hợp lệ');
  return db.transaction(()=>{
    const parent=latestTurn(db,source),root=contextOf(parent).conversation_root||parent.id;
    const prior=db.prepare(`SELECT * FROM ai_office_jobs WHERE created_by=?
      AND json_extract(context_json,'$.command_request_id')=?`).get(source.created_by,requestId);
    if(prior){
      if(contextOf(prior).session_command!==command||String(contextOf(prior).command_args||'')!==args)throw commandError('Mã yêu cầu đã dùng cho lệnh/nội dung khác');
      if((contextOf(prior).command_source_root||contextOf(prior).conversation_root||prior.id)!==root)throw commandError('Mã yêu cầu đã thuộc luồng khác');
      return {job:prior,existing:true};
    }
    if(parent.team_role)throw commandError('Lệnh native chỉ dùng cho chat một AI',409);
    if(parent.provider!=='codex'&&!['pwd','cwd','diff','init','compact'].includes(command))throw commandError('Lệnh này hiện chỉ hỗ trợ phiên ChatGPT/Codex; Claude chưa được nối chức năng gốc',409);
    if(db.prepare(`SELECT 1 FROM ai_office_jobs WHERE created_by=? AND
      (id=? OR json_extract(context_json,'$.conversation_root')=?) AND status IN ('pending','waiting','running')`)
      .get(parent.created_by,root,root))throw commandError('Chờ các lượt đang chạy hoặc đang xếp hàng xong trước khi nén',409);
    const context={...continueContext(parent,{},[],{light:true}),conversation_root:root,command_source_root:root,session_command:command,command_args:args,command_request_id:requestId};
    const id=randomUUID();
    if(command==='fork')context.conversation_root=id;
    db.prepare(`INSERT INTO ai_office_jobs(id,created_by,shop,question,kind,provider,selection_reason,
      context_json,executor,assigned_agent,allow_files,selection_json,project_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,parent.created_by,parent.shop,'/'+command+(args?' '+args:''),parent.kind,parent.provider,
      'Lệnh trực tiếp: /'+command,JSON.stringify({...context,session_scope:contextOf(parent).session_scope}),
      parent.executor,parent.assigned_agent,parent.allow_files,JSON.stringify(selectionOf(parent)),parent.project_id);
    return {job:db.prepare('SELECT * FROM ai_office_jobs WHERE id=?').get(id),existing:false};
  })();
}
const compactJob=(db,source,requestId)=>commandJob(db,source,requestId,'compact','');
function validateCommand(name,args='') {
  const command=commands.find(c=>c.name===name);
  if(!command)throw commandError('Lệnh không được hỗ trợ; dùng /help');
  if(command.reason)throw commandError(command.reason,409);
  if(typeof args!=='string'||args.length>4000||/[\x00-\x1f]/.test(args))throw commandError('Tham số lệnh không hợp lệ');
  if(args&&!command.args)throw commandError('/'+name+' không nhận tham số');
  return command;
}
module.exports={commands,isSlash,latestTurn,statusOf,compactJob,commandJob,validateCommand};
