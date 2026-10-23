// Folder browsing happens on the selected worker; never use the browser's own
// filesystem picker for a remote machine. CLI text/activity are plain data.
import {workspacePicker} from './office-workspace.mjs?v=dev-1';
import {paintContext} from './office-context.mjs?v=3';
const renderedAnswers=new WeakMap();
export function paintStreamingAnswer(answer,text,status,renderAnswer){
  if(!answer||!['running','pending','waiting'].includes(status)||!text||renderedAnswers.get(answer)===text)return;
  answer.replaceChildren();renderAnswer(answer,text);renderedAnswers.set(answer,text);answer.classList.toggle('is-streaming',status==='running');
}
export function cliFeatures({api,make,renderAnswer,capabilities,visibleId,contextJob=job=>job}) {
  const states=new Map();let reading=false;
  function state(id){if(!states.has(id))states.set(id,{cursor:0,text:'',activities:[],canSteer:false,workspace:null,inputs:[]});return states.get(id)}
  function paint(job){
    if(visibleId()!==job.id)return;
    const s=state(job.id),body=document.getElementById('result-body');
    const source=contextJob(job),sourceState=state(source.id),snapshot=source.execution?.context;
    if(snapshot&&(!sourceState.context||snapshot.measuredAt>=sourceState.context.measuredAt))sourceState.context=snapshot;
    const meter=body.querySelector('.live-context');if(meter)paintContext(meter,sourceState.context,source.provider||sourceState.provider,make);
    const answer=body.querySelector('#live-cli-answer');
    paintStreamingAnswer(answer,s.text,job.status,renderAnswer);
    if(job.status==='error'&&s.text&&!body.querySelector('.live-cli-partial')){
      const partial=make('details','live-cli-partial');partial.append(make('summary','','Nội dung trước khi dừng / lỗi'));
      const text=make('div','live-result');renderAnswer(text,s.text);partial.append(text);body.append(partial);
    }
    const folder=body.querySelector('.live-cli-folder');
    if(folder)folder.textContent=s.workspace||job.workspace||'Thư mục mặc định của worker';
    const list=body.querySelector('.live-cli-activity-list');
    if(list){
      list.replaceChildren();for(const item of s.activities){const row=make('li');row.textContent=`${new Date(item.createdAt).toLocaleTimeString('vi-VN')} · ${item.label}`;list.append(row)}
      body.querySelector('.live-cli-activity > summary').textContent=`Hoạt động CLI (${s.activities.length})`;
    }
    const messages=body.querySelector('.live-cli-inputs');
    if(messages){
      const labels={pending:'Chờ worker nhận',sent:'Đã chuyển worker · chờ CLI xác nhận',accepted:'CLI đã nhận',error:'Chưa gửi được; lượt có thể đã kết thúc',uncertain:'Chưa xác nhận được; không tự gửi lại'};
      messages.replaceChildren();for(const input of s.inputs){const row=make('div','live-cli-input');row.append(make('p','',input.content),make('small','',labels[input.status]||input.status));messages.append(row)}
    }
    const steer=body.querySelector('.live-steer');if(steer)steer.disabled=!s.canSteer||job.status!=='running'||steer.dataset.uncertain==='1'||steer.dataset.busy==='1';
  }
  function mount(job){
    const body=document.getElementById('result-body');
    const current=state(job.id);current.provider=job.provider;
    if(current.context===undefined)current.context=job.execution?.context||null;
    const context=make('section','live-context');context.setAttribute('aria-label','Dung lượng ngữ cảnh');
    const followup=body.querySelector('.live-followup');
    if(followup)followup.before(context);else body.querySelector('#live-cli-answer').before(context);
    if(job.workspace&&!state(job.id).workspace)state(job.id).workspace=job.workspace;
    const meta=make('section','live-cli-meta');
    meta.append(make('span','','📁 '),make('code','live-cli-folder',state(job.id).workspace||job.workspace||'Thư mục mặc định của worker'));
    const details=make('details','live-cli-activity');details.append(make('summary','','Hoạt động CLI'),make('ol','live-cli-activity-list'));meta.append(details,make('div','live-cli-inputs'));
    body.querySelector('#live-cli-answer').after(meta);
    const form=body.querySelector('.live-followup');
    if(form&&job.provider==='codex'&&job.status==='running'){
      const button=make('button','soft-button live-steer','Điều chỉnh ngay');button.type='button';
      button.title='Gửi bổ sung vào lượt ChatGPT đang chạy; giữ nguyên máy, model và thư mục';
      const input=form.querySelector('textarea'),status=form.querySelector('[role=status]');
      input.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();if(button.dataset.busy==='1'||button.dataset.uncertain==='1')return;if(!button.disabled)button.click();else form.requestSubmit()}
      },true);
      input.addEventListener('input',()=>{delete button.dataset.uncertain;paint(job)});
      button.onclick=async()=>{
        const content=input.value.trim();if(!content||button.disabled)return;button.disabled=true;button.dataset.busy='1';
        try{await api(`/tasks/${job.id}/input`,{method:'POST',body:JSON.stringify({content})});input.value='';status.textContent='Đã gửi yêu cầu điều chỉnh. Trạng thái nhận của CLI hiển thị ở trên.';await read(job)}
        catch(error){status.textContent=error.status?error.message:'Chưa xác nhận yêu cầu đã được nhận. Kiểm tra trạng thái ở trên trước khi gửi lại.';if(!error.status)button.dataset.uncertain='1'}
        finally{delete button.dataset.busy;paint(job)}
      };
      form.querySelector('[type=submit]').before(button);
    }
    paint(job);read(job);
  }
  function updateContext(job){
    const s=state(job.id),context=job.execution?.context;
    if(context&&(!s.context||context.measuredAt>=s.context.measuredAt))s.context=context;
    s.provider=job.provider;paint(job);
  }
  async function read(job){
    if(reading||visibleId()!==job.id||document.getElementById('result-modal').hidden)return;
    reading=true;
    try{
      const s=state(job.id),data=await api(`/tasks/${job.id}/live?after=${s.cursor}`);
      for(const event of data.events){
        if(event.id<=s.cursor)continue;s.cursor=event.id;
        if(event.kind==='reset'){s.text='';s.activities=[];s.canSteer=false;s.context=null}
        if(event.kind==='text')s.text+=event.text;
        if(event.kind==='activity')s.activities.push(event);
        if(event.kind==='ready')s.canSteer=event.canSteer;
        if(event.kind==='workspace')s.workspace=event.path;
        if(event.kind==='context'&&(!s.context||event.context.measuredAt>=s.context.measuredAt))s.context=event.context;
      }
      s.inputs=data.inputs;paint({...job,status:data.status});
    }catch{/* Main task polling already reports login/network errors. */}
    finally{reading=false}
  }
  setInterval(()=>{const id=visibleId();if(id)read({id,status:document.getElementById('result-modal').dataset.jobStatus})},1000);
  function workspaceControl({executor,accountsOf}){
    return workspacePicker({executor,make,enabled:capabilities().fileAccess,browse:(selected,initial,choose)=>{
      const member=accountsOf(capabilities(),selected).find(a=>a.online&&!a.removalPending);
      const target=selected==='vps'||selected.startsWith('vps:')?'vps':member?.id;
      if(!target)return false;
      folderDialog(target,initial,choose);return true;
    }});
  }
  function folderDialog(machineId,initial,choose){
    if(document.querySelector('.live-folder-dialog'))return;
    const previous=document.activeElement,dialog=make('dialog','live-folder-dialog');
    const title=make('h2','','Chọn thư mục làm việc');title.id='live-folder-title';dialog.setAttribute('aria-labelledby',title.id);
    const form=make('form','live-folder-navigation'),input=make('input');input.type='text';input.placeholder='Đường dẫn tuyệt đối hoặc ~';input.value=initial||'';input.setAttribute('aria-label','Đường dẫn trên máy xử lý');
    const open=make('button','soft-button','Mở');open.type='submit';form.append(input,open);
    const status=make('p','live-folder-status');status.setAttribute('role','status');
    const up=make('button','soft-button','↑ Thư mục cha');up.type='button';
    const list=make('div','live-folder-list');
    const actions=make('div','live-folder-actions'),cancel=make('button','soft-button','Hủy'),select=make('button','primary','Dùng thư mục này');cancel.type=select.type='button';select.disabled=true;
    actions.append(cancel,select);dialog.append(title,form,status,up,list,actions);document.body.append(dialog);
    let current=null,closed=false,controller=null,wake=null,timer;
    const pause=()=>new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,1500)});
    const load=async path=>{
      controller?.abort();const own=new AbortController();controller=own;select.disabled=true;up.disabled=true;open.disabled=true;list.replaceChildren();status.textContent='Đang đọc thư mục từ máy xử lý…';
      try{
        let response=await api('/folders/browse',{method:'POST',body:JSON.stringify({machineId,path:path||undefined}),signal:own.signal});
        while(response.id&&!closed){
          const command=await api(`/usage/command/${response.id}`,{signal:own.signal});
          if(command.status==='error')throw new Error(command.error||'Không đọc được thư mục');
          if(command.status==='done'){response={result:command.result};break}
          await pause();if(own.signal.aborted)return;
        }
        if(closed||own.signal.aborted)return;
        current=response.result;if(!current)throw new Error('Worker chưa trả danh sách thư mục');input.value=current.current;
        status.textContent=current.current;up.disabled=current.parent===current.current;select.disabled=false;
        for(const folder of current.folders){const child=make('button','live-folder-entry',`📁 ${folder.name}`);child.type='button';child.onclick=()=>load(folder.path);list.append(child)}
        if(!current.folders.length)list.append(make('p','','Không có thư mục con.'));
      }catch(error){if(!closed&&error.name!=='AbortError')status.textContent=error.message}
      finally{if(controller===own)open.disabled=false}
    };
    form.onsubmit=event=>{event.preventDefault();load(input.value.trim())};up.onclick=()=>current&&load(current.parent);
    select.onclick=()=>{if(current&&!select.disabled){choose(current.current);dialog.close()}};cancel.onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{closed=true;controller?.abort();clearTimeout(timer);wake?.();dialog.remove();previous?.focus()},{once:true});
    dialog.showModal();load(initial);
  }
  return {mount,workspaceControl,updateContext};
}
