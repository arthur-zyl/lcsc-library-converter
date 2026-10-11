const path=require('node:path'),{createHash}=require('node:crypto');
const {footprint}=require('./cadence-footprint.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
function footprintKey(part,matched){
  if(matched){
    const ignored=new Set(['DOCTYPE','HEAD','CANVAS','ACTIVE_LAYER','PREFERENCE','ATTR']);
    return hash(JSON.stringify({source:path.resolve(matched.file).toLowerCase(),rows:part.footprintRows.filter(r=>!ignored.has(r[0])).map(r=>[r[0],...r.slice(2)])}));
  }
  const fp=footprint(part,'fingerprint','model.step');
  return hash(JSON.stringify({commands:fp.commands.filter(c=>!c.includes('axlStepSet')),source:'easyeda'}));
}
module.exports={footprintKey};
