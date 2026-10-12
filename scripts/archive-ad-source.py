"""Attach the exact AGPL dependency source archive to GitHub Releases."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
dependency = next(line.split('==', 1)[1] for line in
                  (root / 'tools/requirements-ad.txt').read_text().splitlines()
                  if line.startswith('altium-monkey=='))
with urllib.request.urlopen(f'https://pypi.org/pypi/altium-monkey/{dependency}/json', timeout=60) as response:
    info = json.load(response)
source = next(item for item in info['urls'] if item['packagetype'] == 'sdist')
with urllib.request.urlopen(source['url'], timeout=60) as response:
    data = response.read()
if hashlib.sha256(data).hexdigest() != source['digests']['sha256']:
    raise RuntimeError('Upstream source checksum mismatch')
out = root / 'release' / f'LCSC-Library-Converter-{version}-ad-dependency-source.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr(source['filename'], data)
    archive.writestr('source.json', json.dumps({'package': 'altium-monkey', 'version': dependency,
                      'url': source['url'], 'sha256': source['digests']['sha256'],
                      'license': 'AGPL-3.0-or-later'}, indent=2))
print(out)
