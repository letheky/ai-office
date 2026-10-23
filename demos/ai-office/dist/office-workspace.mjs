// Local history belongs to the selected physical machine, never to an AI account.
export function workspacePicker({executor,make,enabled,browse}) {
  const memory=new Map(),values=new Map();
  const key=machine=>`moc-office-workspaces-v1:${machine==='vps'||machine.startsWith('vps:')?'vps':machine}`;
  function history(machine){
    if(memory.has(key(machine)))return memory.get(key(machine));
    try{const rows=JSON.parse(localStorage.getItem(key(machine))||'[]');if(Array.isArray(rows))return rows.filter(p=>typeof p==='string'&&p.trim()).slice(0,100)}catch{}
    return memory.get(key(machine))||[];
  }
  function save(machine,path){
    path=path.trim();if(!path)return;
    const rows=[path,...history(machine).filter(p=>p!==path)].slice(0,100);
    memory.set(key(machine),rows);try{localStorage.setItem(key(machine),JSON.stringify(rows))}catch{}
  }
  const field=make('div','live-workspace-field');field.hidden=!enabled;
  const label=make('label','','Thư mục làm việc trên máy đã chọn');label.htmlFor='live-workspace';
  const row=make('div','live-workspace-row'),box=make('div','live-workspace-combo'),input=make('input');
  input.type='text';input.id='live-workspace';input.placeholder='Mặc định của worker';input.autocomplete='off';
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls','live-workspace-history');
  const list=make('div','live-workspace-history');list.id='live-workspace-history';list.setAttribute('role','listbox');list.setAttribute('aria-label','Thư mục đã chọn trên máy này');list.hidden=true;
  const button=make('button','soft-button','Chọn thư mục…');button.type='button';
  box.append(input,list);row.append(box,button);field.append(label,row,make('small','','CLI mở ngay tại folder này và đọc hướng dẫn dự án ở đó.'));
  let machine=executor.value,active=-1,options=[];
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1}
  function choose(path){input.value=path;values.set(machine,path);save(machine,path);close();input.focus()}
  function open(filter=''){
    list.replaceChildren();active=-1;input.removeAttribute('aria-activedescendant');
    options=history(machine).filter(path=>path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
    for(const [index,path] of options.entries()){
      const option=make('div','live-workspace-option',path);option.id=`live-workspace-option-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.title=path;
      option.addEventListener('mousedown',event=>event.preventDefault());option.onclick=()=>choose(path);list.append(option);
    }
    if(!options.length)list.append(make('p','live-workspace-empty',filter?'Không có thư mục phù hợp.':'Chưa có thư mục đã chọn trên máy này.'));
    list.hidden=false;input.setAttribute('aria-expanded','true');
  }
  function sync(){if(machine!==executor.value){values.set(machine,input.value);machine=executor.value;input.value=values.get(machine)||'';close()}}
  input.addEventListener('focus',()=>{sync();open()});
  input.addEventListener('click',()=>{if(list.hidden)open()});
  input.addEventListener('input',()=>{values.set(machine,input.value);open(input.value.trim())});
  input.addEventListener('change',()=>save(machine,input.value));
  input.addEventListener('blur',close);
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){if(!list.hidden){event.preventDefault();event.stopPropagation();close()}return}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(list.hidden)open();if(!options.length)return;
      active=(active+(event.key==='ArrowDown'?1:active<0?0:-1)+options.length)%options.length;
      [...list.children].forEach((node,index)=>node.setAttribute('aria-selected',String(index===active)));
      const selected=list.children[active];input.setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'){event.preventDefault();if(!list.hidden&&active>=0)choose(options[active]);else{save(machine,input.value);close()}}
  });
  executor.addEventListener('change',sync);
  button.onclick=()=>{
    sync();close();const selected=machine;
    if(browse(selected,input.value,path=>{
      save(selected,path);values.set(selected,path);
      if(machine===selected){input.value=path;close()}
    })===false){input.setCustomValidity('Máy đang offline; bật máy để duyệt thư mục');input.reportValidity();input.setCustomValidity('')}
  };
  return {field,value:()=>{sync();return input.value.trim()},remember:()=>{sync();save(machine,input.value)}};
}
