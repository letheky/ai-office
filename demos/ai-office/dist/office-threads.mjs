// API order is newest first. Activity belongs to the whole conversation;
// the selected latest turn keeps its own status for queue/stop/session actions.
export function latestConversationTurns(jobs) {
  const byId=new Map(jobs.map(job=>[job.id,job]));
  function rootOf(job){
    if(job.conversationRoot)return job.conversationRoot;
    let current=job;const visited=new Set();
    while(current.parentId&&!visited.has(current.id)){
      visited.add(current.id);
      const parent=byId.get(current.parentId);
      if(!parent)return current.parentId;
      current=parent;
    }
    return current.id;
  }
  const activity=new Map(),priority={running:3,pending:2,waiting:1};
  for(const job of jobs){
    if(job.teamRole||!priority[job.status])continue;
    const root=rootOf(job),previous=activity.get(root);
    if(!previous||priority[job.status]>priority[previous.status])activity.set(root,job);
  }
  const seen=new Set();
  return jobs.flatMap(job=>{
    if(job.teamRole)return [job];
    const root=rootOf(job);
    if(seen.has(root))return [];
    seen.add(root);
    return [{...job,conversationActivity:activity.get(root)||null}];
  });
}
