"""Extract one component from a single-component EasyEDA PCB STEP.

Run with FreeCAD's bundled bin/python.exe. Does not modify the source.
Geometry and per-face STEP colors are preserved and checked on reimport.
"""
import argparse
import json
from pathlib import Path

import FreeCAD as App
import Import
import Part
from collections import Counter
from step_bounds import compare_bounds


def bounds(shape):
    b = shape.BoundBox
    return {k: getattr(b, k) for k in
            ('XMin', 'YMin', 'ZMin', 'XMax', 'YMax', 'ZMax',
             'XLength', 'YLength', 'ZLength')}


def world_shape(obj):
    # Shape already contains the object's own Placement; add only its ancestors.
    s = obj.Shape.copy()
    ancestors = obj.getGlobalPlacement().multiply(obj.Placement.inverse())
    s.Placement = ancestors.multiply(s.Placement)
    return s


def colored_component(component, imported_colors, warnings=None):
    """Flatten geometry leaves and their face colors in the same order."""
    shapes, colors = [], []
    color_map = {obj.Name: list(values) for obj, values in (imported_colors or [])}
    def visit(obj):
        if obj.TypeId == 'App::Part':
            for child in obj.Group:
                if not child.TypeId.startswith('App::Origin'):
                    visit(child)
        elif hasattr(obj, 'Shape') and not obj.Shape.isNull() and obj.Shape.Solids:
            shape = world_shape(obj)
            values = color_map.get(obj.Name)
            if not values:
                values = [(0.7, 0.7, 0.7)]
                if warnings is not None:
                    warnings.append('Source STEP has no face colors; neutral grey assigned: ' + obj.Label)
            if len(values) == 1:
                values = values * len(shape.Faces)
            if len(values) != len(shape.Faces):
                raise RuntimeError('STEP face/color count mismatch: ' + obj.Label)
            shapes.append(shape)
            colors.extend(values)
    visit(component)
    if not shapes:
        raise RuntimeError('Component has no colored geometry leaves')
    result = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
    original = world_shape(component)
    if (len(result.Solids) != len(original.Solids)
            or abs(result.Volume-original.Volume) > max(1e-5, original.Volume*1e-7)
            or any(abs(bounds(result)[k]-bounds(original)[k]) > 1e-5 for k in bounds(original))):
        raise RuntimeError('Flattening component changed its geometry')
    return result, colors


def color_counts(colors):
    return Counter(tuple(round(float(c), 5) for c in color[:3]) for color in colors)


