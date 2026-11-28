import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
export const sourcePath=new URL('../demo.html',import.meta.url);
export function setup(saved=null,htmlOverride=null){
 const h=htmlOverride??fs.readFileSync(sourcePath,'utf8'),js=h.match(/<script>([\s\S]*?)<\/script>/)[1];
 new Function(js);
 const nodes=new Map(),events=new Map(),timers=new Map(),storage=new Map(),focuses=[];
 let timerId=0;
 const node=selector=>{
  if(nodes.has(selector))return nodes.get(selector);
  const attributes=new Map(),classes=new Set();
  const n={id:selector.startsWith('#')?selector.slice(1):selector,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,dataset:{},scrollTop:0,scrollHeight:100,selectionStart:0,
   classList:{add(...c){c.forEach(x=>classes.add(x))},remove(...c){c.forEach(x=>classes.delete(x))},contains(c){return classes.has(c)},toggle(c,v){if(v??!classes.has(c))classes.add(c);else classes.delete(c)}},
   setAttribute(k,v){attributes.set(k,String(v))},getAttribute(k){return attributes.get(k)??null},removeAttribute(k){attributes.delete(k)},
   addEventListener(t,fn){const key=selector+':'+t;events.set(key,[...(events.get(key)||[]),fn])},
   focus(){focuses.push(selector);document.activeElement=n},getClientRects(){return n.hidden?[]:[{}]},
   querySelector(s){return node(selector+' '+s)},querySelectorAll(){return []},
   showModal(){n.open=true},close(){n.open=false;(events.get(selector+':close')||[]).forEach(fn=>fn({target:n}))},
   matches(s){return selector===s},closest(){return n},reportValidity(){return true},setCustomValidity(){},setSelectionRange(a){n.selectionStart=a},scrollIntoView(){},contains(){return true}
  };nodes.set(selector,n);return n;
 };
 const document={activeElement:null,querySelector:node,getElementById:id=>node('#'+id),querySelectorAll:()=>[],contains:()=>true,addEventListener(t,fn){events.set('document:'+t,[...(events.get('document:'+t)||[]),fn])}};
 const sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const ctx=vm.createContext({document,sessionStorage,console,CSS:{escape:x=>String(x)},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},FormData:class{constructor(target){this.fields=target.fields||{}}get(k){return this.fields[k]??''}},window:{addEventListener(){}},navigator:{},URL,structuredClone});
 if(saved){const key=h.match(/const storeKey\s*=\s*['"]([^'"]+)/)?.[1]||h.match(/storeKey\s*=\s*['"]([^'"]+)/)?.[1];if(!key)throw Error('storage key missing');storage.set(key,JSON.stringify(saved))}
 vm.runInContext(js,ctx);
 const run=code=>vm.runInContext(code,ctx);
 const dispatch=(name,target,extra={})=>{const e={target,preventDefault(){},...extra};for(const fn of events.get(name)||[])fn(e)};
 return{h,ctx,run,node,nodes,events,timers,storage,focuses,sha256:crypto.createHash('sha256').update(h).digest('hex'),json:code=>JSON.parse(run('JSON.stringify('+code+')')),dispatch,
  input:(id,value)=>{const n=node('#'+id);n.value=value;dispatch('document:input',n)},
  click:dataset=>{const n={dataset,closest(){return n},getClientRects(){return[{}]},focus(){}};dispatch('document:click',n)},
  submit:(id,fields)=>dispatch('document:submit',{id,fields,dataset:{},reportValidity:()=>true})
 };
}
