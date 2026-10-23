export const isDocument = file => /\.(xlsx|txt)$/i.test(file.name);
export const isDirectAttachment = file => /\.(jpe?g|png|webp|gif|xlsx|txt)$/i.test(file.name) && file.size <= 20*1024*1024;

// Pending media stays attached to its composer while task polling rebuilds it.
export function attachmentControls({api, make, enabled}) {
  const drafts = new Map();
  const dropHandlers = new WeakMap();
  return function mount(form, text, key, existingProject) {
    if (!enabled()) return {prepare:async()=>existingProject, clear(){}, unlock(){}, hasPending:()=>false, canSendDirect:()=>false, imageNames:()=>[], mediaIds:()=>[]};
    if (!drafts.has(key)) drafts.set(key,{items:[], projectId:null, direct:null, busy:false});
    const state=drafts.get(key);
    const dropZone=form.closest('.modal')||form;
    dropHandlers.get(dropZone)?.abort();
    const dropController=new AbortController();dropHandlers.set(dropZone,dropController);
    dropZone.classList.add('live-drop-target');
    const box=make('section','live-attachments');
    const label=make('label','','Thả tệp vào ô chat, dán ảnh (Ctrl+V) hoặc chọn tệp');
    const picker=make('input'); picker.type='file'; picker.multiple=true; picker.accept='image/*,video/*,.xlsx,.txt';
    label.append(picker);
    const note=make('small','','Tối đa 10 tệp/lượt. Excel .xlsx, TXT và ảnh đến 20 MB/tệp gửi trực tiếp tới máy AI. Excel .xls cần lưu lại thành .xlsx. Video và ảnh lớn dùng Drive.');
    const list=make('div','live-attachment-list'),status=make('p','live-followup-status');status.setAttribute('role','status');
    box.append(label,note,list,status);
    form.querySelector('[type=submit]').before(box);
    const paint=()=>{
      list.replaceChildren(); picker.disabled=state.busy;
      form.querySelector('[type=submit]').disabled=state.busy;
      status.textContent=state.message||`${state.items.length}/10 tệp đã chọn`;
      text.required=!state.items.length;
      for(const item of state.items){
        const row=make('div','live-attachment');
        const preview=make(isDocument(item.file)?'span':item.file.type.startsWith('image/')?'img':'video');
        if(isDocument(item.file)) preview.textContent=/\.xlsx$/i.test(item.file.name)?'📊':'📄';
        else preview.src=item.url;
        if(preview.tagName==='IMG') preview.alt=item.file.name;
        else if(preview.tagName==='VIDEO') {preview.controls=true;preview.preload='metadata';}
        row.append(preview,make('span','',item.file.name+(item.saved?' · Đã tải lên':'')));
        const remove=make('button','soft-button','Bỏ');remove.type='button';remove.disabled=state.busy||item.saved;
        if(item.saved)remove.title='Tệp đã tải lên';
        remove.onclick=()=>{URL.revokeObjectURL(item.url);state.items=state.items.filter(i=>i!==item);state.repaint()};
        row.append(remove);list.append(row);
      }
    };
    state.repaint=paint;
    const addFiles=files=>{
      state.message='';
      for(let file of files){
        if(state.items.length>=10){state.message='Mỗi lượt đính kèm tối đa 10 tệp.';break;}
        if(file.size>2*1024**3){state.message='Chỉ chọn ảnh/video tối đa 2 GB mỗi tệp.';continue;}
        if(!file.type&&/\.(jpe?g|png|webp|gif)$/i.test(file.name)){
          const mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'}[file.name.split('.').pop().toLowerCase()];
          file=new File([file],file.name,{type:mime,lastModified:file.lastModified});
        }
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[file.type];
        if(extension&&!/\.(jpe?g|png|webp|gif)$/i.test(file.name))
          file=new File([file],`anh-${Date.now()}-${state.items.length+1}.${extension}`,{type:file.type,lastModified:file.lastModified});
        if(!isDocument(file)&&!/^(image|video)\//.test(file.type)){state.message='Chọn ảnh, video, Excel .xlsx hoặc TXT. File .xls cần lưu lại thành .xlsx.';continue;}
        if(isDocument(file)&&file.size>20*1024*1024){state.message='Excel/TXT tối đa 20 MB mỗi tệp.';continue;}
        if(form.querySelector('#live-split')?.value==='direct'&&!isDirectAttachment(file)){
          state.message='CLI tối giản nhận ảnh JPG/PNG/WebP/GIF, Excel .xlsx và TXT đến 20 MB.';continue;
        }
        state.items.push({file,url:URL.createObjectURL(file),saved:false});
      }
      state.repaint();
    };
    picker.onchange=()=>{addFiles(picker.files);picker.value=''};
    const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
    dropZone.addEventListener('dragover',event=>{
      if(!fileDrag(event))return;
      event.preventDefault();event.dataTransfer.dropEffect='copy';dropZone.classList.add('is-dragging-file');
    },{signal:dropController.signal});
    dropZone.addEventListener('dragleave',event=>{
      const rect=dropZone.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)
        dropZone.classList.remove('is-dragging-file');
    },{signal:dropController.signal});
    dropZone.addEventListener('drop',event=>{
      if(!fileDrag(event))return;
      event.preventDefault();dropZone.classList.remove('is-dragging-file');
      addFiles(event.dataTransfer.files);
    },{signal:dropController.signal});
    form.addEventListener('paste',event=>{
      const images=Array.from(event.clipboardData?.files||[]).filter(file=>file.type.startsWith('image/'));
      if(!images.length)return;
      event.preventDefault();addFiles(images);
    });
    // A media message must queue a new turn so the worker downloads the files;
    // turn/steer cannot introduce newly uploaded binary files into a running turn.
    form.addEventListener('click',event=>{
      if(state.items.length&&event.target.closest('.live-steer')){
        event.preventDefault();event.stopImmediatePropagation();form.requestSubmit();
      }
    },true);
    state.repaint();
    return {
      hasPending:()=>state.items.length>0,
      canSendDirect:()=>state.items.length>0&&state.items.every(item=>isDirectAttachment(item.file)),
      imageNames:()=>state.direct?[]:state.items.filter(item=>item.saved&&/\.(jpe?g|png|webp|gif)$/i.test(item.remoteName||'')&&item.file.size<=20*1024*1024).map(item=>item.remoteName),
      mediaIds:()=>state.items.filter(item=>item.saved&&item.mediaId).map(item=>item.mediaId),
      async prepare(question,projectId=existingProject){
        if(state.busy) throw new Error('Tệp đang được tải lên; chờ gửi xong.');
        if(!state.items.length)return projectId;
        state.busy=true;state.message='Đang chuẩn bị tệp đính kèm…';state.repaint();
        try{
          if(state.direct===null)state.direct=!projectId&&!existingProject&&!state.projectId&&(!form.querySelector('#live-split')||['off','direct'].includes(form.querySelector('#live-split').value))&&state.items.every(item=>isDirectAttachment(item.file));
          {
            for(const item of state.items.filter(item=>state.direct||isDocument(item.file))){
              if(item.saved)continue;
              state.message=`Đang chuyển ${item.file.name} tới máy AI…`;state.repaint();
              const body=new FormData();body.append('file',item.file);
              const uploaded=await api('/media',{method:'POST',body});
              item.mediaId=uploaded.id;item.saved=true;state.repaint();
            }
            if(state.items.every(item=>item.saved)){
              state.message='Đã chuyển tệp. Đang gửi câu hỏi…';state.repaint();
              return state.projectId||projectId||null;
            }
          }
          if(!state.projectId)state.projectId=projectId||(await api('/projects',{method:'POST',body:JSON.stringify({name:`Chat · ${question.slice(0,65)||'Tệp đính kèm'}`})})).id;
          for(const item of state.items){
            if(item.saved)continue;
            state.message=`Đang tải ${item.file.name}…`;state.repaint();
            const body=new FormData();body.append('folder','dau-vao');body.append('file',item.file);
            const uploaded=await api(`/projects/${state.projectId}/files`,{method:'POST',body});
            item.remoteName=uploaded.saved?.[0];item.saved=true;state.repaint();
          }
          state.message='Đã tải tệp. Đang gửi tin nhắn…';state.repaint();
          return state.projectId;
        }catch(error){state.busy=false;state.message=error.message;state.repaint();throw error;}
      },
      clear(){for(const item of state.items)URL.revokeObjectURL(item.url);state.items=[];state.projectId=null;state.direct=null;state.busy=false;state.message='';state.repaint();},
      unlock(){state.busy=false;state.repaint();},
    };
  };
}
