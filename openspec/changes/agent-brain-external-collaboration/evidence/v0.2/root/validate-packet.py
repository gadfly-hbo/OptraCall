from pathlib import Path
import hashlib
import json
import re
root=Path('openspec/changes/agent-brain-external-collaboration')
entries=[]
references=0
text_types={'.md','.html','.mjs','.js','.json','.py','.txt','.css'}
for path in sorted(root.rglob('*')):
    if not path.is_file():
        continue
    data=path.read_bytes()
    if path.suffix in text_types:
        content=data.decode('utf-8',errors='strict')
        assert '\x00' not in content, f'NUL: {path}'
        if 'evidence' not in path.parts:
            assert not any(line.endswith((' ','\t')) for line in content.splitlines()), f'trailing whitespace: {path}'
        if path.suffix=='.json':
            json.loads(content)
        if path.suffix=='.md':
            for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',content):
                if link.startswith(('https://','http://','#','mailto:')):
                    continue
                target=link.split('#',1)[0]
                assert (path.parent/target).exists(),f'missing reference: {path}: {link}'
                references+=1
    entries.append({'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
result={'result':'PASS','files':entries,'existing_relative_references':references}
Path('.local/agent-brain-main-update/root/packet-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'result':'PASS','files':len(entries),'existing_relative_references':references}))
