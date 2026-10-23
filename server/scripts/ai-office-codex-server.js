const { spawn } = require('child_process');
const { normalizeExecution } = require('./ai-office-execution');
const {nativeActions,nativeCommand}=require('./ai-office-native-command');
const STOPPED='Đã dừng theo yêu cầu của bạn';
const readableError=(message,model)=>/model is not supported when using Codex with a ChatGPT account/i.test(String(message||''))
  ? `Tài khoản ChatGPT này chưa dùng được model ${model}. Hãy làm mới danh sách model hoặc chọn tài khoản/model khác.` : String(message||'CLI chưa hoàn thành lượt');
// Stdio app-server: no HTTP listener, no API key, one isolated thread branch per
// turn. Client-provided session IDs are never passed here.
function runCodexServer(command,{cwd,model,effort,fileAccess,parentSession,prompt,action=null,actionArgs='',settings={},images=[],control=async()=>({}),progress=()=>{},emit=()=>{},session=()=>{},acknowledge=async()=>{}}) {
  if (action && (!nativeActions.has(action) || !parentSession)) return Promise.reject(new Error('Lệnh cần phiên Codex đã lưu; không mở phiên mới thay thế'));
  return new Promise((resolve,reject)=>{
    const grouped=process.platform!=='win32';
    const child=spawn(command.binary,command.args,{cwd,env:command.env,detached:grouped,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer='',finished=false,requestId=0,threadId=null,turnId=null,polling=false,usage=null,phase='starting',compacted=false,commandResult=null,sessionSettings=null;
    let context=null;
    const contextTo=value=>{context=value;emit({kind:'context',context})};
    const pending=new Map(),messages=new Map();
    const report=next=>{try{progress(next)}catch{}};
    const phaseTo=next=>{if(phase!==next){phase=next;report(next)}};
    const write=value=>{if(!child.stdin.destroyed)child.stdin.write(JSON.stringify(value)+'\n')};
    const rpc=(method,params)=>new Promise((yes,no)=>{const id=++requestId;pending.set(id,{yes,no});write({id,method,params})});
    const killGroup=()=>{try{grouped?process.kill(-child.pid,'SIGKILL'):child.kill('SIGKILL')}catch{}};
    const finish=(error)=>{
      if(finished)return;finished=true;clearInterval(timer);
      if(error&&(action==='compact'||context?.state==='compacting'))contextTo({state:'unknown',measuredAt:Date.now()});
      process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);
      emit({kind:'ready',canSteer:false});
      for(const p of pending.values())p.no(error||new Error('Phiên CLI đã kết thúc'));pending.clear();
      child.stdin.end();if(error)killGroup();else child.kill('SIGTERM');
      if(error)reject(error);
      else resolve({sessionId:threadId,result:commandResult||(action==='compact'?'Đã nén ngữ cảnh bằng chức năng gốc của Codex. Bạn có thể tiếp tục trong cùng phiên; lịch sử hiển thị vẫn được giữ.':[...messages.values()].filter(m=>m.phase!=='commentary').map(m=>m.text).join('\n\n')||[...messages.values()].map(m=>m.text).join('\n\n')),
        execution:normalizeExecution({model,effort,usage,context,sessionSettings})});
    };
    const shutdown=()=>{killGroup();process.exit(0)};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
    const tick=async()=>{
      if(finished||polling)return;polling=true;
      try{
        const state=await control();if(finished)return;
        if(state.cancelRequested)return finish(new Error(STOPPED));
        for(const input of state.inputs||[]){
          if(action){await acknowledge(input.id,'error');continue}
          if(finished||!threadId||!turnId){await acknowledge(input.id,'error');continue}
          // A lost response can mean a real instruction was accepted. Never
          // replay automatically; keep that input uncertain until inspected.
          let accepted=false;
          try{await rpc('turn/steer',{threadId,expectedTurnId:turnId,clientUserMessageId:input.id,input:[{type:'text',text:input.content,text_elements:[]}]});accepted=true;await acknowledge(input.id,'accepted')}
          catch(error){await acknowledge(input.id,accepted||finished?'uncertain':'error').catch(()=>{})}
        }
      }catch{/* Transport outage: keep the turn alive, do not resend sent inputs. */}
      finally{polling=false}
    };
    const timer=setInterval(tick,1000);tick();
    report(command.binary==='/usr/bin/flock'?'waiting_tool':'starting');
    function notice(method,p){
      if(finished)return;
      if(p.threadId && threadId && p.threadId!==threadId)return;
      if(method==='turn/started'){turnId=p.turn.id;phaseTo('thinking')}
      if(method==='item/agentMessage/delta'){
        const m=messages.get(p.itemId)||{text:'',phase:null};m.text+=p.delta||'';messages.set(p.itemId,m);
        emit({kind:'text',text:p.delta||''});phaseTo('writing');
      }
      if(method==='item/started'){
        const item=p.item||{};
        if(item.type==='contextCompaction')contextTo({state:'compacting',measuredAt:Date.now()});
        if(item.type==='agentMessage'){if([...messages.values()].some(m=>m.text))emit({kind:'text',text:'\n\n'});messages.set(item.id,{text:'',phase:item.phase})}
        const type={commandExecution:'command',fileChange:'file',webSearch:'search',mcpToolCall:'tool',dynamicToolCall:'tool',contextCompaction:'compact'}[item.type];
        if(type){emit({kind:'activity',type});phaseTo('tool')}
      }
      if(method==='item/completed'&&p.item?.type==='agentMessage'){
        const old=messages.get(p.item.id);const text=p.item.text||'';
        if(!old?.text&&text)emit({kind:'text',text});
        messages.set(p.item.id,{text:text||old?.text||'',phase:p.item.phase||old?.phase});
      }
      if(method==='item/completed'&&p.item?.type==='contextCompaction'){
        compacted=true;if(action!=='compact')contextTo({state:'awaiting',measuredAt:Date.now()});
      }
      if(method==='thread/tokenUsage/updated'){
        const u=p.tokenUsage?.last;if(u)usage={input:u.inputTokens,cached:u.cachedInputTokens,output:u.outputTokens};
        // Last model request approximates occupied context; cumulative total counts
        // repeated inputs and must never be used as context size. Cache is included.
        if(u)contextTo({state:'measured',used:u.totalTokens,limit:p.tokenUsage.modelContextWindow,measuredAt:Date.now()});
      }
      if(method==='turn/completed'){
        if(action==='compact'&&compacted&&p.turn.status==='completed')contextTo({state:'awaiting',measuredAt:Date.now()});
        if(p.turn.status==='completed')finish(action==='compact'&&!compacted?new Error('CLI kết thúc nhưng chưa xác nhận nén ngữ cảnh; không tự thử lại'):undefined);
        else finish(new Error(p.turn.status==='interrupted'?STOPPED:readableError(p.turn.error?.message,model)));
      }
    }
    child.stdout.setEncoding('utf8');child.stderr.resume();
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let i;
      while((i=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let row;try{row=JSON.parse(line)}catch{continue}
        if(row.id!=null&&!row.method){const p=pending.get(row.id);if(!p)continue;pending.delete(row.id);row.error?p.no(new Error(readableError(row.error.message||'CLI RPC lỗi',model))):p.yes(row.result);continue}
        if(row.id!=null&&row.method){
          if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(row.method))write({id:row.id,result:{decision:fileAccess?'accept':'decline'}});
          else write({id:row.id,error:{code:-32601,message:'Hãy đặt câu hỏi trong lời trả lời để người dùng nhắn tiếp trên giao diện.'}});
          continue;
        }
        try{notice(row.method,row.params||{})}catch(error){finish(error)}
      }
    });
    child.stdin.on('error',()=>{});child.on('error',error=>finish(error));
    child.on('close',()=>{if(!finished)finish(new Error('Kết nối CLI bị ngắt; kiểm tra kết quả trước khi gửi lại'))});
    (async()=>{
      await rpc('initialize',{clientInfo:{name:'office_ai',title:'Office AI AI Office',version:'2.0.0'},...((action&&action!=='compact')||settings.collaborationMode?{capabilities:{experimentalApi:true}}:{})});write({method:'initialized'});
      const auth=await rpc('account/read',{refreshToken:false});
      if(auth.account?.type!=='chatgpt')throw new Error('Chỉ cho phép tài khoản ChatGPT subscription; không dùng API key');
      const params={model,modelProvider:'openai',cwd,approvalPolicy:'never',sandbox:fileAccess?'danger-full-access':'read-only',
        config:{forced_login_method:'chatgpt'},ephemeral:false};
      // Continue the worker's real Codex thread. A fork for every chat message
      // drops the linear agent experience and can strand newly attached images
      // on a sibling branch.
      const created=await rpc(parentSession?'thread/resume':'thread/start',parentSession?{...params,threadId:parentSession}:params);
      model=created.model||model;effort=effort||created.reasoningEffort;
      threadId=created.thread?.id;if(!threadId)throw new Error('CLI chưa trả ID hội thoại');
      if(action&&threadId!==parentSession)throw new Error('CLI không tiếp tục đúng phiên cũ; không thực hiện lệnh');
      if(action!=='fork')session(threadId);
      if(action&&action!=='compact'){emit({kind:'activity',type:'tool'});phaseTo('tool')}
      if(action==='fork'){
        const fork=await rpc('thread/fork',{threadId,...params,deferGoalContinuation:true,excludeTurns:true});
        const forkId=fork.thread?.id;if(!forkId||forkId===threadId)throw new Error('CLI chưa xác nhận phiên nhánh riêng');
        threadId=forkId;session(threadId);commandResult='Đã tạo nhánh CLI độc lập với lịch sử phiên gốc. Các tin tiếp theo ở luồng này dùng phiên nhánh; luồng gốc giữ nguyên.';finish();return;
      }
      if(action==='compact'){
        contextTo({state:'compacting',measuredAt:Date.now()});
        emit({kind:'activity',type:'compact'});phaseTo('tool');
        await rpc('thread/compact/start',{threadId});
        return; // ACK only starts compaction; wait for contextCompaction + turn/completed.
      }
      if(action==='review'){
        await rpc('review/start',{threadId,delivery:'inline',target:actionArgs?{type:'baseBranch',branch:actionArgs}:{type:'uncommittedChanges'}});return;
      }
      if(action){
        const result=await nativeCommand(action,actionArgs,{rpc,threadId,cwd,model,effort,fileAccess,settings});
        commandResult=result.result;sessionSettings=result.sessionSettings;finish();return;
      }
      const collaborationMode=['plan','default'].includes(settings.collaborationMode)?{mode:settings.collaborationMode,settings:{model,reasoning_effort:effort||null,developer_instructions:null}}:null;
      const started=await rpc('turn/start',{threadId,cwd,model,effort:effort||null,...(collaborationMode?{collaborationMode}:{}),...(Object.hasOwn(settings,'serviceTier')?{serviceTier:settings.serviceTier}:{}),input:[{type:'text',text:prompt,text_elements:[]},...images.map(path=>({type:'localImage',path}))]});
      if(!finished){turnId=started.turn?.id||turnId;emit({kind:'ready',canSteer:!!turnId});phaseTo('thinking')}
    })().catch(error=>finish(error));
  });
}
module.exports={runCodexServer};
