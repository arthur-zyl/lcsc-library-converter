const fs=require('node:fs/promises'),path=require('node:path');
const {buildScript,auditScript,checkAudit}=require('./cadence-footprint.cjs');
const {modelPlacement}=require('./local-footprints.cjs');
const q=v=>JSON.stringify(String(v));
async function reuseCadence(part,entry,work,root,matched,run,modelFile=entry+'.step'){
  await fs.copyFile(matched.file,path.join(work,entry+'.dra'));
  const exe=path.join(root,'tools/bin/allegro.exe');
  async function execute(name,script){await fs.writeFile(path.join(work,name+'.il'),script);await fs.writeFile(path.join(work,name+'.scr'),'skill load('+q(path.join(work,name+'.il').replaceAll('\\','/'))+')\n');await run(exe,['-nograph','-safe','-symbol','package','-s',name+'.scr',entry+'.dra'],work,root);await fs.access(path.join(work,name+'.ok')).catch(()=>{throw new Error('本地封装处理未完成：'+name);});}
  const inspect=[
    'axlDBChangeDesignUnits("millimeters" 4)',
    'axlSetVariable("padpath" list("."))',
    'f=outfile("local-pads.tsv")',
    'foreach(p axlDBGetDesign()->pins d=p->definition a=axlDBGetPad(d "TOP" "REGULAR") unless(a error("Missing pad")) unless(axlPadstackToDisk(d->name) error("Padstack export failed")) fprintf(f "%s\\t%f\\t%f\\t%f\\t%s\\t%f\\t%f\\t%f\\t%L\\t%s\\n" if(p->number p->number "") xCoord(p->xy) yCoord(p->xy) p->rotation a->figureName (xCoord(cadr(a->bBox))-xCoord(car(a->bBox))) (yCoord(cadr(a->bBox))-yCoord(car(a->bBox))) d->drillDiameter d->plating d->name))',
    'close(f)'];
  await execute('inspect',buildScript(inspect).replace('"build.ok"','"inspect.ok"'));
  const pads=(await fs.readFile(path.join(work,'local-pads.tsv'),'utf8')).trim().split(/\r?\n/).map(line=>{const r=line.split('\t');return {number:r[0],x:Number(r[1]),y:Number(r[2]),angle:Number(r[3]),kind:r[4],width:Number(r[5]),height:Number(r[6]),drill:Number(r[7]),plated:/^"?PLATED"?$/.test(r[8]),padName:r[9],through:Number(r[7])>0,side:'TOP'};});
  const source=part.footprintRows.filter(r=>r[0]==='PAD').map(r=>({number:String(r[5]??''),x:Number(r[6])*0.0254,y:Number(r[7])*0.0254}));
  const placement=modelPlacement(source,pads),modelName=modelFile;await fs.copyFile(part.model,path.join(work,modelName));
  const commands=['axlDBChangeDesignUnits("millimeters" 4)','axlSetVariable("steppath" list("."))',`unless(axlStepSet('primary nil ${q(modelName)} '(offset_x ${placement.x} offset_y ${placement.y} offset_z 0 rotation_x 0 rotation_y 0 rotation_z ${placement.angle} color 0)) error("STEP binding failed"))`,'unless(axlSaveDesign(?noMru t ?noConfirm t) error("DRA save failed"))','unless(axlCompileSymbol(?silent t ?silentOnOverwrite t) error("PSM compile failed"))'];
  await execute('build',buildScript(commands));await execute('audit',auditScript(pads,modelName));
  checkAudit(await fs.readFile(path.join(work,'audit.tsv'),'utf8'),pads,modelName,placement);
  const padNames=[...new Set(pads.map(p=>p.padName))];
  for(const name of padNames)if(path.basename(name)!==name)throw new Error('焊盘文件名无效');
  return {pads,padNames,placement,modelName,work,files:[entry+'.dra',entry+'.psm',modelName,...padNames.map(n=>n+'.pad')],warnings:['采用 EDA 本地封装；保留焊盘及孔径，立创 STEP 按编号焊盘对齐。'],footprintSource:'eda',sourceFootprint:matched.file};
}
module.exports={reuseCadence};
