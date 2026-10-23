export function conversationMarkdown(job){
  const turns=[...(job.conversation||[]),{question:job.question,answer:job.result||job.error||'Chưa có kết quả hoàn tất'}];
  return '# '+(job.conversationName||'Hội thoại Văn phòng AI')+'\n\n'+turns.map(t=>'## Bạn\n\n'+t.question+'\n\n## AI\n\n'+t.answer).join('\n\n');
}
export async function runSlashAction(command,args,{api,job,make,openJob,close,refresh,model,usage,rename,remove,logout,show}){
  const needsJob=['copy','export','rename','delete','logout','recap'];
  if(needsJob.includes(command)&&!job)throw new Error('Mở cuộc hội thoại trước khi dùng /'+command);
  if(command==='exit'||command==='quit'){close();return}
  if(command==='model'){await model(args);show('Đã mở/cập nhật lựa chọn model cho lượt gửi tiếp theo.');return}
  if(command==='usage'){usage();show('Đã mở hạn mức các tài khoản AI; chưa dùng lượt reset nào.');return}
  if(command==='rename'){await rename(args);return}
  if(command==='delete'){await remove();return}
  if(command==='logout'){await logout();return}
  if(command==='theme'){
    if(!['light','dark','system'].includes(args))throw new Error('Dùng /theme light, /theme dark hoặc /theme system');
    if(args==='system')localStorage.removeItem('tb_theme');else localStorage.setItem('tb_theme',args);
    window.dispatchEvent(new StorageEvent('storage',{key:'tb_theme',newValue:args==='system'?null:args}));show('Đã đổi giao diện: '+args);return;
  }
  if(command==='title'){
    let target=window;try{if(window.parent.location.origin===location.origin)target=window.parent}catch{}
    if(args)target.document.title=args;show('Tiêu đề tab: '+target.document.title);return;
  }
  if(command==='resume'||command==='agents'){
    const dialog=make('dialog','office-delete-dialog'),list=make('div','live-command-conversations');
    const cancel=make('button','soft-button','Đóng');cancel.type='button';cancel.onclick=()=>dialog.close();
    const more=make('button','soft-button','Xem thêm');more.type='button';let cursor=0;
    const load=async()=>{
      more.disabled=true;
      try{
        const data=await api('/conversations?cursor='+cursor);
        for(const row of data.items){const button=make('button','soft-button',`${row.name} · ${row.status}`);button.type='button';button.onclick=async()=>{try{await openJob(await api('/tasks/'+row.id));dialog.close()}catch(error){show(error.message)}};list.append(button)}
        cursor=data.nextCursor;more.hidden=cursor===null;
      }finally{more.disabled=false}
    };
    more.onclick=()=>load().catch(error=>show(error.message));
    dialog.append(make('h3','','Hội thoại đã lưu'),list,more,cancel);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
    await load();return;
  }
  const current=await api('/tasks/'+job.id);
  if(command==='recap'){
    const turns=[...(current.conversation||[]),{question:current.question,answer:current.result||current.error||''}];
    show('Điểm lại '+turns.length+' lượt (trích đoạn đã lưu, không gọi AI và không nén):\n\n'+turns.map((t,i)=>`${i+1}. ${t.question}\n${String(t.answer).slice(0,500)}${String(t.answer).length>500?'… [trích đoạn]':''}`).join('\n\n'));return;
  }
  if(command==='copy'){
    const answer=current.status==='done'?current.result:[...(current.conversation||[])].reverse().find(t=>t.answer)?.answer;
    if(!answer)throw new Error('Chưa có câu trả lời hoàn tất để sao chép');
    await navigator.clipboard.writeText(answer);show('Đã sao chép câu trả lời hoàn tất.');return;
  }
  if(command==='export'){
    const name=(args||current.conversationName||'hoi-thoai').replace(/[\\/\x00-\x1f]/g,'-').slice(0,160);
    const url=URL.createObjectURL(new Blob([conversationMarkdown(current)],{type:'text/markdown;charset=utf-8'}));
    const link=make('a');link.href=url;link.download=/\.md$/i.test(name)?name:name+'.md';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    show('Đã xuất hội thoại sang Markdown.');return;
  }
  throw new Error('Chưa nối hành động /'+command);
}
