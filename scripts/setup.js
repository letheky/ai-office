const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),file=path.join(root,'.env');
if(fs.existsSync(file)) { console.error('.env đã có; giữ nguyên cấu hình.'); process.exit(1); }
const password=crypto.randomBytes(24).toString('base64url');
const template=fs.readFileSync(path.join(root,'.env.example'),'utf8');
fs.writeFileSync(file,template.replace('OFFICE_PASSWORD=','OFFICE_PASSWORD='+password),{mode:0o600,flag:'wx'});
console.log('Đã tạo .env riêng. Xem OFFICE_USER / OFFICE_PASSWORD trong .env để đăng nhập. Không gửi tệp này cho người khác.');
