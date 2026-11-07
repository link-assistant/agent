"""Stream pinned archives; preserve every tree blob without cloning histories."""
import json
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'dev/log/issues/340/pulls/341/templates'
for language in ['js', 'rust', 'python']:
    directory = BASE / language
    sha = json.loads((directory / 'commit.json').read_text())['sha']
    expected = set((directory / 'inventory.txt').read_text().splitlines())
    repository = f'link-foundation/{language}-ai-driven-development-pipeline-template'
    process = subprocess.Popen(['gh', 'api', f'repos/{repository}/tarball/{sha}'], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=process.stdout, mode='r|gz') as archive:
        for member in archive:
            path = PurePosixPath(*PurePosixPath(member.name).parts[1:])
            name = str(path)
            if name not in expected or '..' in path.parts:
                continue
            target = directory / 'files' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.issym():
                # Record the blob's link text; never follow archive symlinks.
                target.write_text(member.linkname)
            elif member.isfile():
                with archive.extractfile(member) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output, 65536)
    if process.wait() != 0:
        raise RuntimeError(f'Archive download failed: {repository}')
    missing = [path for path in expected if not (directory / 'files' / path).is_file()]
    if missing:
        raise RuntimeError(f'Missing blobs: {missing}')
    for entry in json.loads((directory / 'tree.json').read_text())['tree']:
        if entry['type'] != 'blob':
            continue
        raw = (directory / 'files' / entry['path']).read_bytes()
        actual = hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()
        if actual != entry['sha']:
            raise RuntimeError(f'Git object mismatch: {language}/{entry["path"]}')
    print(f'{language}: all {len(expected)} blobs preserved', flush=True)
