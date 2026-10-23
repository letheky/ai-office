import { COMMANDS } from './office-command-catalog.mjs?v=2';
import {contextView} from './office-context.mjs?v=3';
export { COMMANDS };
export function parseSlash(value) {
  const text=String(value||'').trim();
  if(!text.startsWith('/'))return null;
  const match=/^\/([a-z][a-z0-9-]*)(?:[ \t]+([^\r\n]*))?$/i.exec(text);
  const command=match&&COMMANDS.find(c=>c.name===match[1].toLowerCase());
  if(!command)return {error:'Lệnh không hợp lệ. Dùng /help để xem danh sách.'};
  const args=(match[2]||'').trim();
  if(args&&!command.args)return {error:'/'+command.name+' không nhận tham số.'};
  if(args.length>4000||/[\x00-\x1f]/.test(args))return {error:'Tham số lệnh không hợp lệ.'};
  return {name:command.name,args};
}
export function suggestions(value) {
  const text=String(value||'').trimStart();
  return /^\/[a-z0-9-]*$/i.test(text)?COMMANDS.filter(c=>c.name.startsWith(text.slice(1).toLowerCase())):[];
}
let nextId=0;
export function mountSlash({form,input,make,api,job=null,attachments,onNew,onJob,describeStatus,onAction}) {
  input.placeholder=(input.placeholder?input.placeholder+' · ':'')+'Gõ / để xem lệnh';
  const box=make('section','live-slash'),menu=make('div','live-slash-menu'),output=make('div','live-slash-output');
  menu.id=`office-slash-${++nextId}`;menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Gợi ý lệnh');menu.hidden=true;
  output.setAttribute('role','status');output.setAttribute('aria-live','polite');output.hidden=true;
  box.append(menu,output);input.after(box);
  input.setAttribute('aria-controls',menu.id);input.setAttribute('aria-autocomplete','list');
  let active=0,choices=[],dismissed=false,busy=false,requestId=null;
  const unavailable=command=>{
    if(command.reason)return command.reason;
    if(command.handler!=='native')return '';
    if(!job)return 'Cần một cuộc chat đã có máy/phiên';
    if(job.provider!=='codex'&&!['pwd','cwd','diff','init','compact'].includes(command.name))return 'Lệnh này cần phiên Codex; chưa nối CLI Claude';
    if(job.teamRole||['running','pending','waiting'].includes(job.status))return 'Chờ chat một AI rảnh trước khi chạy lệnh native';
    return '';
  };
  const message=text=>{output.replaceChildren(make('p','',text));output.hidden=false};
  const close=()=>{menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant')};
  const choose=command=>{input.value='/'+command.name;dismissed=true;close();input.dispatchEvent(new Event('input',{bubbles:true}));dismissed=true;close();input.focus()};
  const paint=()=>{
    choices=suggestions(input.value);active=Math.min(active,Math.max(0,choices.length-1));
    if(dismissed||!choices.length){close();return}
    menu.replaceChildren();menu.hidden=false;input.setAttribute('aria-expanded','true');
    choices.forEach((command,i)=>{
      const button=make('button','live-slash-option');button.type='button';button.id=menu.id+'-'+command.name;
      button.setAttribute('role','option');button.setAttribute('aria-selected',String(i===active));
      const disabled=unavailable(command);button.setAttribute('aria-disabled',String(!!disabled));
      button.append(make('strong','','/'+command.name),make('span','',command.description));
      if(disabled)button.append(make('small','',disabled));
      else if(command.usage)button.append(make('small','',command.usage));
      button.onmousedown=e=>e.preventDefault();
      button.onclick=()=>{choose(command);form.requestSubmit()};menu.append(button);
    });
    if(choices[active])input.setAttribute('aria-activedescendant',menu.id+'-'+choices[active].name);
    menu.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
  };
  input.addEventListener('input',()=>{active=0;dismissed=false;paint()});
  input.addEventListener('focus',paint);
  input.addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(!menu.hidden&&['ArrowDown','ArrowUp','Tab','Enter','Escape'].includes(event.key)){
      if(event.key==='Enter'&&(event.shiftKey||event.ctrlKey||event.metaKey))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Escape'){dismissed=true;close();return}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){active=(active+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;paint();return}
      const selected=choices[active];if(selected)choose(selected);
      if(event.key==='Enter')form.requestSubmit();
    }
  },true);
  const count=value=>Number.isFinite(value)?value.toLocaleString('vi-VN'):'Chưa có số liệu';
  const showStatus=data=>{
    output.replaceChildren(make('strong','','Trạng thái phiên'));
    const who=describeStatus?.(data)||`${data.provider==='codex'?'ChatGPT':'Claude'} · ${data.executor}`;
    for(const text of [who,`Model: ${data.model||'Chưa xác định'} · Effort: ${data.effort||'Tự động'}`,
      `Trạng thái: ${data.active?.length ? 'Có '+data.active.length+' lượt đang chạy/chờ' : 'Không có lượt đang chạy/chờ'}`,
      `Token lượt đã đo gần nhất: đầu vào ${count(data.execution?.usage?.input)}, cache ${count(data.execution?.usage?.cached)}, đầu ra ${count(data.execution?.usage?.output)}`,
      contextView(data.contextUsage,data.provider).label,contextView(data.contextUsage,data.provider).note,
      data.contextNote])if(text)output.append(make('p','',text));
    output.hidden=false;
  };
  const run=async()=>{
    const parsed=parseSlash(input.value);if(!parsed)return;
    close();
    if(parsed.error){message(parsed.error);return}
    if(busy){message('Lệnh đang được xử lý.');return}
    const command=parsed.name,args=parsed.args,descriptor=COMMANDS.find(c=>c.name===command);
    if(descriptor.reason){message(descriptor.reason);return}
    if((['new','clear','delete','logout','resume','agents'].includes(command)||descriptor.handler==='native')&&attachments?.hasPending()){message('Bỏ hoặc gửi các tệp đang đính kèm trước khi chạy lệnh này.');return}
    if(command==='help'){
      output.replaceChildren(make('strong','',`${COMMANDS.length} lệnh · ${COMMANDS.filter(c=>!c.reason).length} có chức năng · ${COMMANDS.filter(c=>c.reason).length} chưa khả dụng ở giao diện này`));
      COMMANDS.forEach(c=>output.append(make('p','',`/${c.name} — ${c.description}${c.reason?' · Chưa khả dụng: '+c.reason:''}${c.usage?' · '+c.usage:''}`)));
      output.append(make('p','','/compact dùng CLI subscription và có thể tiêu hạn mức. Claude chưa hỗ trợ nén gốc trong giao diện này.'));
      output.hidden=false;input.value='';return;
    }
    if(command==='new'||command==='clear'){input.value='';onNew();return}
    if(command==='status'&&!job){message('Chưa có phiên AI trong form giao việc mới. Mở một cuộc chat để xem /status.');input.value='';return}
    const reason=unavailable(descriptor);if(reason){message(reason);return}
    busy=true;
    try{
      if(descriptor.handler==='ui'){
        if(!onAction)throw new Error('Chưa nối hành động giao diện cho lệnh này');
        await onAction(command,args,message);input.value='';return;
      }
      if(descriptor.handler==='native')requestId ||= crypto.randomUUID();
      message(descriptor.handler==='native'?'Đang gửi lệnh /'+command+'…':'Đang đọc trạng thái…');
      const data=await api(`/tasks/${job.id}/command`,{method:'POST',body:JSON.stringify({command,args,...(descriptor.handler==='native'?{requestId}:{})})});
      input.value='';requestId=null;
      if(data.action==='job')await onJob(data.job);
      else showStatus(data);
    }catch(error){message(error.message+(error.status?'':' Chưa rõ server đã nhận lệnh chưa; không tự thử lại. Gửi lại cùng lệnh sẽ dùng cùng mã yêu cầu.'));if(error.status)requestId=null}
    finally{busy=false}
  };
  form.addEventListener('submit',event=>{
    if(!parseSlash(input.value))return;
    event.preventDefault();event.stopImmediatePropagation();void run();
  },true);
  form.addEventListener('click',event=>{
    if(parseSlash(input.value)&&event.target.closest('.live-steer')){event.preventDefault();event.stopImmediatePropagation();form.requestSubmit()}
  },true);
  paint();
  return {run};
}
