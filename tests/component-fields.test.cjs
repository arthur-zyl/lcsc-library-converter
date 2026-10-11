const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {componentFields}=require('../src/component-fields.cjs'),{readComponent}=require('../src/easyeda-library.cjs'),{convertSymbol}=require('../src/kicad-symbol.cjs'),{captureSymbol}=require('../src/cadence-symbol.cjs'),{geometry}=require('../src/altium-geometry.cjs'),sx=require('../src/sexpr.cjs');
const {cadenceValue}=require('../src/cadence-value.cjs');
test('Cadence VALUE converts unit symbols and separators into conservative ASCII tokens',()=>{
 for(const [source,expected] of [['50kΩ','50k'],['0Ω','0'],['10µF','10uF'],['4.7μH','4.7uH'],['５０ｋΩ','50k'],['10kΩ ±1%','10k_pm_1pct'],['10k +/- 5%','10k_pm_5pct'],['−40°C','-40degC'],['100MHz;100Ω','100MHz_100'],['1/4W','1_per_4W'],['2×3mm','2x3mm'],['IC™','IC'],['\t10nF\n','10nF']]){
  const result=cadenceValue(source);assert.equal(result.value,expected,source);assert.match(result.value,/^[A-Za-z0-9_.-]+$/);
 }
 assert.deepEqual(cadenceValue('ADM3057EBRWZ-RL'),{value:'ADM3057EBRWZ-RL',warnings:[]});
 assert.match(cadenceValue('50kΩ').warnings[0],/50kΩ → 50k/);
 for(const value of ['10💡','50k\u0000','电阻','Ω','10⁻³','½W'])assert.throws(()=>cadenceValue(value),/无法安全转换/);
});
test('normalized values survive native Capture OLB roundtrip',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON,timeout:60000},async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),{captureNative}=require('../src/cadence.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-value-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const part=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636')),records=[];
 for(const [index,value] of ['50kΩ','10µF','10kΩ ±1%','100MHz;100Ω'].entries()){
  part.properties.Value=value;const entry='ValueProbe'+index;records.push({...captureSymbol(part,entry,'0603'),entry,footprintEntry:'0603'});
 }
 const native=await captureNative(records,'ValueProbe',root,{freecadPython:process.env.HUB_FREECAD_PYTHON},process.env.HUB_CADENCE_ROOT);
 const xml=await fs.readFile(native.roundtrip,'utf8');for(const value of ['50k','10uF','10k_pm_1pct','100MHz_100'])assert.ok(xml.includes('name="'+value+'"'));
});
test('only Capture PartValue is normalized; descriptions, MPN and other EDA values stay intact',async()=>{
 const part=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636'));part.properties.Value='50kΩ';part.description='电阻 50kΩ ±1%';part.properties['Manufacturer Part']='MPN-原始';
 const result=captureSymbol(part,'Resistor','0402');assert.match(result.xml,/<PartValue><Defn name="50k"/);assert.match(result.xml,/name="Description" val="电阻 50kΩ ±1%"/);assert.match(result.xml,/name="MPN" val="MPN-原始"/);assert.ok(result.warnings.some(w=>w.includes('50kΩ → 50k')));
 const tree=sx.parse(convertSymbol(part,'Resistor','Parts','0402').text);assert.equal(sx.value(sx.children(tree,'property').find(p=>sx.value(p)==='Value'),2),'50kΩ');assert.equal(geometry(part,'Resistor','0402').value,'50kΩ');
});
test('native fields use source Value, keep MPN and C code, and exclude commercial parameters',async()=>{
 const part=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636'));part.properties.Price='9';part.properties.Tolerance='10%';
 const tree=sx.parse(convertSymbol(part,'Cap','Parts','0603').text),props=Object.fromEntries(sx.children(tree,'property').map(p=>[sx.value(p),sx.value(p,2)]));
 assert.equal(props.Value,'100nF');assert.equal(props.MPN,'FCC0603B104K500CT');assert.equal(props.LCSC,'C5137636');assert.ok(props.Datasheet.startsWith('https://'));assert.ok(props.Description);assert.equal(props.Price,undefined);assert.equal(props.Tolerance,undefined);assert.equal(props.ki_description,undefined);
 const xml=captureSymbol(part,'Cap','0603').xml;assert.match(xml,/<PartValue><Defn name="100nF"/);assert.match(xml,/name="Datasheet" val="https:/);assert.equal((xml.match(/<SymbolUserProp>/g)||[]).length,5);
 const ad=geometry(part,'Cap','0603');assert.equal(ad.value,'100nF');assert.equal(ad.properties.HelpURL,props.Datasheet);assert.deepEqual(Object.keys(ad.properties).sort(),['HelpURL','LCSC','MPN','Manufacturer']);
});
test('ICs and unresolved source formulas fall back to MPN; no missing link is fabricated',()=>{
 assert.equal(componentFields({id:'C1',name:'IC',properties:{Value:'={missing}'}}).value,'IC');assert.equal(componentFields({id:'C1',name:'IC',properties:{Value:'={Resistance}',Resistance:'10k'}}).value,'10k');assert.equal(componentFields({id:'C1',name:'IC',properties:{}}).datasheet,'');
});