def export_checked(shape, colors, path, label):
    check = None
    output = App.newDocument('ColoredExport')
    try:
        feature = output.addObject('Part::Feature', 'Component')
        feature.Label = label
        feature.Shape = shape
        output.recompute()
        # The headless Import API accepts (object, face-colors) tuples. Explicitly
        # keep placement: the default exporter can reset a single root to origin.
        Import.export([(feature, colors)], str(path), legacy=False, keepPlacement=True)
        check = App.newDocument('RoundTrip')
        reimported_colors = Import.insert(str(path), check.Name)
        roots = [o for o in check.Objects if hasattr(o, 'Shape')
                 and not o.Shape.isNull() and len(o.Shape.Solids) > 0
                 and not any(p.TypeId == 'App::Part' for p in o.InList)]
        if len(roots) != 1:
            raise RuntimeError('Round-trip must contain exactly one geometry root')
        loaded = world_shape(roots[0])
        if not loaded.isValid() or len(loaded.Solids) != len(shape.Solids):
            raise RuntimeError('Round-trip validity or solid-count check failed')
        if abs(loaded.Volume - shape.Volume) > max(1e-5, shape.Volume * 1e-7):
            raise RuntimeError('Round-trip volume mismatch')
        a, b = bounds(shape), bounds(loaded)
        comparison = compare_bounds(a, b)
        diagnostic = path.with_suffix('.validation.json')
        diagnostic.write_text(json.dumps(comparison, indent=2), encoding='utf-8')
        if not comparison['passed']:
            raise RuntimeError('Round-trip bounding-box mismatch: max delta '
                               + str(comparison['max_delta_mm']) + ' mm; tolerance '
                               + str(comparison['tolerance_mm']) + ' mm; details: ' + str(diagnostic))
        actual_colors = [c for obj, values in (reimported_colors or []) for c in
                         (list(values)*len(obj.Shape.Faces) if len(values)==1 else values)]
        if color_counts(actual_colors) != color_counts(colors):
            raise RuntimeError('Round-trip face-color check failed')
        return {'file': str(path), 'valid': True, 'solids': len(loaded.Solids),
                'volume_mm3': loaded.Volume, 'bounds_mm': b,
                'bounds_comparison': comparison,
                'round_trip_checked': True, 'face_colors_checked': True,
                'colored_faces': len(colors), 'unique_colors': len(color_counts(colors))}
    finally:
        if check:
            App.closeDocument(check.Name)
        App.closeDocument(output.Name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--out-dir', type=Path, default=Path(__file__).parent / 'extracted')
    parser.add_argument('--part-id', default='C48997937')
    parser.add_argument('--footprint-x', type=float, default=0.0,
                        help='PCB footprint origin X in mm, not model center')
    parser.add_argument('--footprint-y', type=float, default=0.0)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error('Source STEP does not exist')
    if any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in args.part_id):
        parser.error('part-id must contain only letters, digits, underscore or hyphen')
    args.out_dir.mkdir(parents=True, exist_ok=True)
    paths = {k: args.out_dir / (args.part_id + suffix) for k, suffix in
             [('board', '_board_coordinates.step'), ('mount', '_mount_z0.step'),
              ('report', '_report.json')]}
    if not args.overwrite and any(p.exists() for p in paths.values()):
        parser.error('Output already exists; use a new out-dir or --overwrite')
    doc = App.newDocument('EasyEDAInput')
    try:
        imported_colors = Import.insert(str(args.source.resolve()), doc.Name)
        boards = [o for o in doc.Objects if o.Label.startswith('Board~')
                  and hasattr(o, 'Shape') and not o.Shape.isNull()]
        if len(boards) != 1:
            raise RuntimeError('Expected exactly one Board~ object; refusing to guess')
        board = boards[0]
        board_shape = world_shape(board)
        bb = board_shape.BoundBox
        if len(board_shape.Solids) != 1 or not 0.1 < bb.ZLength < 10:
            raise RuntimeError('Board solid-count/thickness check failed')
        if abs(board.getGlobalPlacement().Rotation.Angle) > 1e-8:
            raise RuntimeError('Rotated board is outside this prototype scope')
        parents = [p for p in board.InList if p.TypeId == 'App::Part']
        if len(parents) != 1:
            raise RuntimeError('Expected assembly-preserving STEP import')
        assembly = parents[0]
        fabrication_prefixes = ('TopCopper~', 'BottomCopper~', 'TopSilkscreen~',
                                'BottomSilkscreen~', 'TopFpcStiffener~', 'BottomFpcStiffener~')
        excluded = [board.Label]
        components = []
        for obj in assembly.Group:
            if obj == board or obj.TypeId.startswith('App::Origin'):
                continue
            if obj.Label.startswith(fabrication_prefixes):
                excluded.append(obj.Label)
                continue
            if hasattr(obj, 'Shape') and not obj.Shape.isNull() and obj.Shape.Solids:
                components.append(obj)
        if len(components) != 1:
            raise RuntimeError('Expected exactly one component; multi-component PCB is unsupported')
        component = components[0]
        color_warnings = []
        shape, colors = colored_component(component, imported_colors, color_warnings)
        if not shape.isValid():
            raise RuntimeError('Source component geometry is invalid')
        gp = component.getGlobalPlacement()
        report = {'warnings': color_warnings, 'source': str(args.source.resolve()), 'part_id': args.part_id,
                  'board_label': board.Label, 'board_bounds_mm': bounds(board_shape),
                  'board_thickness_mm': bb.ZLength,
                  'component_label': component.Label,
                  'assembly_translation_mm': list(gp.Base),
                  'assembly_rotation_axis': list(gp.Rotation.Axis),
                  'assembly_rotation_degrees': gp.Rotation.Angle * 180 / 3.141592653589793,
                  'excluded_labels': excluded,
                  'assumptions': ['Single component on top side',
                                  'Board top surface is component mounting plane',
                                  'Footprint rotation is 0 degrees; preserve model alignment rotation'],
                  'extraction_version': 'colored-step/v1',
                  'limitations': ['Product hierarchy flattened; per-face colors preserved',
                                  'Footprint XY origin is user supplied; no pin-to-pad alignment verification'],
                  'outputs': {}}
        report['outputs']['board_coordinates'] = export_checked(shape, colors, paths['board'], args.part_id)
        mounted = shape.copy()
        mounted.translate(App.Vector(-args.footprint_x, -args.footprint_y, -bb.ZMax))
        report['mount_translation_mm'] = [-args.footprint_x, -args.footprint_y, -bb.ZMax]
        report['outputs']['mount_z0'] = export_checked(mounted, colors, paths['mount'], args.part_id)
        paths['report'].write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(report, indent=2, ensure_ascii=False))
    finally:
        App.closeDocument(doc.Name)


if __name__ == '__main__':
    main()
