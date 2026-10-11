"""Validate source XML against installed schema; compare native OLB roundtrip."""
import codecs, json, sys
from lxml import etree as ET

mode, filename, reference = sys.argv[1:4]
tree = ET.parse(filename)
if mode == 'schema':
    ET.XMLSchema(ET.parse(reference)).assertValid(tree)
else:
    expected = json.load(open(reference, encoding='utf-8'))
    packages = tree.findall('Package')
    if len(packages) != len(expected):
        raise ValueError('Native package count mismatch')
    for item in expected:
        package = next(p for p in packages if p.find('Defn').get('name') == item['entry'])
        if package.find('Defn').get('pcbFootprint') != item['footprintEntry']:
            raise ValueError('PCB Footprint binding mismatch')
        units = package.findall('LibPart')
        source_units = ET.fromstring(item['xml'].encode('utf-8')).findall('LibPart')
        if len(units) != item['units']:
            raise ValueError('Unit count mismatch')
        actual = []
        for index, unit in enumerate(units, 1):
            def user_props(view):
                return {p.find('Defn').get('name'): p.find('Defn').get('val') for p in view.findall('SymbolUserProp')}
            actual_props = user_props(unit.find('NormalView'))
            source_props = user_props(source_units[index-1].find('NormalView'))
            # Capture folds description whitespace and removes trailing blanks.
            # Its native importer also uses the Windows ANSI code page: symbols
            # such as TM can become '?' on CP936. Allow that known conversion
            # only in Description, never in identifiers or bindings.
            def comparable(name, value):
                return ' '.join(value.split()) if name == 'Description' and value is not None else value
            def property_matches(name):
                source = comparable(name, source_props[name])
                actual_value = comparable(name, actual_props[name])
                if actual_value == source:
                    return True
                if name == 'Description' and source is not None:
                    try:
                        codecs.lookup('mbcs')
                    except LookupError:
                        return False
                    ansi_source = source.encode('mbcs', errors='replace').decode('mbcs')
                    return actual_value == ansi_source
                return False
            differences = [name for name in sorted(set(actual_props) | set(source_props))
                           if name not in actual_props or name not in source_props
                           or not property_matches(name)]
            if differences:
                detail = '; '.join(f'{name}: expected={source_props.get(name)!r}, actual={actual_props.get(name)!r}'
                                   for name in differences)
                raise ValueError(f'Native symbol property mismatch for {item["entry"]}, unit {index}: {detail[:1200]}')
            tags = {'Rect','Ellipse','Line','Polyline','Bezier','Arc','CommentText','Polygon'}
            def geometry(view):
                def normalize(node):
                    return (node.tag, tuple(sorted(node.attrib.items())), tuple(normalize(c) for c in node if c.tag not in {'TextFont'}))
                return sorted(normalize(c) for c in view if c.tag in tags)
            if geometry(unit.find('NormalView')) != geometry(source_units[index-1].find('NormalView')):
                raise ValueError('Native symbol geometry mismatch for '+item['entry'])
            for flag in ['IsPinNamesRotated','IsPinNumbersVisible','IsPinNamesVisible']:
                source_flag=source_units[index-1].find('NormalView/'+flag+'/Defn')
                actual_flag=unit.find('NormalView/'+flag+'/Defn')
                if source_flag is not None and (actual_flag is None or actual_flag.get('val') != source_flag.get('val')):
                    raise ValueError('Native pin display flag mismatch: '+flag+' for '+item['entry'])
            numbers = {n.find('Defn').get('position'):n.find('Defn').get('number') for n in unit.findall('PhysicalPart/PinNumber')}
            for pin in unit.findall('NormalView/SymbolPinScalar'):
                a = dict(pin.find('Defn').attrib)
                actual.append({'number':numbers[a['position']], 'name':a['name'], 'unit':index,
                               **{k:int(a[k]) for k in ['position','hotptX','hotptY','startX','startY','type']}})
        key=lambda p:(p['unit'],p['position'])
        if sorted(actual,key=key) != sorted(item['pins'],key=key):
            raise ValueError('Native pins/coordinates/types mismatch for '+item['entry'])
print('HUB_CAPTURE_CHECK_OK')
