const { timingSafeEqual } = require('crypto');
function equal(a,b) { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && timingSafeEqual(x,y); }
function credentialsValid(username,password) {
  return !!process.env.SYNC_PASS && equal(username,process.env.SYNC_USER) && equal(password,process.env.SYNC_PASS);
}
function authenticate(req,res,next) {
  let username='',password='';
  const match=/^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization||'');
  if(match) { const value=Buffer.from(match[1],'base64').toString(); const at=value.indexOf(':'); if(at>=0) { username=value.slice(0,at); password=value.slice(at+1); } }
  if(!credentialsValid(username,password)) {
    res.set('WWW-Authenticate','Basic realm="Office AI", charset="UTF-8"');
    return res.status(401).json({success:false,error:'Vui lòng đăng nhập Office AI'});
  }
  req.auth={username,role:'admin',shops:[],features:['ai-analysis'],permissions:{}};
  next();
}
const canAction=auth=>auth?.role==='admin';
module.exports={credentialsValid,authenticate,canAction,shopAllowed:()=>false};
