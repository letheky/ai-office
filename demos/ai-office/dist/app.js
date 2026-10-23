import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
const $=id=>document.getElementById(id);
const agents=[
 {name:'Bạn',role:'Quản lý',dept:0,emoji:'🧑‍💼',color:0x799477,bg:'#e9edde',desk:[0,3.25],desc:'Bạn là quản lý: giao việc, chọn tài khoản AI và duyệt kết quả. Bạn chọn một AI hoặc chia việc cho các tài khoản AI đang kết nối.'},
 {name:'Nghiên cứu',role:'Nghiên cứu thị trường',dept:1,emoji:'🔎',color:0x94a6c6,bg:'#e7edf4',desk:[-5.2,-3.65],desc:'Mình tìm góc tiếp cận, xác định người đọc và chuẩn bị thông tin đầu vào cho chiến dịch.'},
 {name:'Phân tích',role:'Phân tích & insight',dept:1,emoji:'📊',color:0xb7bd95,bg:'#edf0e2',desk:[-5.2,-.75],desc:'Mình đọc số liệu doanh thu, lợi nhuận và dòng tiền, đối chiếu nguồn và chỉ rõ dữ liệu còn thiếu.'},
 {name:'Nội dung',role:'Biên tập nội dung',dept:2,emoji:'✍️',color:0xd8a8a1,bg:'#f4e9e4',desk:[.3,-3.65],desc:'Mình biến brief thành hook, bài viết và lời kêu gọi hành động để bạn xem duyệt.'},
 {name:'Thiết kế',role:'Thiết kế hình ảnh',dept:3,emoji:'🎨',color:0xb7a6cb,bg:'#eee8f3',desk:[5.5,-3.65],desc:'Mình đề xuất bảng màu, bố cục và hướng hình ảnh phù hợp với ý tưởng nội dung.'},
 {name:'Video',role:'Kịch bản & video',dept:3,emoji:'🎬',color:0xd8b47b,bg:'#f3eddf',desk:[5.5,-.75],desc:'Mình chuẩn bị kịch bản video ngắn theo từng cảnh, kèm gợi ý hình ảnh và chữ trên màn hình.'},
 {name:'Sản phẩm',role:'Kinh doanh & sản phẩm',dept:4,emoji:'🛍️',color:0x80aab1,bg:'#e3f0f0',desk:[-5.2,-17.2],desc:'Mình đọc số liệu shop, theo dõi sản phẩm bán chạy và đề xuất việc kinh doanh dựa trên dữ liệu đã có.'},
 {name:'Kỹ thuật',role:'Kỹ thuật & vận hành',dept:4,emoji:'🗂️',color:0xc5a77f,bg:'#f3ecdf',desk:[-5.2,-13.5],desc:'Mình xử lý mã nguồn, script, tệp và tự động hóa; kiểm tra kết quả trước khi bàn giao.'}
];
const shortRoles=['Quản lý','Nghiên cứu','Phân tích','Viết bài','Thiết kế','Video','Kinh doanh','Kỹ thuật'];
// Seats are anchored to their own desk; local +Z is the person's forward direction.
const seating={chairOffset:1.15,roundChairOffset:1.65,heading:Math.PI};
agents.forEach(a=>{a.pos=[a.desk[0],a.desk[1]+(a.dept===0?seating.roundChairOffset:seating.chairOffset)];});
let selected=0,paused=false,simTime=0,tasks=[],activities=[],modalTask=null,lastFocus=null;
let renderScene=()=>{},updateSelection=()=>{};
try{const saved=JSON.parse(localStorage.getItem('moc-office-demo-v1')||'{}');tasks=Array.isArray(saved.tasks)?saved.tasks.filter(t=>typeof t.brief==='string'&&typeof t.id==='string'&&Number.isFinite(t.elapsed)).slice(0,12).map(t=>({...t,elapsed:Math.max(0,Math.min(20,t.elapsed))})):[];}catch{}
const stages=['AI đang lên kế hoạch','AI đang nghiên cứu sản phẩm','AI đang viết nội dung','AI đang chuẩn bị hình ảnh'];
const phase=t=>Math.min(3,Math.floor(t.elapsed/5));
const activeTask=()=>window.mocOfficeLive?null:tasks.find(t=>t.elapsed<20);
const isBusy=i=>{if(window.mocOfficeLive)return window.mocOfficeLive.isBusy(i);let t=activeTask();return t&&([0,1,1,2,3,3,1,0][i]===phase(t));};
const save=()=>{try{localStorage.setItem('moc-office-demo-v1',JSON.stringify({tasks}));}catch{}};
const node=(tag,cls,txt)=>{let e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3800);}
function addActivity(emoji,title){activities.unshift({emoji,title,time:new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})});activities=activities.slice(0,12);renderFeed();}
function renderFeed(){if(window.mocOfficeLive)return;let feed=$('activity-feed');feed.replaceChildren();activities.slice(0,2).forEach(a=>{let item=node('div','feed-item');item.append(node('span','feed-icon',a.emoji));let info=node('div');info.append(node('p','',a.title),node('small','',`${a.time} · Mộc Studio`));item.append(info);feed.append(item);});$('activity-count').textContent=paused?'Đang tạm dừng':'Vừa cập nhật';}
function selectAgent(i){selected=i;let a=agents[i];$('agent-name').textContent=a.name;$('agent-role').textContent=a.role;$('agent-portrait').textContent=a.emoji;$('agent-portrait').style.background=a.bg;$('agent-desc').textContent=a.desc;$('assign-agent').replaceChildren(document.createTextNode('Giao việc cho đội AI '),node('span','','↗'));document.querySelector('.text-muted').textContent='Quản lý';updateAgentStatus();updateSelection(i);document.querySelectorAll('.agent-label').forEach((el,j)=>el.classList.toggle('selected',i===j));}
window.mocOfficeSelectAgent = selectAgent;
function updateAgentStatus(){if(window.mocOfficeLive){window.mocOfficeLive.updateAgentStatus(selected);return;}let t=activeTask();let busy=isBusy(selected);$('agent-status').textContent=busy?(paused?'Tạm dừng':'Đang làm'):'Sẵn sàng';$('agent-current').textContent=busy?`${stages[phase(t)]}: ${t.brief}`:'Chờ ý tưởng tiếp theo từ bạn ✨';$('working-count').textContent=String(agents.filter((_,i)=>isBusy(i)).length).padStart(2,'0');$('done-count').textContent=String(tasks.filter(t=>t.elapsed>=20).length).padStart(2,'0');document.querySelectorAll('.agent-label').forEach((el,i)=>el.classList.toggle('busy',!!isBusy(i)));}
function renderTasks(){if(window.mocOfficeLive)return;let list=$('task-list');list.replaceChildren();$('queue-count').textContent=`${tasks.length} việc`;$('task-dot').style.display=tasks.some(t=>t.elapsed<20)?'block':'none';if(!tasks.length){list.append(node('div','empty-tasks','Bàn làm việc còn trống. Giao một ý tưởng để cả đội bắt đầu nhé.'));}tasks.slice().reverse().slice(0,3).forEach(t=>{let done=t.elapsed>=20,active=activeTask()?.id===t.id;let item=node('div','task-item'),button=node('button');button.append(node('span','',done?'✓':'◌'),node('span','task-title',t.brief),node('span','',done?'↗':''));button.onclick=()=>{if(done)openResult(t);else toast(active?stages[phase(t)]:'Đang xếp hàng, cả đội sẽ thực hiện lần lượt.');};item.append(button);let p=node('div','progress'),bar=node('i');bar.style.width=`${t.elapsed*5}%`;p.append(bar);let meta=node('div','task-meta');meta.append(node('span','',done?(t.approved?'Đã duyệt bản mẫu':'Sẵn sàng để bạn duyệt'):active?stages[phase(t)]:'Đang xếp hàng'),node('span','',done?'Xem kết quả':`${Math.floor(t.elapsed*5)}%`));item.append(p,meta);list.append(item);});updateAgentStatus();}
function showModal(id){lastFocus=document.activeElement;$(id).hidden=false;document.body.style.overflow='hidden';setTimeout(()=>$(id).querySelector('textarea,button')?.focus(),40);}
function hideModal(id){$(id).hidden=true;document.body.style.overflow='';lastFocus?.focus();}
function openTask(){showModal('task-modal');setTimeout(()=>$('brief').focus(),80);}
$('new-task').onclick=openTask;$('assign-agent').onclick=openTask;
function createTask(brief){if(tasks.filter(t=>t.elapsed<20).length>=4){toast('Hàng chờ đã có 4 việc. Đợi cả đội hoàn thành một việc nhé.');return;}let t={id:crypto.randomUUID(),brief:brief.trim(),elapsed:0,approved:false};tasks.push(t);if(tasks.length>12)tasks=tasks.slice(-12);save();renderTasks();addActivity('🌱',`Đã nhận đề bài: ${t.brief}`);toast(paused?'Đã nhận đề bài. Bấm tiếp tục để cả đội bắt đầu.':'Đã giao việc. Cả đội bắt đầu rồi!');}
$('task-form').onsubmit=e=>{e.preventDefault();let brief=$('brief').value.trim();if(!brief){$('brief').setCustomValidity('Bạn nhập một đề bài trước nhé.');$('brief').reportValidity();return;}$('brief').setCustomValidity('');createTask(brief);hideModal('task-modal');$('brief').value='';};$('brief').oninput=()=>$('brief').setCustomValidity('');
document.querySelectorAll('[data-brief]').forEach(b=>b.onclick=()=>{$('brief').value=b.dataset.brief;$('brief').setCustomValidity('');$('brief').focus();});
$('sample-task').onclick=()=>createTask('Chuẩn bị 3 bài quảng bá thảm yoga cho tuần này');
$('tasks-nav').onclick=()=>{$('tasks-section').scrollIntoView({behavior:'smooth',block:'center'});$('tasks-section').animate([{background:'#e5edda'},{background:'transparent'}],{duration:1200});};
$('team-nav').onclick=()=>{selectAgent((selected+1)%agents.length);if(innerWidth<850)$('agent-detail').scrollIntoView({behavior:'smooth',block:'center'});};$('office-nav').onclick=()=>{document.querySelector('.office-card').scrollIntoView({behavior:'smooth',block:'center'});};
$('help').onclick=()=>toast('Kéo để xoay cảnh, cuộn để phóng to. Chọn nhân vật hoặc bấm “Giao việc mới” để thử.');$('owner').onclick=()=>toast('Bản demo riêng của bạn · Dữ liệu mô phỏng lưu trên trình duyệt này.');
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'▷':'Ⅱ';$('pause').setAttribute('aria-label',paused?'Tiếp tục mô phỏng':'Tạm dừng mô phỏng');$('pause').title=paused?'Tiếp tục mô phỏng':'Tạm dừng mô phỏng';$('live-text').textContent=paused?'Văn phòng đang nghỉ':'Văn phòng đang mở';updateAgentStatus();renderFeed();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hideModal(b.dataset.close));document.querySelectorAll('.modal-backdrop').forEach(el=>el.onclick=e=>{if(e.target===el)hideModal(el.id);});
document.addEventListener('keydown',e=>{let modal=[...document.querySelectorAll('.modal-backdrop')].find(el=>!el.hidden);if(!modal)return;if(e.key==='Escape')hideModal(modal.id);if(e.key==='Tab'){let els=[...modal.querySelectorAll('button,textarea')].filter(x=>!x.disabled),first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
function getOutput(t){let brief=t.brief;let topic=/yoga/i.test(brief)?'thảm yoga':/keycap/i.test(brief)?'bộ keycap mới':/góc làm việc/i.test(brief)?'góc làm việc tại nhà':'sản phẩm trong đề bài';return[
 ['🔎 Nghiên cứu',`Đề bài: ${brief}\n\nHướng nghiên cứu mẫu: xác định người mua, tình huống sử dụng và những câu hỏi cần giải đáp.\nGóc tiếp cận gợi ý: trải nghiệm sử dụng ${topic}, cách lựa chọn và cách chăm sóc.\nCần bổ sung trước khi xuất bản: thông số thật, giá bán, hình ảnh và chính sách shop. Chưa có dữ liệu thị trường được xác minh.`],
 ['✍️ Nội dung',`Bài 1 · Giới thiệu\n“Điều gì khiến bạn chọn ${topic}?”\nMở đầu bằng một tình huống sử dụng thực tế, sau đó giới thiệu sản phẩm bằng thông tin shop đã kiểm chứng.\nCTA: Nhắn shop để được tư vấn mẫu phù hợp.\n\nBài 2 · Hướng dẫn lựa chọn\n“3 điều nên kiểm tra trước khi chọn ${topic}.”\nChia sẻ tiêu chí lựa chọn, kèm ảnh minh họa thật. Tránh khẳng định công dụng khi chưa có bằng chứng.\nCTA: Bạn ưu tiên tiêu chí nào nhất?\n\nBài 3 · Hậu trường\n“Một góc nhỏ của shop hôm nay.”\nQuay quá trình chuẩn bị và đóng gói sản phẩm để khách nhìn rõ trải nghiệm mua hàng.\nCTA: Lưu lại để tham khảo khi cần.`],
 ['🎨 Hướng hình ảnh',`Bảng màu gợi ý: xanh sage #809875, kem #F5F3E8, nâu nhạt #C4A68A.\nBố cục: một ảnh sản phẩm làm điểm nhấn, nền thoáng và tiêu đề ngắn.\nTỷ lệ đề xuất: 4:5 cho bài ảnh, 9:16 cho video.\nĐây là brief thiết kế; demo chưa tạo tệp ảnh.`],
 ['🎬 Kịch bản 30 giây',`00–04s: Cận cảnh ${topic}, đặt câu hỏi mở đầu.\n04–13s: Quay toàn cảnh và các chi tiết thật của sản phẩm.\n13–23s: Minh họa cách sử dụng hoặc một tiêu chí lựa chọn.\n23–30s: Hiện sản phẩm cùng lời mời nhắn shop tư vấn.\nChữ trên màn hình: ngắn, dễ đọc; dùng thông số và giá đã được xác nhận.`]
];}
function openResult(t){modalTask=t;$('result-brief').textContent=t.brief;let body=$('result-body');body.replaceChildren();let state=node('div','result-status');state.append(node('span','',t.approved?'✓ Bạn đã duyệt bản mẫu':'◌ Bản nháp đang chờ bạn duyệt'));let approve=node('button','approve',t.approved?'Đã duyệt':'Duyệt bản mẫu');approve.disabled=t.approved;approve.onclick=()=>{t.approved=true;save();renderTasks();hideModal('result-modal');addActivity('✓','Bạn đã duyệt bản mẫu. Không có nội dung nào được đăng.');toast('Đã đánh dấu duyệt trong demo.');};state.append(approve);body.append(state);getOutput(t).forEach(([title,text])=>{let s=node('section','result-section');s.append(node('h3','',title),node('p','',text));body.append(s);});showModal('result-modal');}
$('download-result').onclick=()=>{if(!modalTask)return;let text='MỘC STUDIO — BẢN NHÁP MÔ PHỎNG\n'+modalTask.brief+'\n\n'+getOutput(modalTask).map(([h,t])=>h+'\n'+t).join('\n\n─────\n\n');let url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='moc-ban-nhap-demo.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Đã tải bản nháp về máy.');};
$('today').textContent=new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long'});
addActivity('☀','Một ngày mới ở Mộc. Cả đội đã sẵn sàng.');addActivity('🌱','Các tài khoản AI đang chờ đề bài từ bạn.');renderTasks();
let previous=performance.now(),lastTick=0;function tick(now){let dt=Math.min((now-previous)/1000,.1);previous=now;if(!paused){simTime+=dt;let t=activeTask();if(t){let before=phase(t);t.elapsed=Math.min(20,t.elapsed+dt);if(t.elapsed>=20){addActivity('✨','Cả đội đã hoàn thành bản nháp. Mời bạn xem duyệt.');toast('Bản nháp đã sẵn sàng! Bấm công việc để xem kết quả.');save();renderTasks();}else if(phase(t)!==before){let stage=phase(t);addActivity(['🌱','🔎','✍️','🎨'][stage],stages[stage]);save();renderTasks();}}}if(now-lastTick>500){renderTasks();lastTick=now;}renderScene(simTime,paused?0:dt);requestAnimationFrame(tick);}requestAnimationFrame(tick);window.addEventListener('pagehide',save);

// A small, hand-built studio: real geometry, soft lighting and clickable teammates.
try{
const holder=$('scene'),scene=new THREE.Scene();scene.background=new THREE.Color('#edf1e8');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;holder.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','Mô hình 3D văn phòng Mộc, kéo để xoay và cuộn để thu phóng');
let cam=new THREE.OrthographicCamera(-15,15,12,-12,.1,150);cam.position.set(26.5,29,22.5);cam.lookAt(7.5,0,-6.5);const controls=new OrbitControls(cam,renderer.domElement);controls.target.set(7.5,.5,-6.5);controls.enableDamping=true;controls.dampingFactor=.08;controls.minPolarAngle=.05;controls.maxPolarAngle=1.5;controls.minZoom=.4;controls.maxZoom=8;controls.enablePan=true;controls.screenSpacePanning=true;controls.rotateSpeed=.55;controls.zoomSpeed=.7;
const hemi=new THREE.HemisphereLight(0xf5faee,0xa5a78d,2.4);scene.add(hemi);let sun=new THREE.DirectionalLight(0xfff2da,3.5);sun.position.set(-10,26,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.normalBias=.035;sun.shadow.bias=-.0002;sun.shadow.radius=4;scene.add(sun);let fill=new THREE.DirectionalLight(0xe5ebff,1);fill.position.set(10,8,-10);scene.add(fill);
const mats=new Map();function mat(color,roughness=.8){let key=color+'_'+roughness;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness}));return mats.get(key);}
function mesh(geo,color,x,y,z,parent=scene){let m=new THREE.Mesh(geo,mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const roundedGeo=new Map();function box(w,h,d,c,x,y,z,r=.06,parent=scene){let key=[w,h,d,r].join(',');let g=roundedGeo.get(key);if(!g){if(r){r=Math.min(r,w/3,h/3,d/3);let s=new THREE.Shape();s.moveTo(-w/2+r,-d/2);s.lineTo(w/2-r,-d/2);s.quadraticCurveTo(w/2,-d/2,w/2,-d/2+r);s.lineTo(w/2,d/2-r);s.quadraticCurveTo(w/2,d/2,w/2-r,d/2);s.lineTo(-w/2+r,d/2);s.quadraticCurveTo(-w/2,d/2,-w/2,d/2-r);s.lineTo(-w/2,-d/2+r);s.quadraticCurveTo(-w/2,-d/2,-w/2+r,-d/2);g=new THREE.ExtrudeGeometry(s,{depth:h-r*2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:r,bevelThickness:r,curveSegments:5});g.rotateX(-Math.PI/2);g.translate(0,-h/2+r,0);}else g=new THREE.BoxGeometry(w,h,d);roundedGeo.set(key,g);}return mesh(g,c,x,y,z,parent);}
function ball(r,c,x,y,z,parent=scene,sx=1,sy=1,sz=1){let m=mesh(new THREE.SphereGeometry(r,16,12),c,x,y,z,parent);m.scale.set(sx,sy,sz);return m;}
function cyl(rt,rb,h,c,x,y,z,parent=scene){return mesh(new THREE.CylinderGeometry(rt,rb,h,16),c,x,y,z,parent);}
let ground=mesh(new THREE.PlaneGeometry(200,200),0xedf1e8,0,-.6,0);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
box(20,.62,14.8,0xd5d7c3,0,-.1,0,.28);box(19.9,.14,14.7,0xf3efdf,0,.28,0,.15);
box(2.3,.12,3.2,0xe5dbc9,9.8,.35,4.7,.12);
// Warm oak flooring, with quiet seams.
for(let z=-6.6;z<7;z+=.82){let line=box(19.5,.005,.013,0xe7e2d0,0,.36,z,0);line.castShadow=false;for(let x=-8.5+(Math.round(z*10)%2)*2;x<9;x+=4){let m=box(.012,.005,.8,0xe7e2d0,x,.36,z+.4,0);m.castShadow=false;}}
// Tall back and west walls frame one cosy room; the other sides stay open toward the camera.
box(19.9,3.2,.24,0xe9e4d2,0,1.9,-7.25,.06);box(19.9,.12,.38,0xd9d2bb,0,3.55,-7.25,.05);box(19.9,.14,.3,0xcfc7ae,0,.4,-7.13,.03);
box(.24,3.2,14.5,0xe9e4d2,-9.85,1.9,0,.06);box(.38,.12,14.5,0xd9d2bb,-9.85,3.55,0,.05);box(.3,.14,14.5,0xcfc7ae,-9.73,.4,0,.03);
// Department islands, soft-edged rugs and low storage.
box(4.8,.045,7.5,0xd4e0d2,-5.35,.39,-1.7,.2);box(4.8,.045,4.6,0xead8ce,.1,.39,-3.1,.2);box(4.8,.045,7.5,0xded7e8,5.55,.39,-1.7,.2);
  // A dotted path connects the work islands to the shared meeting area.
  for(let x=-8;x<=8;x+=.55){let dot=cyl(.045,.045,.008,0xc8d3b9,x,.43,5.85);dot.castShadow=false;}
  for(const x of [-2.8,2.7])for(let z=-1.6;z<5.6;z+=.55){let dot=cyl(.045,.045,.008,0xc8d3b9,x,.43,z);dot.castShadow=false;}
box(3.7,.65,.8,0xd9dfc9,-5.35,.7,-6.4,.07);box(3.7,.65,.8,0xd9d0df,5.55,.7,-6.4,.07);for(let x of [-6.45,-5.35,-4.25,4.45,5.55,6.65]){box(.85,.43,.04,0xf0eee2,x,.75,-5.97,.04);box(.16,.035,.06,0xa8ab91,x,.82,-5.93,.01);}
function plant(x,z,size=1,pot=0xe1cdb0){let g=new THREE.Group();g.position.set(x,.35,z);g.scale.setScalar(size);scene.add(g);cyl(.29,.22,.51,pot,0,.25,0,g);cyl(.25,.25,.025,0x8c8564,0,.51,0,g);cyl(.035,.035,1.1,0x829565,0,.97,0,g);for(let i=0;i<6;i++){let a=i*2.4;let l=ball(.37,[0x99b183,0xa7b991,0x829c70][i%3],Math.sin(a)*.24,.73+i*.16,Math.cos(a)*.22,g,.55,1,.55);l.rotation.z=Math.sin(a)*.7;}return g;}
plant(-8.7,-5.8,1.4);plant(8.7,-5.8,1.5,0xcbc5d9);plant(-8.7,5.8,1.2);plant(8.7,5.8,1.3,0xc4cfb1);plant(-5.4,-6.45,.55);plant(5.5,-6.45,.6,0xdac0b2);
function tree(x,z,size=1){let g=new THREE.Group();g.position.set(x,-.5,z);g.scale.setScalar(size);scene.add(g);cyl(.12,.2,2.4,0xb4a38a,0,1.2,0,g);ball(1.05,0xa9bd93,0,2.9,0,g,1,1.25,1);ball(.8,0xb9c99e,.55,2.65,.15,g);ball(.65,0xc4cfaa,-.55,2.55,.2,g);}
tree(-12,-5,1);tree(-12,4,.8);tree(12.6,-4,.9);tree(12.8,5,.8);
// Front landscaping gives the office the feel of a tiny diorama.
for(let i=0;i<6;i++){let x=-8+i*3.2;ball(.6,[0xaebb97,0xc3cba8,0x9fae8c][i%3],x,-.3,8.1,scene,1.3,.45,1);}
const deskTops=[];
function laptop(parent){
  box(.94,.065,.6,0xa7aaa1,-.1,1.25,-.05,.035,parent);
  const monitor=box(.94,.65,.06,0x868e85,-.1,1.57,-.34,.045,parent);
  monitor.rotation.x=-.18;
  box(.82,.52,.015,0xe3eadb,-.1,1.57,-.295,.02,parent).rotation.x=-.18;
  for(let j=0;j<3;j++)box(.49-j*.09,.025,.015,[0xa4b6a0,0xc0cbb4,0xc7cfbd][j],-.17,1.67-j*.1,-.225-j*.018,.006,parent);
  box(.7,.025,.28,0xd3d5c9,-.1,1.255,.28,.025,parent);
  for(let j=0;j<3;j++)box(.54,.008,.012,0xb6bcad,-.1,1.273,.22+j*.06,0,parent);
}
function desk(a,index){
  const [x,z]=a.desk,g=new THREE.Group();g.position.set(x,.38,z);scene.add(g);
  for(const dx of [-1.16,1.16])for(const dz of [-.48,.48])box(.1,1.08,.1,0xc7b99e,dx,.54,dz,.025,g);
  deskTops[index]=box(2.7,.15,1.45,0xe6d1b0,0,1.13,0,.1,g);
  // The AI robots sit on the far side of the desk, so the laptop faces them (screen toward -Z).
  const deskLaptop=new THREE.Group();deskLaptop.rotation.y=Math.PI;g.add(deskLaptop);laptop(deskLaptop);
  cyl(.095,.08,.17,0xf6f0dd,.95,1.3,.2,g);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.062,.018,6,12),mat(0xf6f0dd));handle.position.set(1.05,1.32,.2);g.add(handle);
  box(.38,.035,.48,a.color,-.95,1.23,.18,.015,g);box(.32,.012,.4,0xfffaed,-.95,1.256,.18,.01,g);
}
// Only the desks of the single room are built (the old rear wing is gone).
const roomDesks=agents.filter((a,i)=>i&&a.desk[1]>-8);
agents.forEach((a,i)=>{if(i&&roomDesks.includes(a))desk(a,i);});
// The round station uses the same working height and reachable keyboard as the desks.
const [coordinatorX,coordinatorZ]=agents[0].desk;
deskTops[0]=cyl(1.2,1.2,.15,0xe7d4b6,coordinatorX,1.51,coordinatorZ);
cyl(.13,.2,1.07,0xc0b698,coordinatorX,.905,coordinatorZ);
const coordinatorLaptop=new THREE.Group();coordinatorLaptop.position.set(coordinatorX,.38,coordinatorZ+.5);scene.add(coordinatorLaptop);laptop(coordinatorLaptop);
// Lounge and brainstorm corner.
box(3.5,.3,1.4,0xe6c7a7,.2,.74,-.05,.17);box(3.5,.85,.28,0xdcb99a,.2,1.2,-.68,.13);box(.28,.65,1.45,0xdcb99a,-1.55,1,-.05,.12);box(.28,.65,1.45,0xdcb99a,1.95,1,-.05,.12);box(1.4,.2,.9,0xeedbc1,-.55,.96,.05,.09);box(1.4,.2,.9,0xeedbc1,1,.96,.05,.09);box(.6,.6,.17,0xa3b28c,-.8,1.35,-.3,.12).rotation.z=.12;box(.6,.6,.17,0xece6cf,1.1,1.35,-.3,.12).rotation.z=-.15;cyl(.58,.58,.12,0xf1e6cf,.2,.9,1.3);cyl(.06,.13,.5,0xb7a684,.2,.6,1.3);plant(.2,1.3,.35,0xc0cbb0);
// Circular cream rug under the coordinator.
let rug=cyl(2.15,2.15,.025,0xe4e6d1,0,.385,3.5);rug.castShadow=false;
// Lamps, books and a freestanding noticeboard.
function lamp(x,z){cyl(.33,.33,.06,0xc5bd9f,x,.4,z);cyl(.035,.035,2.7,0xb9af90,x,1.75,z);let shade=mesh(new THREE.ConeGeometry(.56,.55,24,1,true),0xf4edce,x,3.25,z);shade.rotation.z=Math.PI;ball(.11,0xffedb4,x,3.13,z);}
lamp(-2.6,-5.4);lamp(4.3,-5.4);
box(2.65,1.7,.15,0xc8bda2,.3,2.1,-6.25,.06);box(2.48,1.53,.025,0xf3f0df,.3,2.1,-6.15,.04);for(let x of [-.65,.65])cyl(.04,.04,1.35,0xb6aa8f,x,.99,-6.25);
for(let i=0;i<6;i++){let note=box(.45,.42,.015,[0xe5c5b3,0xc9d8b7,0xd5cbe4][i%3],-.35+(i%3)*.58,2.45-Math.floor(i/3)*.59,-6.11,.015);note.rotation.z=(i%2?1:-1)*.06;}
// Seated pose: hips on the cushion, bent knees below the top, hands over the keyboard.
function limb(from,to,r,color,parent){
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),delta=b.clone().sub(a);
  const part=cyl(r,r,delta.length(),color,0,0,0,parent);
  part.position.copy(a).add(b).multiplyScalar(.5);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  return part;
}
const people=[],pickable=[];
// Only the manager (the user) is a person; the other desks seat the AI crew robots.
agents.forEach((a,i)=>{
  if(i)return;
  const [x,z]=a.pos,g=new THREE.Group();g.position.set(x,.4,z);g.rotation.y=seating.heading;scene.add(g);
  // Chair back is behind the person (local -Z), never between them and the screen.
  cyl(.35,.4,.1,0x8b8c78,0,.04,-.08,g);
  cyl(.06,.06,.47,0x9c9f8c,0,.32,-.08,g);
  box(.84,.15,.82,a.color,0,.58,-.08,.12,g);
  box(.86,.82,.16,a.color,0,1.02,-.53,.13,g);
  const skin=[0xe9c6aa,0xf0cbb4,0xe6bd9c,0xf1cbb7,0xefcbb1,0xe4bda0,0xe5bd9e,0xf0c9aa][i];
  const hair=[0x544b3e,0x463e38,0x5d503f,0x685343,0x54463e,0x5f5143,0x4d4138,0x5c4b3f][i];
  const seated=new THREE.Group();g.add(seated);
  const legs=[];
  for(const side of [-1,1]){
    const dx=side*.19;
    legs.push(limb([dx,.73,-.03],[dx,.73,.42],.115,0x777e70,seated));
    legs.push(ball(.118,0x777e70,dx,.72,.42,seated));
    legs.push(limb([dx,.69,.43],[dx,.17,.46],.095,0x777e70,seated));
    legs.push(box(.24,.15,.4,0xf4eee1,dx,.065,.55,.055,seated));
  }
  const body=new THREE.Group();seated.add(body);
  const torso=ball(.37,a.color,0,1.02,-.06,body,1,1.12,.86);
  cyl(.09,.09,.14,skin,0,1.43,-.06,body);
  const head=ball(.34,skin,0,1.72,-.06,body,1,1.07,.96);
  ball(.355,hair,0,1.88,-.13,body,1,.72,1);
  if([1,3,4,6].includes(i)){
    ball(.18,hair,-.26,1.67,-.2,body,.7,1.5,1);ball(.18,hair,.26,1.67,-.2,body,.7,1.5,1);
    if(i===4)ball(.14,hair,.22,2.06,-.16,body);
  }
  for(const dx of [-.115,.115]){
    ball(.026,0x453e32,dx,1.73,.245,body);
    ball(.04,0xdda995,dx*1.55,1.64,.223,body,1,.5,.2);
  }
  const smile=mesh(new THREE.TorusGeometry(.042,.009,4,10,Math.PI),0x9b6f5a,0,1.635,.262,body);smile.rotation.z=Math.PI;
  const arms=[],hands=[];
  for(const side of [-1,1]){
    const shoulder=[side*.3,1.25,-.06],elbow=[side*.42,1.31,.3],wrist=[side*.23,1.34,.8];
    arms.push(limb(shoulder,elbow,.105,a.color,body));
    arms.push(ball(.105,a.color,...elbow,body));
    arms.push(limb(elbow,wrist,.075,skin,body));
    hands.push(ball(.085,skin,side*.23,1.345,.82,body,1,.75,1.15));
  }
  if(i===2){
    for(const dx of [-.115,.115])mesh(new THREE.TorusGeometry(.084,.012,5,14),0x66694f,dx,1.75,.26,body);
    box(.06,.015,.02,0x66694f,0,1.75,.28,.005,body);
  }
  const walker=new THREE.Group();walker.position.copy(g.position);walker.visible=false;scene.add(walker);
  const walkingBody=new THREE.Group();walker.add(walkingBody);
  ball(.36,a.color,0,1.12,0,walkingBody,1,1.18,.84);
  cyl(.09,.09,.16,skin,0,1.53,0,walkingBody);
  ball(.34,skin,0,1.87,0,walkingBody,1,1.07,.96);
  ball(.355,hair,0,2.03,-.07,walkingBody,1,.72,1);
  if([1,3,4,6].includes(i)){
    ball(.18,hair,-.26,1.82,-.14,walkingBody,.7,1.5,1);
    ball(.18,hair,.26,1.82,-.14,walkingBody,.7,1.5,1);
    if(i===4)ball(.14,hair,.22,2.21,-.1,walkingBody);
  }
  for(const dx of [-.115,.115])ball(.026,0x453e32,dx,1.89,.3,walkingBody);
  const walkArms=[],walkLegs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.34,1.38,0);walkingBody.add(arm);
    cyl(.105,.075,.62,a.color,0,-.32,0,arm);ball(.09,skin,0,-.66,0,arm);walkArms.push(arm);
    const leg=new THREE.Group();leg.position.set(side*.17,.77,0);walker.add(leg);
    cyl(.12,.095,.62,0x777e70,0,-.31,0,leg);box(.25,.14,.38,0xf4eee1,0,-.68,.1,.05,leg);walkLegs.push(leg);
  }
  g.userData.agent=i;g.traverse(o=>{if(o.isMesh){o.userData.agent=i;pickable.push(o);}});
  walker.traverse(o=>{if(o.isMesh){o.userData.agent=i;pickable.push(o);}});
  people.push({group:g,seated,body,torso,head,legs,arms,hands,baseY:body.position.y,walker,walkingBody,walkArms,walkLegs,route:null,routeIndex:0,wait:0,nextWalk:3+i*3});
  const label=node('button','agent-label'+(i===0?' selected':''));
  label.append(node('i'),document.createTextNode(a.name),node('span','',shortRoles[i]));
  label.setAttribute('aria-label',`${a.name}, ${a.role}`);label.onclick=()=>selectAgent(i);
  label.addEventListener('pointerdown',e=>{e.stopPropagation();selectAgent(i);});$('labels').append(label);a.label=label;
});
const deptLabels=[{text:'BÀN QUẢN LÝ',p:new THREE.Vector3(0,.6,5.4)},{text:'GÓC THƯ GIÃN',p:new THREE.Vector3(.2,.55,2.2)},{text:'CÀ PHÊ',p:new THREE.Vector3(8.7,.55,3.9)}];deptLabels.forEach(l=>{l.el=node('span','dept-label',l.text);$('labels').append(l.el);});
let ring=mesh(new THREE.TorusGeometry(.59,.022,6,48),0x8aab75,0,.45,3.8);ring.rotation.x=-Math.PI/2;ring.castShadow=false;updateSelection=i=>{let[x,z]=agents[i].pos;ring.position.set(x,.445,z+.1);};
// Walk along the open aisles rather than cutting through desks. Movement is visual;
// real task status still comes from the AI office API.
const meetingSpots=[[-1.9,5.9],[-4.3,5.8],[-3.1,5.8],[2.1,5.9],[4.3,5.8],[3.1,5.8],[4,-9.2],[5.2,-9.2]];
const leisure=[
  {name:'Đang pha cà phê',points:[[7.2,5.8],[7.2,2.6]],wait:7},
  {name:'Đang chơi với chó',points:[[-2.9,5.8],[-2.9,3.9]],wait:9},
  {name:'Đang ngắm ngoài cửa sổ',points:[[-8.4,4.9],[-8.4,2.2]],wait:8},
];
function startWalk(p,i,time){
  const [x,z]=agents[i].pos;
  const aisle=i===0?-1.9:i===3?2.6:[1,2,6,7].includes(i)?-2.8:3.05;
  const exitZ=i===0?5.95:z+1.2;
  const busy=!!isBusy(i);
  const kind=window.mocOfficeLive?.currentKind?.();
  const studioTrip=busy&&kind==='video'&&(i===4||i===5);
  const rearTrip=busy&&(i>=6||studioTrip);
  p.showcase=!!p.forcedActivity;
  const activity=busy?null:(p.forcedActivity||leisure[(i+(p.leisureIndex||0))%leisure.length]);
  p.forcedActivity=null;
  if(!busy)p.leisureIndex=(p.leisureIndex||0)+1;
  const workPoints=studioTrip?[[aisle,-9.2],[17.5,-9.2],[17.5,-10.7]]:rearTrip?[[aisle,-9.2],meetingSpots[i]]:[[aisle,5.8],meetingSpots[i]];
  const outward=[[x,z],[x,exitZ],[aisle,exitZ],...(busy?workPoints:[[aisle,5.8],...activity.points])];
  p.route=outward.concat(outward.slice(0,-1).reverse());
  p.turnAt=outward.length-1;p.activity=activity;p.stopLabel=studioTrip?'Đang chuẩn bị video':i>=6&&busy?'Đang họp kinh doanh':'Đang phối hợp';p.routeIndex=1;p.wait=0;p.nextWalk=time+35+i*2;
  p.walker.position.set(x,.4,z);p.walker.visible=true;p.seated.visible=false;
  agents[i].label.classList.add('moving');
  agents[i].label.querySelector('span').textContent='Đang di chuyển';
}
function finishWalk(p,i,time){
  p.route=null;p.activity=null;p.stopLabel=null;p.showcase=false;p.walker.visible=false;p.seated.visible=true;
  p.nextWalk=time+(isBusy(i)?12:24)+i*1.7;
  agents[i].label.classList.remove('moving');
  agents[i].label.querySelector('span').textContent=shortRoles[i];
}
function movePeople(time,dt){
  if(reduced)return;
  const moving=people.filter(p=>p.route).length;
  const next=people.findIndex((p,i)=>!p.route&&time>=p.nextWalk&&isBusy(i));
  const idleNext=people.findIndex((p,i)=>!p.route&&time>=p.nextWalk&&!isBusy(i));
  const candidate=next>=0?next:idleNext;
  if(moving<2&&candidate>=0)startWalk(people[candidate],candidate,time);
  people.forEach((p,i)=>{
    const busy=!!isBusy(i);
    if(busy&&!p.wasBusy&&p.route&&p.activity&&p.routeIndex<=p.turnAt+1){
      const back=p.route.slice(0,p.routeIndex).reverse();
      p.route=[[p.walker.position.x,p.walker.position.z],...back];
      p.routeIndex=1;p.turnAt=-1;p.wait=0;p.activity=null;
      agents[i].label.querySelector('span').textContent='Về bàn làm việc';
    }
    if(busy&&!p.wasBusy&&!p.route)p.nextWalk=Math.min(p.nextWalk,time+.6+i*.25);
    p.wasBusy=busy;
    if(!p.route)return;
    if(p.wait>0){
      p.wait=Math.max(0,p.wait-dt);
      if(p.activity){const gesture=Math.sin(time*3);p.walkArms[0].rotation.x=gesture*.3;p.walkArms[1].rotation.x=-gesture*.3;}
      if(!p.wait)agents[i].label.querySelector('span').textContent='Đang di chuyển';
      return;
    }
    const goal=p.route[p.routeIndex];
    const dx=goal[0]-p.walker.position.x,dz=goal[1]-p.walker.position.z;
    const distance=Math.hypot(dx,dz);
    if(distance<.05){
      p.walker.position.set(goal[0],.4,goal[1]);
      if(p.routeIndex===p.turnAt){
        p.wait=p.activity?p.activity.wait:2.8;
        agents[i].label.querySelector('span').textContent=p.activity?.name||p.stopLabel;
      }
      p.routeIndex++;
      if(p.routeIndex>=p.route.length)finishWalk(p,i,time);
      return;
    }
    const step=Math.min(distance,dt*(busy?2.35:p.showcase?3.2:1.75));
    p.walker.position.x+=dx/distance*step;
    p.walker.position.z+=dz/distance*step;
    p.walker.rotation.y=Math.atan2(dx,dz);
    const swing=Math.sin(time*9+i);
    p.walkLegs[0].rotation.x=swing*.42;p.walkLegs[1].rotation.x=-swing*.42;
    p.walkArms[0].rotation.x=-swing*.32;p.walkArms[1].rotation.x=swing*.32;
    p.walkingBody.position.y=Math.abs(swing)*.055;
  });
}
// A parcel gently floats from one teammate to the next while work is active.
let parcel=box(.23,.23,.23,0xc6a874,0,3,0,.035);parcel.visible=false;let pathPoints=[0,0,0,0,0].map(i=>new THREE.Vector3(agents[i].pos[0],2.9,agents[i].pos[1]));
const point=new THREE.Vector3();let width,height;function resize(){width=holder.clientWidth;height=holder.clientHeight;if(!width||!height)return;let aspect=width/height;let view=aspect<1.3?25:21;cam.left=-view*aspect;cam.right=view*aspect;cam.top=view;cam.bottom=-view;cam.updateProjectionMatrix();renderer.setSize(width,height,false);}new ResizeObserver(resize).observe(holder);resize();
function setView(name){
  const views={all:[0,0,1.8],work:[0,-2.5,2.8],back:[-1,2.5,2.8],break:[6,2.5,3]};
  const [x,z,zoom]=views[name];
  controls.target.set(x,.5,z);cam.position.set(x+19,29,z+29);cam.zoom=zoom;cam.updateProjectionMatrix();controls.update();
  document.querySelectorAll('.scene-places button').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
}
document.querySelectorAll('.scene-places button').forEach(button=>button.onclick=()=>setView(button.dataset.view));
setView('all');
function callToPlay(activity){
  const choices=[0];
  const i=choices.find((id,index)=>choices.indexOf(id)===index&&!people[id].route&&!isBusy(id));
  if(i===undefined){toast('Bạn đang điều phối việc. Thử lại khi rảnh nhé.');return;}
  people[i].forcedActivity=activity;startWalk(people[i],i,simTime);
  setView(activity===leisure[0]?'break':'back');toast(`${agents[i].name}: ${activity.name.toLowerCase()}…`);
}
$('play-pool').onclick=()=>callToPlay(leisure[0]);
$('play-foosball').onclick=()=>callToPlay(leisure[1]);
function zoom(f){cam.zoom=THREE.MathUtils.clamp(cam.zoom*f,.4,8);cam.updateProjectionMatrix();}$('zoom-in').onclick=()=>zoom(1.15);$('zoom-out').onclick=()=>zoom(1/1.15);$('reset-camera').onclick=()=>setView('all');
let ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),down=null;renderer.domElement.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;let rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,cam);let hit=ray.intersectObjects(pickable,false)[0];if(hit)selectAgent(hit.object.userData.agent);});
let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateGames(){}
window.mocOffice3D={THREE,scene,cam,renderer,labels:$('labels'),box,setView,seats:roomDesks.map(a=>a.desk),reduced:()=>reduced,width:()=>width,height:()=>height,frame:[]};
renderScene=(time,dt)=>{if(document.body.classList.contains('is-chat-expanded'))return;controls.update();movePeople(time,dt);animateGames(time);people.forEach((p,i)=>{let busy=isBusy(i);if(!reduced){p.body.position.y=p.baseY+Math.sin(time*(busy?3:1.5)+i)*.006;p.body.rotation.y=Math.sin(time*.7+i)*.012;p.hands.forEach((hand,j)=>{hand.position.y=1.345+(busy?Math.sin(time*9+j*Math.PI)*.008:0);});}point.copy(p.walker.visible?p.walker.position:p.group.position).add(new THREE.Vector3(0,p.walker.visible?3.1:2.7,0)).project(cam);agents[i].label.style.left=`${(point.x*.5+.5)*width}px`;agents[i].label.style.top=`${(-point.y*.5+.5)*height}px`;agents[i].label.style.visibility=point.z>1?'hidden':'visible';});deptLabels.forEach(l=>{point.copy(l.p).project(cam);l.el.style.left=`${(point.x*.5+.5)*width}px`;l.el.style.top=`${(-point.y*.5+.5)*height}px`;});let task=activeTask();parcel.visible=!!task&&!reduced;if(task){let ph=phase(task),u=(task.elapsed%5)/5;parcel.position.lerpVectors(pathPoints[ph],pathPoints[ph+1],u);parcel.position.y+=Math.sin(u*Math.PI)*1.1;parcel.rotation.y=time;parcel.rotation.z=Math.sin(time)*.2;}const chosen=people[selected];ring.position.set(chosen.walker.visible?chosen.walker.position.x:chosen.group.position.x,.445,chosen.walker.visible?chosen.walker.position.z+.1:chosen.group.position.z+.1);ring.material.opacity=.6+Math.sin(time*2)*.15;window.mocOffice3D?.frame.forEach(f=>f(time,dt));renderer.render(scene,cam);};
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();toast('Đồ họa bị gián đoạn. Tải lại trang để mở lại văn phòng.');});
$('loading').hidden=true;selectAgent(0);
}catch(err){console.error(err);$('loading').replaceChildren(node('p','','Trình duyệt chưa mở được 3D. Hãy bật tăng tốc đồ họa hoặc thử Chrome.'));$('loading').style.padding='30px';toast('Bạn vẫn có thể thử giao việc và xem kết quả ở bảng bên cạnh.');}
