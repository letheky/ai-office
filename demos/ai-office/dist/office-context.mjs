const valid=n=>Number.isFinite(n)&&n>=0;
const number=n=>Math.round(n).toLocaleString('vi-VN');
export function contextJobForDisplay(job,jobs=[]) {
  const selected=jobs.find(row=>row.id===job.id)||job;
  if(selected.teamRole)return selected;
  const root=selected.conversationRoot||selected.id;
  return jobs.find(row=>!row.teamRole&&row.status==='running'&&(row.conversationRoot||row.id)===root)||selected;
}
export function contextView(context,provider='codex') {
  if(context?.state==='compacting')return {label:'Context · Đang nén…',note:'Chờ Codex xác nhận hoàn tất.',percent:null,level:'unknown'};
  if(context?.state==='awaiting')return {label:'Context · Đã nén · chờ số đo mới',note:'Tiếp tục trò chuyện để nhận số đo mới; chưa coi context là 0%.',percent:null,level:'unknown'};
  if(context?.state!=='measured'||!valid(context.used))return {label:'Context · Chưa có số đo',
    note:provider==='codex'?'Số đo sẽ hiện khi worker nhận dữ liệu context từ Codex.':'Claude CLI chưa cung cấp số đo context cho lượt này.',percent:null,level:'unknown'};
  const percent=valid(context.limit)&&context.limit>0?context.used/context.limit*100:null;
  const level=percent===null?'unknown':percent>=85?'high':percent>=70?'warning':'normal';
  return {label:`Context ước tính · ${percent===null?'Chưa rõ %':`${Math.round(percent)}% đã dùng`} · ${number(context.used)}${percent===null?'':` / ${number(context.limit)}`} token`,
    note:(percent===null?'CLI chưa trả giới hạn context.':level==='high'?'Nên dùng /compact khi AI xong lượt.':level==='warning'?'Có thể dùng /compact trước khi tiếp tục việc dài.':'Còn đủ chỗ để tiếp tục trò chuyện.')+
      ' Tính từ lần gọi model gần nhất; cache đã nằm trong đầu vào. Đây là ngưỡng gợi ý của giao diện.',percent,level};
}
export function paintContext(node,context,provider,make){
  const view=contextView(context,provider);node.replaceChildren();node.dataset.level=view.level;
  const updated=context?.measuredAt?`Cập nhật: ${new Date(context.measuredAt).toLocaleString('vi-VN')}`:'';
  node.title=[view.label,view.note,updated].filter(Boolean).join('\n');
  node.setAttribute('aria-label',node.title);
  node.append(make('span','',view.label));
  if(view.percent!==null){const meter=make('progress');meter.max=100;meter.value=Math.min(100,view.percent);meter.setAttribute('aria-label','Phần trăm context ước tính đã dùng');node.append(meter)}
}
