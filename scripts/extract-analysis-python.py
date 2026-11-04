"""Extract one locked PBS installation, materializing internal links as files."""
import hashlib
import io
import json
import os
import posixpath
from pathlib import Path
import sys
import tarfile


def fail():
    raise ValueError('analysis_python_unsafe_archive')


archive, destination, expected_hash, expected_bytes = sys.argv[1:]
data = Path(archive).read_bytes()
if len(data) != int(expected_bytes) or hashlib.sha256(data).hexdigest() != expected_hash:
    raise ValueError('analysis_python_distribution_drift')
root = Path(destination)
if root.exists() or root.is_symlink():
    raise FileExistsError('analysis_python_environment_exists')
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as bundle:
    members = bundle.getmembers()
    indexed = {}
    if len(members) > 50000 or sum(m.size for m in members) > 512 * 1024 * 1024:
        fail()
    for member in members:
        name = member.name.rstrip('/')
        parts = name.split('/')
        if not name or parts[0] != 'python' or any(p in ('', '.', '..') for p in parts) or '\\' in name:
            fail()
        if name in indexed or not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
            fail()
        if name == 'python' and not member.isdir():
            fail()
        indexed[name] = member

    def regular_target(member):
        seen = set()
        while member.issym() or member.islnk():
            if member.name in seen:
                fail()
            seen.add(member.name)
            link = member.linkname
            if not link or link.startswith('/') or '\\' in link:
                fail()
            target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), link) if member.issym() else link)
            if not target.startswith('python/') or target not in indexed:
                fail()
            member = indexed[target]
        if not member.isfile():
            fail()
        return member

    # Validate every link and ancestor before creating the destination.
    for name, member in indexed.items():
        parts = name.split('/')
        for i in range(1, len(parts)):
            ancestor = indexed.get('/'.join(parts[:i]))
            if ancestor is not None and not ancestor.isdir():
                fail()
        if member.issym() or member.islnk():
            regular_target(member)
    root.mkdir(mode=0o700)
    count = 0
    for name, member in indexed.items():
        relative = name.split('/')[1:]
        if not relative:
            continue
        target = root.joinpath(*relative)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        original = regular_target(member)
        with bundle.extractfile(original) as source:
            content = source.read()
        if len(content) != original.size:
            fail()
        descriptor = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o755 if original.mode & 0o111 else 0o644)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
        count += 1
print(json.dumps({'files': count}))
