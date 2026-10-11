"""Author native SchLib/PcbLib and audit binary roundtrips. No AD GUI required."""
import json, math, sys, zlib, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'ad_vendor'))
from altium_monkey import (AltiumSchLib, AltiumPcbLib, PcbLayer, PadShape,
    PinElectrical, Rotation90, PinTextRotation, SchPointMils, SchFontSpec,
    make_sch_pin, PcbBodyProjection, IeeeSymbol, TextOrientation)

# The bundled 2026.6.9 writer falls back to UTF-8 bytes without tagging some
# schematic properties. Emit the native %UTF8% companion plus ANSI fallback.
import altium_monkey.altium_utilities as utilities
import altium_monkey.altium_schlib as schlib_module
original_stream_writer=utilities.create_stream_from_records
def unicode_stream(records, *args, **kwargs):
    normalized=[]
    for record in records:
        row=dict(record)
        for key,value in list(row.items()):
            if isinstance(value,str) and not key.startswith('_') and '%UTF8%' not in key:
                try:value.encode('cp1252')
                except UnicodeEncodeError:
                    row['%UTF8%'+key]=value
                    row[key]=value.encode('cp1252',errors='replace').decode('cp1252')
        normalized.append(row)
    return original_stream_writer(normalized,*args,**kwargs)
utilities.create_stream_from_records=unicode_stream
schlib_module.create_stream_from_records=unicode_stream

def mil(v): return round(float(v)/0.0254,6)
def pt(p): return tuple(mil(v) for v in p)
def pad_info(p):
    return {'number':p.designator,'x':p.x_mils*0.0254,'y':p.y_mils*0.0254}
def pcb_signature(f):
    fields=['designator','x','y','top_width','top_height','mid_width','mid_height','bot_width','bot_height','top_shape','mid_shape','bot_shape','rotation','hole_size','hole_shape','slot_size','slot_rotation','is_plated','layer']
    return [tuple(getattr(p,k) for k in fields) for p in f.pads]
def symbol_signature(s):
    return sorted((p.designator,p.name,p.owner_part_id,int(p.electrical),round(p.get_hot_spot().x_mils,4),round(p.get_hot_spot().y_mils,4),round(p.length_mils,4),int(p.orientation)) for p in s.pins)
def footprint(lib,name):
    f=lib.find_footprint(name)
    if f is None: raise ValueError('Footprint not found: '+name)
    return f
