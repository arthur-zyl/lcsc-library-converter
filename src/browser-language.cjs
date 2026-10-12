function setBrowserLanguage(session,locale){
 const languages=locale==='zh-CN'?'zh-CN,zh':'en-US,en';
 session.setUserAgent(session.getUserAgent(),languages);
}
module.exports={setBrowserLanguage};
