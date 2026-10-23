const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
// A remote worker may point at another Office AI server, but only over HTTPS and without credentials in the URL.
function serverUrl(value,port) {
  if(!value) return `http://127.0.0.1:${port}`;
  let url; try { url=new URL(value); } catch { throw new Error('AI_OFFICE_SERVER_URL không hợp lệ'); }
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.username||url.password) throw new Error('Không đưa tài khoản vào AI_OFFICE_SERVER_URL; dùng OFFICE_USER / OFFICE_PASSWORD.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local)) throw new Error('AI_OFFICE_SERVER_URL phải dùng https:// (http chỉ cho localhost).');
  if(url.pathname!=='/'||url.search||url.hash) throw new Error('AI_OFFICE_SERVER_URL chỉ gồm địa chỉ gốc, ví dụ https://office-ai.example.org');
  return url.origin;
}
function configure() {
  // Ignore inherited credentials and production endpoints. Only this app's .env is accepted.
  for(const key of Object.keys(process.env)) if(/^(AI_OFFICE_|SYNC_|OFFICE_|AUTH_|CODEX_|CLAUDE_|ANTHROPIC_|OPENAI_|RCLONE_)/.test(key)||/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS)$/.test(key)) delete process.env[key];
  const file=path.join(root,'.env');
  if(!fs.existsSync(file)) throw new Error('Chạy npm run setup trước.');
  const config=require('dotenv').parse(fs.readFileSync(file));
  const allowed=/^(OFFICE_USER|OFFICE_PASSWORD|PORT|HOST|AI_OFFICE_PROVIDERS|AI_OFFICE_ACCOUNT_LABEL|AI_OFFICE_CLAUDE_BIN|AI_OFFICE_CODEX_BIN|AI_OFFICE_DRIVE_REMOTE|AI_OFFICE_RCLONE_BIN|AI_OFFICE_SERVER_URL|AI_OFFICE_MACHINE_NAME)$/;
  for(const [key,value] of Object.entries(config)) if(allowed.test(key)) process.env[key]=value;
  if(!process.env.OFFICE_USER || (process.env.OFFICE_PASSWORD||'').length<8) throw new Error('OFFICE_PASSWORD phải có ít nhất 8 ký tự.');
  const port=Number(process.env.PORT||3010);
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT không hợp lệ');
  process.env.PORT=String(port); process.env.HOST ||= '127.0.0.1';
  const server=serverUrl(config.AI_OFFICE_SERVER_URL,port);
  process.env.SYNC_USER=process.env.OFFICE_USER; process.env.SYNC_PASS=process.env.OFFICE_PASSWORD;
  const runtime=path.join(root,'.runtime');
  Object.assign(process.env,{CODEX_HOME:path.join(runtime,'profiles/codex'),CLAUDE_CONFIG_DIR:path.join(runtime,'profiles/claude'),RCLONE_CONFIG:path.join(runtime,'rclone.conf'),AI_OFFICE_DATA_DIR:path.join(runtime,'worker'),AI_OFFICE_SERVER_URL:server,AI_OFFICE_BROWSER_HARNESS:'0',AI_OFFICE_COMPUTER_USE:'0'});
  for(const dir of [process.env.CODEX_HOME,process.env.CLAUDE_CONFIG_DIR,process.env.AI_OFFICE_DATA_DIR]) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  return {root};
}
module.exports={configure,serverUrl};
