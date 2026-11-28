from pathlib import Path
import hashlib,json,re,subprocess
root=Path('openspec/changes/agent-brain-external-collaboration'); entries=[]; refs=0
for path in sorted(root.rglob('*')):
 if not path.is_file():continue
 data=path.read_bytes()
 if path.suffix in {'.md','.html','.mjs','.js','.json','.py','.txt','.css'}:
  content=data.decode('utf-8',errors='strict');assert '\x00' not in content,str(path)
  if path.suffix=='.json':json.loads(content)
  if path.suffix=='.md':
   for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)',content):
    if link.startswith(('https://','http://','#','mailto:')):continue
    target=link.split('#',1)[0];assert (path.parent/target).exists(),f'{path}: missing {link}';refs+=1
 entries.append({'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
files=subprocess.check_output(['git','diff','--name-only','452e9c5a2fd91f427df3cddec68124c9f0c492e6'],text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()
assert all(f.startswith(str(root)+'/') for f in files),files
for f in ['src','extensions','package.json','package-lock.json','.github']:
 assert not subprocess.check_output(['git','diff','origin/main','--',f]),f
subprocess.run(['git','diff','--check'],check=True)
result={'result':'PASS','files':len(entries),'relative_references':refs,'v03_scope_only_preparation':True,'v03_base':'452e9c5a2fd91f427df3cddec68124c9f0c492e6','entries':entries}
Path('.local/agent-brain-v03/packet-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='entries'}))
