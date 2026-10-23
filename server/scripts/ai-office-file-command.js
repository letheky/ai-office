const fs=require('fs'),path=require('path');
const {execFile}=require('child_process');
const {promisify}=require('util');
const exec=promisify(execFile);
const {subscriptionEnv}=require('./ai-office-cli');
const actions=new Set(['pwd','cwd','diff','init']);
async function fileCommand(action,cwd) {
  if(action==='pwd'||action==='cwd')return `Thư mục làm việc thực tế: ${cwd}`;
  if(action==='init'){
    const target=path.join(cwd,'AGENTS.md');
    const text='# Hướng dẫn dự án\n\n- Đọc mã nguồn và tài liệu liên quan trước khi sửa.\n- Chỉ thực hiện công việc người dùng yêu cầu.\n- Kiểm tra thay đổi bằng các lệnh phù hợp của dự án.\n- Không ghi token, mật khẩu hay bí mật vào mã nguồn hoặc log.\n';
    try{fs.writeFileSync(target,text,{flag:'wx',mode:0o644})}
    catch(error){if(error.code==='EEXIST')throw new Error('AGENTS.md đã tồn tại; không ghi đè');throw error}
    return `Đã tạo tệp hướng dẫn mẫu ${target}. Bạn có thể bổ sung quy tắc riêng của dự án.`;
  }
  if(action==='diff'){
    const git=async args=>(await exec('git',args,{cwd,env:subscriptionEnv(),timeout:15000,maxBuffer:1024*1024})).stdout;
    await git(['rev-parse','--show-toplevel']);
    const sections=[];
    for(const[label,args]of [['Chưa stage',['diff','--no-ext-diff','--no-textconv','--']],['Đã stage',['diff','--cached','--no-ext-diff','--no-textconv','--']],['Tệp chưa theo dõi (tên tệp)',['ls-files','--others','--exclude-standard']]]){
      const text=await git(args);if(text.trim())sections.push(label+'\n```diff\n'+text+'\n```');
    }
    return sections.join('\n\n')||'Không có thay đổi Git trong thư mục này.';
  }
  throw new Error('Lệnh tệp không được hỗ trợ');
}
module.exports={fileCommand,fileActions:actions};
