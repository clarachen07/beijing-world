"""Remove known generated data superseded by the verified current manifest.

Raw source snapshots and unrecognized user files are always retained.
"""
import json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'public/data'
manifest=json.loads((OUT/'manifest.json').read_text())
qa=json.loads((OUT/'geospatial-qa.json').read_text())
if qa['revision']!=manifest['revision']:
    raise RuntimeError('Run geographic QA for the current revision before pruning')
required={item['file'] for item in manifest['assets']}
if not all((OUT/file).is_file() for file in required):
    raise RuntimeError('Missing required assets; refusing cleanup')
removed=0; reclaimed=0
def remove(path):
    global removed,reclaimed
    if path.relative_to(OUT).as_posix() in required: return
    reclaimed+=path.stat().st_size; path.unlink(); removed+=1

for folder in ['tiles','imagery','collision','sources','traffic','terrain']:
    directory=OUT/folder
    for path in directory.glob('*'):
        if path.is_file() and re.fullmatch(r'[0-9a-f]{20}\.(?:bin\.gz|json(?:\.gz)?|jpg)',path.name): remove(path)
# These files belonged to the superseded version-1 procedural city generator.
for path in (OUT/'b').glob('*.bin.gz'): remove(path)
old_ground=OUT/'ground.jpg'
if old_ground.exists(): remove(old_ground)
if (OUT/'b').is_dir() and not any((OUT/'b').iterdir()): (OUT/'b').rmdir()
print(f'Removed {removed} superseded generated files; reclaimed {reclaimed:,} bytes')
