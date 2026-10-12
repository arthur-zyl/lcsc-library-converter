"""Publish immutable release support files separately from end-user assets."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess

BRANCH = 'release-support'


def api(repo, endpoint, payload=None, method='POST'):
    args = ['gh', 'api', f'repos/{repo}/{endpoint}']
    if payload is not None:
        args += ['--method', method, '--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, encoding='utf-8', capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def classify(files, version):
    prefix = f'LCSC-Library-Converter-{version}'
    user_names = {f'LCSC-Library-Converter-Setup-{version}.exe', f'{prefix}-win-x64.zip', 'SHA256SUMS.txt'}
    support_names = {f'{prefix}-ad-dependency-source.zip'}
    assets = [p for p in files if p.name in user_names]
    support = [p for p in files if p.name in support_names]
    if {p.name for p in assets} != user_names or not support_names <= {p.name for p in support}:
        raise ValueError('Missing required release files')
    if len({p.name for p in support}) != len(support):
        raise ValueError('Duplicate support filenames')
    return assets, support


def notes(repo, tag, support):
    base = f'https://raw.githubusercontent.com/{repo}/{BRANCH}/{tag}'
    version = tag[1:]
    links = [
        f'- [AD dependency corresponding source]({base}/LCSC-Library-Converter-{version}-ad-dependency-source.zip)',
    ]
    return '\n'.join([
        '# LCSC Library Converter', '',
        'Download components from LCSC and EasyEDA Pro and convert them to KiCad, Cadence or Altium libraries.', '',
        '## Windows downloads', '',
        '- **Setup EXE**: install the application on Windows x64.',
        '- **win-x64 ZIP**: portable application; extract the entire archive before launching.', '',
        'The application includes the EasyEDA Pro connection plugin and AD conversion dependencies. '
        'Click **Copy plugin folder** in the application, then import the extension from that folder in EasyEDA Pro. '
        'Use the setup guide to configure FreeCAD and any required EDA tools.', '',
        'The interface automatically selects Simplified Chinese or English from the system language.'
        if version != '0.1.0' else 'Use the setup guide to configure the application before exporting.', '',
        '## Corresponding source', '',
        'Project source is available through GitHub\'s built-in Source code downloads below. '
        'The following dependency source is provided for license compliance and is not required to run the application.', '',
        *links, '',
        'Project code and the AD conversion dependency are licensed under AGPL-3.0-or-later. '
        'Third-party license notices are included with the application.', '',
        f'[Changes in this version](https://github.com/{repo}/commits/{tag})', '',
    ])


def publish(repo, tag, support):
    refs = api(repo, f'git/matching-refs/heads/{BRANCH}')
    ref = next((r for r in refs if r['ref'] == f'refs/heads/{BRANCH}'), None)
    parent = ref['object']['sha'] if ref else api(repo, 'commits/main')['sha']
    base_tree = api(repo, f'git/commits/{parent}')['tree']['sha'] if ref else None
    existing = api(repo, f'git/trees/{base_tree}?recursive=1')['tree'] if base_tree else []
    existing = {entry['path']: entry['sha'] for entry in existing if entry['type'] == 'blob'}
    entries = []
    for path in support:
        data = path.read_bytes()
        sha = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
        target = f'{tag}/{path.name}'
        if target in existing:
            if existing[target] != sha:
                raise ValueError(f'Refusing to overwrite published support file: {target}')
            continue
        blob = api(repo, 'git/blobs', {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        entries.append({'path': target, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    if not entries:
        return
    tree_payload = {'tree': entries}
    if base_tree:
        tree_payload['base_tree'] = base_tree
    tree = api(repo, 'git/trees', tree_payload)
    commit = api(repo, 'git/commits', {'message': f'Archive corresponding source and support files for {tag}',
                                     'tree': tree['sha'], 'parents': [parent]})
    if ref:
        # A non-force update fails safely if another publisher changed the branch.
        api(repo, f'git/refs/heads/{BRANCH}', {'sha': commit['sha'], 'force': False}, method='PATCH')
    else:
        api(repo, 'git/refs', {'ref': f'refs/heads/{BRANCH}', 'sha': commit['sha']})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--notes', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?', args.tag):
        raise ValueError('Invalid version tag')
    _, support = classify([p for p in args.artifacts.rglob('*') if p.is_file()], args.tag[1:])
    publish(args.repo, args.tag, support)
    args.notes.write_text(notes(args.repo, args.tag, support), encoding='utf-8')
    print(f'Support files archived on {BRANCH}/{args.tag}; English release notes written.')


if __name__ == '__main__':
    main()