def build_symbol(lib,j):
    g=j['geometry'];s=lib.add_symbol(j['entry']);s.set_description(g['description']);s.set_part_count(g['unitCount'])
    types={'input':PinElectrical.INPUT,'output':PinElectrical.OUTPUT,'bidirectional':PinElectrical.IO,'passive':PinElectrical.PASSIVE,'unspecified':PinElectrical.PASSIVE,'no_connect':PinElectrical.PASSIVE,'tri_state':PinElectrical.HIZ,'open_collector':PinElectrical.OPEN_COLLECTOR,'open_emitter':PinElectrical.OPEN_EMITTER,'power_in':PinElectrical.POWER,'power_out':PinElectrical.POWER}
    for p in g['pins']:
        a=math.radians(p['angle']);body=(p['x']+p['length']*math.cos(a),p['y']+p['length']*math.sin(a))
        pin=make_sch_pin(designator=p['number'],name=p['name'],location_mils=SchPointMils.from_mils(*pt(body)),orientation=Rotation90(int((p['angle']+180)%360)//90),length_mils=mil(p['length']),electrical_type=types[p['type']],owner_part_id=p['unit'],name_visible=p['nameVisible'],designator_visible=p['numberVisible'],name_font=SchFontSpec(name='Arial',size=8),designator_font=SchFontSpec(name='Arial',size=8),name_rotation=PinTextRotation.VERTICAL if p['angle'] in [90,270] else PinTextRotation.HORIZONTAL,designator_rotation=PinTextRotation.VERTICAL if p['angle'] in [90,270] else PinTextRotation.HORIZONTAL)
        s.add_pin(pin)
        if 'inverted' in p.get('shape',''):pin.symbol_inner_edge=IeeeSymbol.DOT
        if 'clock' in p.get('shape',''):pin.symbol_inner=IeeeSymbol.CLOCK
        if p['type']=='no_connect':pin.symbol_outer=IeeeSymbol.NOT_LOGIC_CONNECTION
    for unit in g['units']:
        for q in unit['graphics']:
            kw={'owner_part_id':unit['unit']};t=q['type']
            if t=='rectangle':s.add_rectangle(*map(round,pt(q['start'])+pt(q['end'])),is_solid=q['fill'],**kw)
            elif t=='circle':s.add_ellipse(*map(round,pt(q['center'])),round(mil(q['radius'])),round(mil(q['radius'])),is_solid=q['fill'],**kw)
            elif t in ['polyline','bezier']:
                points=[tuple(map(round,pt(p))) for p in q['points']]
                if t=='bezier':s.add_bezier(points,**kw)
                elif q['fill']:s.add_polygon(points,is_solid=True,**kw)
                else:s.add_polyline(points,**kw)
            elif t=='text':s.add_label(q['text'],*map(round,pt(q['at'])),orientation=TextOrientation(int(q['angle']%360)//90),**kw)
            elif t=='arc':
                (x1,y1),(x2,y2),(x3,y3)=map(pt,[q['start'],q['mid'],q['end']]);d=2*(x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2))
                if abs(d)<1e-9: raise ValueError('Degenerate schematic arc')
                v=lambda x,y:x*x+y*y
                cx=(v(x1,y1)*(y2-y3)+v(x2,y2)*(y3-y1)+v(x3,y3)*(y1-y2))/d;cy=(v(x1,y1)*(x3-x2)+v(x2,y2)*(x1-x3)+v(x3,y3)*(x2-x1))/d
                angle=lambda x,y:math.degrees(math.atan2(y-cy,x-cx))%360
                a,b,m=angle(x1,y1),angle(x3,y3),angle(x2,y2)
                if (m-a)%360>(b-a)%360:a,b=b,a
                s.add_arc(round(cx),round(cy),round(math.hypot(x1-cx,y1-cy)),start_angle=a,end_angle=b,**kw)
    for name,value in g['properties'].items():s.add_parameter(name,value,is_hidden=True)
    y=max(p['y'] for p in g['pins'])+2.54
    s.add_designator(g['reference'],0,round(mil(y)));s.add_parameter('Comment',j['name'],x=0,y=round(mil(y+2.54)))
    s.add_footprint(j['footprintEntry'],library_name=j['library']+'.PcbLib')
    return s
def build_footprint(lib,j):
    g=j['geometry'];f=lib.add_footprint(j['footprintEntry'],description=g['description'])
    for p in g['pads']:
        kw={}
        if p['slotLength']:kw={'hole_shape':'slot','slot_length_mils':mil(p['slotLength']),'slot_rotation_degrees':p['slotAngle']}
        # Explicit paste/mask regions replace automatic openings for intersecting pads.
        explicit=set()
        for r in g['regions']:
            points=r['paths'][0];xs=[q[0] for q in points];ys=[q[1] for q in points]
            if min(xs)<p['x']+p['width']/2 and max(xs)>p['x']-p['width']/2 and min(ys)<p['y']+p['height']/2 and max(ys)>p['y']-p['height']/2:explicit.add(r['layer'])
        side='BOTTOM' if p['layer']=='BOTTOM' else 'TOP'
        f.add_pad(designator=p['number'],position_mils=(mil(p['x']),mil(p['y'])),width_mils=mil(p['width']),height_mils=mil(p['height']),rotation_degrees=p['angle'],layer=getattr(PcbLayer,p['layer']),shape=getattr(PadShape,p['shape']),corner_radius_percent=100 if p['shape']=='ROUNDED_RECTANGLE' else None,hole_size_mils=mil(p['drill']),plated=p['plated'],solder_mask_expansion_mode='none' if side+'_SOLDER' in explicit else 'manual',solder_mask_expansion_mils=None if side+'_SOLDER' in explicit else 0,paste_mask_expansion_mode='none' if side+'_PASTE' in explicit or p['drill'] else 'manual',paste_mask_expansion_mils=None if side+'_PASTE' in explicit or p['drill'] else 0,**kw)
    for q in g['tracks']:f.add_track(pt(q['start']),pt(q['end']),width_mils=max(mil(q['width']),0.1),layer=getattr(PcbLayer,q['layer']))
    for q in g['regions']:f.add_region(outline_points_mils=[pt(p) for p in q['paths'][0]],hole_points_mils=[[pt(p) for p in h] for h in q['paths'][1:]],layer=getattr(PcbLayer,q['layer']))
    for q in g['texts']:f.add_text(text=q['text'],position_mils=pt(q['at']),height_mils=40,stroke_width_mils=4,rotation_degrees=q['angle'],layer=getattr(PcbLayer,q['layer']))
    return f
def add_model(lib,f,j):
    import FreeCAD
    import Part
    shape=Part.read(j['model']);b=shape.BoundBox
    if shape.isNull() or b.ZLength<=0:raise ValueError('Invalid component STEP')
    payload=Path(j['model']).read_bytes();model=lib.add_embedded_model(name=j['modelName'],model_data=payload)
    f.component_bodies[:]=[body for body in f.component_bodies if not body.model_is_embedded]
    f._record_order[:]=[body for body in f._record_order if not getattr(body,'model_is_embedded',False)]
    placement=j.get('placement') or {'x':0,'y':0,'angle':0}
    f.add_embedded_3d_model(model,bounds_mils=(mil(b.XMin),mil(b.YMin),mil(b.XMax),mil(b.YMax)),overall_height_mils=mil(b.ZMax),standoff_height_mils=mil(b.ZMin),location_mils=(mil(placement['x']),mil(placement['y'])),rotation_z_degrees=placement['angle'],layer=PcbLayer.MECHANICAL_13,side=PcbBodyProjection.TOP)
    return hashlib.sha256(payload).hexdigest()
def main():
    mode=sys.argv[1]
    if mode=='probe':print('HUB_ALTIUM_OK');return
    j=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    if mode=='index':
        result=[]
        for file in j['files']:
            try:
                lib=AltiumPcbLib.from_file(file)
                result.extend({'name':f.name,'file':file,'pads':[pad_info(p) for p in f.pads]} for f in lib.footprints)
            except Exception as e:print('Skipped local library '+file+': '+str(e),file=sys.stderr)
        Path(j['output']).write_text(json.dumps(result),encoding='utf-8');return
    out=Path(j['output']);out.mkdir(parents=True,exist_ok=True)
    sch=AltiumSchLib(j['sourceSch']) if j.get('sourceSch') else AltiumSchLib()
    pcb=AltiumPcbLib.from_file(j['sourcePcb']) if j.get('sourcePcb') else AltiumPcbLib()
    old_symbols={s.name:symbol_signature(s) for s in sch.symbols}
    old_footprints={f.name:pcb_signature(f) for f in pcb.footprints}
    recovered={}
    for old in j.get('recovery',[]):
        if not j.get('sourceSch'):build_symbol(sch,old)
        if not j.get('sourcePcb') and old['footprintEntry'] not in recovered:
            if not Path(old['model']).is_file():raise ValueError('Cannot recover AD library: missing model '+old['modelName'])
            if old.get('local'):
                source=AltiumPcbLib.from_file(old['local']['file'])
                old_f=pcb.add_existing_footprint(footprint(source,old['local']['name']));old_f.name=old['footprintEntry']
            else:old_f=build_footprint(pcb,old)
            add_model(pcb,old_f,old);recovered[old['footprintEntry']]=old_f
    symbol=sch.get_symbol(j['entry'])
    if symbol is None:symbol=build_symbol(sch,j)
    f=pcb.find_footprint(j['footprintEntry']) or recovered.get(j['footprintEntry'])
    if f is None:
        if j.get('local'):
            src=AltiumPcbLib.from_file(j['local']['file']);f=pcb.add_existing_footprint(footprint(src,j['local']['name']));f.name=j['footprintEntry']
            f.component_bodies.clear()
        else:f=build_footprint(pcb,j)
    expected_pads=pcb_signature(f);expected_pins=symbol_signature(symbol)
    digest=add_model(pcb,f,j) if j['updateModel'] else None
    sf=out/(j['library']+'.SchLib');pf=out/(j['library']+'.PcbLib')
    sch.save(sf);pcb.save(pf)
    sch2=AltiumSchLib(sf);pcb2=AltiumPcbLib.from_file(pf);s2=sch2.get_symbol(j['entry']);f2=footprint(pcb2,j['footprintEntry'])
    if symbol_signature(s2)!=expected_pins:raise ValueError('AD native pins/units/coordinates/types mismatch: '+str([(a,b) for a,b in zip(expected_pins,symbol_signature(s2)) if a!=b][:3]))
    if s2.part_count!=j['geometry']['unitCount']:raise ValueError('AD native unit count mismatch')
    if not any(i.model_name==j['footprintEntry'] and i.datafile_entity==j['library']+'.PcbLib' for i in s2.implementations):raise ValueError('AD footprint binding mismatch')
    if pcb_signature(f2)!=expected_pads:raise ValueError('AD native pad geometry/drill/plating mismatch')
    for name,pins in old_symbols.items():
        if symbol_signature(sch2.get_symbol(name))!=pins:raise ValueError('Existing AD symbol changed: '+name)
    for name,pads in old_footprints.items():
        if pcb_signature(footprint(pcb2,name))!=pads:raise ValueError('Existing AD footprint changed: '+name)
    if s2.description!=j['geometry']['description']:raise ValueError('AD description Unicode mismatch')
    for name,value in j['geometry']['properties'].items():
        if not any(p.name==name and p.text==value for p in s2.parameters):raise ValueError('AD property mismatch: '+name)
    if digest:
        bodies=[b for b in f2.component_bodies if b.model_is_embedded];models={str(m.id):data for m,data in pcb2.get_embedded_model_entries()}
        if not any(str(b.model_id) in models and hashlib.sha256(zlib.decompress(models[str(b.model_id)])).hexdigest()==digest for b in bodies):raise ValueError('AD embedded STEP payload mismatch')
        if len(bodies)!=1:raise ValueError('AD duplicate embedded model bodies')
    Path(j['audit']).write_text(json.dumps({'pins':len(s2.pins),'pads':len(f2.pads),'modelHash':digest,'units':s2.part_count}),encoding='utf-8')
    print('HUB_ALTIUM_CONVERT_OK')
if __name__=='__main__':main()
