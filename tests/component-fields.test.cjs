const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {componentFields}=require('../src/component-fields.cjs'),{readComponent}=require('../src/easyeda-library.cjs'),{convertSymbol}=require('../src/kicad-symbol.cjs'),{captureSymbol}=require('../src/cadence-symbol.cjs'),{geometry}=require('../src/altium-geometry.cjs'),sx=require('../src/sexpr.cjs');
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
