const {spawn}=require('child_process');
try {
 const {root}=require('./runtime').configure();
 const action=process.argv[2];
 if(action==='server') require('../server/src/index');
 else if(action==='worker') require('../local/src/ai-office-worker');
 else if(action==='login-codex'||action==='login-claude') {
  const codex=action==='login-codex';
  const binary=codex?(process.env.AI_OFFICE_CODEX_BIN||'codex'):(process.env.AI_OFFICE_CLAUDE_BIN||'claude');
  const child=spawn(binary,codex?['login']:['auth','login'],{cwd:root,env:require('../server/scripts/ai-office-cli').subscriptionEnv(),stdio:'inherit'});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
 } else throw new Error('Lệnh không hợp lệ');
} catch(error) { console.error(error.message); process.exitCode=1; }
