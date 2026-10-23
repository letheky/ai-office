const {normalizeContext}=require('./ai-office-execution');
// Assistant usage describes one model request; result.usage/modelUsage token
// counts accumulate requests (and sometimes subagents), so only read its window.
function claudeContext(emit=()=>{}) {
  let context=null,model=null;
  const publish=value=>{context=normalizeContext({...value,measuredAt:Date.now()});emit({kind:'context',context})};
  return {
    read:()=>context,
    observe(row){
      if(row.parent_tool_use_id)return;
      if(row.type==='system'&&row.subtype==='status'&&row.status==='compacting'){
        publish({state:'compacting'});return;
      }
      if(row.type==='system'&&row.subtype==='compact_boundary'){
        publish({state:'awaiting'});return;
      }
      if(row.type==='assistant'){
        const u=row.message?.usage;
        if(!row.message?.model||row.message.model==='<synthetic>'||!u||!Number.isFinite(u.input_tokens)||u.input_tokens<0)return;
        const count=key=>Number.isFinite(u[key])&&u[key]>=0?u[key]:0;
        model=row.message?.model||null;
        publish({state:'measured',used:u.input_tokens+count('cache_creation_input_tokens')+count('cache_read_input_tokens'),limit:null});
      }
      if(row.type==='result'&&context?.state==='measured'&&model){
        const limit=row.modelUsage?.[model]?.contextWindow;
        if(Number.isFinite(limit)&&limit>0)publish({...context,limit});
      }
    }
  };
}
module.exports={claudeContext};
