from pathlib import Path
import re,json,subprocess,hashlib,datetime
r=Path('/workspace/OptraCall'); d=r/'openspec/changes/agent-brain-external-collaboration'; o=r/'.local/brain-v03-independent'; checks=[]
def rec(n,a,e=True):checks.append(dict(name=n,actual=a,expected=e,pass_=a==e))
def show(commit,p):return subprocess.check_output(['git','show',commit+':'+str(p.relative_to(r))],cwd=r)
links=[]
for p in sorted(d.glob('*.md')):
 for label,target in re.findall(r'\[([^\]]+)\]\(([^)]+)\)',p.read_text()):
  if ':' in target or target.startswith('#'):continue
  q=(p.parent/target.split('#')[0]);links.append({'source':str(p.relative_to(r)),'label':label,'target':target,'exists':q.exists()})
rec('local links missing',[x for x in links if not x['exists']],[])
files=subprocess.check_output(['git','diff','--name-only','origin/main'],cwd=r,text=True).splitlines();rec('full branch product differences',[x for x in files if not(x.startswith('openspec/changes/agent-brain-external-collaboration/') or x in ['README.md','docs/optracall-agent-brain-discussion-v0.1.md'])],[])
for name,original in [('result-v0.2.md','result.md'),('preparation-review-v0.2.md','preparation-review.md'),('integration-research-v0.2.md','integration-research.md')]:rec(name+' exact original preservation',show('0ff60301fed16321b35f315f15329e415a178450',d/original)==(d/name).read_bytes())
initial=json.loads((o/'input-manifest.json').read_text()); orig={x['path']:x for x in initial['files']}
for name in ['spec.md','tasks.md']:rec(name+' design unchanged since independent read',hashlib.sha256((d/name).read_bytes()).hexdigest(),orig[str((d/name).relative_to(r))]['sha256'])
html=(d/'ui-demo.html').read_text();rec('HTML delta is only ownAuth guard',hashlib.sha256(html.replace("case'choose-internal':if(ownAuth())","case'choose-internal':if(state.auth)").encode()).hexdigest(),orig[str((d/'ui-demo.html').relative_to(r))]['sha256']);research=(d/'integration-research.md').read_text();rec('F01 explicitly WB-only gate','该门槛只约束此适配' in research and '不阻断' in research);rec('F01 generic core path documented','通用' in research and '## 6' in research)
(o/'static-checks.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'links':links},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(checks,ensure_ascii=False,indent=2))
