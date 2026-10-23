const nativeActions=new Set(['compact','fork','review','plan','fast','goal','ps','stop','mcp','apps','plugins','skills','hooks','permissions','experimental','memories','subagents','debug-config']);
const fields=new Set(['id','name','displayName','description','status','enabled','stage','eventName','trustStatus','sourcePath','path','cwd','model','processId','pid','startedAt','objective','tokenBudget','tokensUsed','timeUsedSeconds','createdAt','updatedAt','v2Ready','v2ConsolidatedThreads']);
const containers=new Set(['data','skills','hooks','plugins','marketplaces','profiles','features','goal','threads']);
function safeTree(value,depth=0){
  if(depth>8)return null;
  if(Array.isArray(value))return value.slice(0,500).map(v=>safeTree(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>fields.has(k)||containers.has(k)).map(([k,v])=>[k,safeTree(v,depth+1)]));
  return typeof value==='string'?value.slice(0,2000):value;
}
function report(title,value){
  const text=typeof value==='string'?value:JSON.stringify(value,null,2);
  const body=text.length>200000?text.slice(0,200000)+'\n[Chỉ hiển thị 200.000 ký tự đầu]':text;
  return {result:title+'\n\n'+body};
}
async function nativeCommand(action,args,{rpc,threadId,cwd,model,effort,fileAccess,settings={}}){
  if(action==='debug-config')return report('Cấu hình thực thi của worker (không xuất env/token hay cấu hình bí mật)',{cwd,model,effort,approvalPolicy:'never',sandbox:fileAccess?'danger-full-access':'read-only',collaborationMode:settings.collaborationMode||'default',serviceTier:settings.serviceTier||null});
  if(action==='plan'){
    if(args&&!['on','off'].includes(args))throw new Error('Dùng /plan [on|off]');
    const mode=args==='off'?'default':args==='on'?'plan':settings.collaborationMode==='plan'?'default':'plan';
    await rpc('thread/settings/update',{threadId,collaborationMode:{mode,settings:{model,reasoning_effort:effort||null,developer_instructions:null}}});
    return {result:mode==='plan'?'Đã bật chế độ lập kế hoạch gốc cho lượt tiếp theo.':'Đã trở lại chế độ làm việc mặc định.',sessionSettings:{collaborationMode:mode}};
  }
  if(action==='fast'){
    if(args&&!['on','off'].includes(args))throw new Error('Dùng /fast [on|off]');
    const enable=args==='on'||(!args&&settings.serviceTier!=='fast');
    if(enable){
      let cursor=null,found=null;
      do{const page=await rpc('model/list',{limit:100,cursor});found=(page.data||[]).find(m=>m.id===model||m.model===model);cursor=page.nextCursor||null}while(!found&&cursor);
      if(!found?.serviceTiers?.some(t=>t.id==='fast'))throw new Error('Model/tài khoản này không quảng bá tầng fast; không tự chọn tầng khác.');
    }
    await rpc('thread/settings/update',{threadId,serviceTier:enable?'fast':null});
    return {result:enable?'Đã bật tầng fast gốc cho các lượt tiếp theo.':'Đã tắt tầng fast.',sessionSettings:{serviceTier:enable?'fast':null}};
  }
  if(action==='goal'){
    let result;
    if(!args)result=await rpc('thread/goal/get',{threadId});
    else if(args==='clear'){await rpc('thread/goal/clear',{threadId,origin:'user'});return report('Mục tiêu phiên','Đã xóa mục tiêu theo lệnh của bạn.')}
    else if(args==='pause'||args==='resume'){
      const current=await rpc('thread/goal/get',{threadId});if(!current.goal)throw new Error('Phiên chưa có mục tiêu để tạm dừng/tiếp tục');
      result=await rpc('thread/goal/set',{threadId,origin:'user',status:args==='pause'?'paused':'active'});
    }else result=await rpc('thread/goal/set',{threadId,origin:'user',objective:args});
    return report('Mục tiêu gốc của phiên',safeTree(result));
  }
  if(action==='memories'){
    if(args&&!['on','off'].includes(args))throw new Error('Dùng /memories [on|off]');
    if(args)await rpc('thread/memoryMode/set',{threadId,mode:args==='on'?'enabled':'disabled'});
    const result=await rpc('memory/status',{});
    return report('Memory CLI'+(args?' · đã '+(args==='on'?'bật':'tắt')+' cho phiên':''),safeTree(result));
  }
  if(action==='stop'){
    await rpc('thread/backgroundTerminals/clean',{threadId});
    return report('Terminal nền','CLI đã xác nhận dọn/dừng các terminal nền của phiên. Lệnh này không tắt dịch vụ worker.');
  }
  const calls={
    mcp:['mcpServerStatus/list',{limit:100}],apps:['app/list',{threadId,limit:100}],
    plugins:['plugin/list',{cwds:[cwd],forceRefetch:false}],skills:['skills/list',{cwds:[cwd]}],
    hooks:['hooks/list',{cwds:[cwd]}],permissions:['permissionProfile/list',{cwd}],
    experimental:['experimentalFeature/list',{threadId,limit:100}],
    ps:['thread/backgroundTerminals/list',{threadId,limit:100}],
    subagents:['thread/list',{parentThreadId:threadId,limit:100}],
  };
  const call=calls[action];if(!call)throw new Error('Lệnh native không được hỗ trợ');
  let result=await rpc(...call);
  if(action==='mcp')result={data:(result.data||[]).map(s=>({name:s.name,status:s.runtimeStatus,authStatus:s.authStatus,tools:Object.keys(s.tools||{})}))};
  else result=safeTree(result);
  return report('/'+action+' · dữ liệu thực từ CLI (chỉ xem, không tự cài/gỡ hay sửa cấu hình)',result);
}
module.exports={nativeActions,nativeCommand,safeTree};
