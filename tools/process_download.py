"""Process an extension ZIP locally using FreeCAD's bundled Python."""
import argparse
import json
import math
import re
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path


def process_entry(archive, prefix, args, root):
    names = archive.namelist()
    manifest = json.loads(archive.read(prefix + 'manifest.json').decode('utf-8'))
    if manifest.get('schema') != 'lcsc-cadence-download/v1':
        raise ValueError('Unsupported manifest schema')
    part_id = manifest.get('partId', '')
    if not re.fullmatch(r'C[1-9]\d*', part_id):
        raise ValueError('Invalid part ID')
    if prefix and prefix != part_id + '/':
        raise ValueError('Part directory and manifest ID do not match')
    target = root / part_id
    target.mkdir(parents=True, exist_ok=False)
    # Read only fixed filenames. Never execute or extract arbitrary ZIP paths.
    for name in ['manifest.json', 'pcb_with_component.step', 'device.elibz',
                 'footprint.elibz', 'footprint_sources.json', 'pcb_document.epro']:
        if prefix + name in names:
            (target / name).write_bytes(archive.read(prefix + name))
    if manifest.get('artifacts', {}).get('pcb_with_component.step', {}).get('status') != 'included':
        return {'partId': part_id, 'status': 'skipped_no_step', 'directory': str(target),
                'warnings': manifest.get('warnings', [])}
    placement = manifest.get('placement', {})
    if placement.get('layer') != 1 or placement.get('footprintRotationDeg') != 0:
        raise ValueError('Only top-side, zero-rotation components are supported')
    x = float(placement['footprintXMm'])
    y = float(placement['footprintYMm'])
    if not all(math.isfinite(v) for v in [x, y]):
        raise ValueError('Invalid footprint coordinates')
    overrides = [args.step_origin_x_mm, args.step_origin_y_mm]
    if any(v is not None for v in overrides):
        if not all(v is not None and math.isfinite(v) for v in overrides):
            raise ValueError('Supply both STEP-origin overrides as finite numbers')
        x, y = overrides
    elif abs(x) > 1e-8 or abs(y) > 1e-8:
        raise ValueError('Nonzero PCB origin requires STEP-coordinate calibration. '
                         'Use extension automatic placement at (0,0), or provide both '
                         '--step-origin-x-mm and --step-origin-y-mm after calibration.')
    extraction = Path(__file__).with_name('extract_easyeda_step.py')
    result = subprocess.run([sys.executable, str(extraction),
        str(target / 'pcb_with_component.step'), '--part-id', part_id,
        '--out-dir', str(target), '--footprint-x', str(x), '--footprint-y', str(y)],
        capture_output=True, text=True, encoding='utf-8', errors='replace')
    (target / 'processing.log').write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('FreeCAD extraction failed. See ' + str(target / 'processing.log'))
    return {'partId': part_id, 'status': 'extracted', 'directory': str(target)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('download', type=Path)
    parser.add_argument('--out-dir', type=Path)
    parser.add_argument('--step-origin-x-mm', type=float)
    parser.add_argument('--step-origin-y-mm', type=float)
    args = parser.parse_args()
    root = (args.out_dir or Path(__file__).parent / 'results').resolve()
    target = root / ('run_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    target.mkdir(parents=True, exist_ok=False)
    results = []
    with zipfile.ZipFile(args.download) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('ZIP contains duplicate names')
        if sum(i.file_size for i in archive.infolist()) > 100 * 1024 * 1024:
            raise ValueError('ZIP exceeds the 100 MiB prototype limit')
        if 'batch_manifest.json' in names:
            batch = json.loads(archive.read('batch_manifest.json').decode('utf-8'))
            if batch.get('schema') != 'lcsc-cadence-batch/v1':
                raise ValueError('Unsupported batch schema')
            ids = batch.get('requestedIds')
            if not isinstance(ids, list) or not 1 <= len(ids) <= 50:
                raise ValueError('Invalid batch size')
            if any(not isinstance(i, str) or not re.fullmatch(r'C[1-9]\d*', i) for i in ids):
                raise ValueError('Invalid batch IDs')
            if len(ids) != len(set(ids)):
                raise ValueError('Duplicate batch IDs')
            (target / 'batch_manifest.json').write_bytes(archive.read('batch_manifest.json'))
            entries = [(i, i + '/') for i in ids]
        else:
            single = json.loads(archive.read('manifest.json').decode('utf-8'))
            entries = [(single.get('partId'), '')]
        for part_id, prefix in entries:
            if prefix + 'manifest.json' not in names:
                results.append({'partId': part_id, 'status': 'not_started'})
                continue
            try:
                result = process_entry(archive, prefix, args, target)
            except Exception as error:
                result = {'partId': part_id, 'status': 'failed', 'message': str(error)}
            results.append(result)
            print(str(part_id) + ': ' + result['status'])
    (target / 'processing_summary.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    print('Results: ' + str(target))
    if not any(r['status'] == 'extracted' for r in results):
        raise RuntimeError('No models extracted; see processing_summary.json')
    if any(r['status'] != 'extracted' for r in results):
        print('Some parts were not extracted. See processing_summary.json.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ERROR: ' + str(error), file=sys.stderr)
        sys.exit(1)
