import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const sdk='@arkiv-network/sdk', maxBytes=256*1024;
async function read(file){const h=await fs.open(file,constants.O_RDONLY|(constants.O_NONBLOCK??0));try{const s=await h.stat();if(!s.isFile()||s.size>maxBytes)throw Error('unmeasured');return await h.readFile('utf8');}finally{await h.close();}}
// Deliberately small lexical subset. Comments and quoted text are not imports.
export function tokens(text){
 const out=[];let i=0;
 while(i<text.length){
  const rest=text.slice(i);let m;
  if((m=/^\s+|^\/\/[^\n]*|^\/\*[\s\S]*?\*\//.exec(rest))){i+=m[0].length;continue;}
  if(text[i]==='/')throw Error('unmeasured'); // Avoid interpreting regex literals as source imports.
  const q=text[i];
  if(q==='"'||q==="'"||q==='`'){
   let value='',escaped=false,closed=false;i++;
   for(;i<text.length;i++){const c=text[i];if(c==='\\'){escaped=true;i++;continue;}if(c===q){closed=true;i++;break;}value+=c;}
   if(!closed)throw Error('unmeasured');out.push({kind:q==='`'||escaped?'opaque':'string',value});continue;
  }
  if((m=/^[A-Za-z_$][\w$]*/.exec(rest))){out.push({kind:'name',value:m[0]});i+=m[0].length;continue;}
  out.push({kind:'punct',value:q});i++;
 }
 return out;
}
function imports(text){
 const t=tokens(text),found=[];
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i].value!=='import'||t[i-1]?.value==='.'||!['{','type'].includes(t[i+1]?.value))continue;
  let j=i+1;if(t[j]?.value==='type')j++;if(t[j]?.value!=='{')continue;
  const names=[];j++;
  while(j<t.length&&t[j].value!=='}'){
   if(t[j].value==='type'&&t[j+1]?.kind==='name')j++;
   if(t[j]?.kind!=='name')throw Error('unmeasured');names.push(t[j++].value);
   if(t[j]?.value==='as'){j++;if(t[j++]?.kind!=='name')throw Error('unmeasured');}
   if(t[j]?.value===',')j++;else if(t[j]?.value!=='}')throw Error('unmeasured');
  }
  if(t[j+1]?.value!=='from'||t[j+2]?.kind!=='string')continue;
  const spec=t[j+2].value;if(spec===sdk||spec.startsWith(sdk+'/'))found.push({spec,names});i=j+2;
 }
 return found;
}
function typeTargets(value){
 if(typeof value==='string'){
  if(/\.d\.(ts|mts|cts)$/.test(value))return [value];
  // TypeScript substitutes declaration extensions for explicit JS export targets.
  if(/\.mjs$/.test(value))return [value.slice(0,-4)+'.d.mts'];
  if(/\.cjs$/.test(value))return [value.slice(0,-4)+'.d.cts'];
  if(/\.js$/.test(value))return [value.slice(0,-3)+'.d.ts'];
  return [];
 }
 if(!value||typeof value!=='object'||Array.isArray(value))return [];
 if(typeof value.types==='string')return [value.types];
 return [...new Set(['import','require','default'].flatMap(k=>typeTargets(value[k])))];
}
async function exportsOf(root,entry,seen=new Set()){
 const real=await fs.realpath(path.resolve(root,entry));
 if(!real.startsWith(root+path.sep)||seen.size>=32||seen.has(real))throw Error('unmeasured');seen.add(real);
 const t=tokens(await read(real)),names=new Set();
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i].value!=='export')continue;
  let j=i+1;if(t[j]?.value==='declare')j++;
  if(['const','let','var','function','class','interface','enum','namespace','type'].includes(t[j]?.value)&&t[j+1]?.kind==='name'){
   // This small reader does not parse compound variable/type declarations.
   // Refuse an ambiguous comma rather than falsely declaring a later name absent.
   if(['const','let','var'].includes(t[j].value))for(let k=j+2;k<t.length&&t[k].value!==';';k++)if(t[k].value===',')throw Error('unmeasured');
   names.add(t[j+1].value);continue;
  }
  if(t[j]?.value==='type')j++;
  if(t[j]?.value==='default'){names.add('default');continue;}
  if(t[j]?.value==='*'){
   if(t[j+1]?.value!=='from'||t[j+2]?.kind!=='string'||!t[j+2].value.startsWith('.'))throw Error('unmeasured');
   const ref=t[j+2].value.replace(/\.js$/,'.d.ts');
   for(const name of await exportsOf(root,path.relative(root,path.resolve(path.dirname(real),ref)),new Set(seen)))names.add(name);continue;
  }
  if(t[j]?.value!=='{')throw Error('unmeasured');j++;
  while(j<t.length&&t[j].value!=='}'){
   if(t[j].value==='type'&&t[j+1]?.kind==='name')j++;
   if(t[j]?.kind!=='name')throw Error('unmeasured');let name=t[j++].value;
   if(t[j]?.value==='as'){j++;if(t[j]?.kind!=='name')throw Error('unmeasured');name=t[j++].value;}
   names.add(name);if(t[j]?.value===',')j++;else if(t[j]?.value!=='}')throw Error('unmeasured');
  }
 }
 return names;
}
export async function checkFile(file,cwd){
 const result={measured:false,diagnostics:[]};
 try{
  if(!path.isAbsolute(file)||!path.isAbsolute(cwd)||!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file))return result;
  const workspace=await fs.realpath(cwd),target=await fs.realpath(file);
  if(!target.startsWith(workspace+path.sep))return result;
  const requested=imports(await read(target));if(!requested.length)return result;
  let dir=path.dirname(target),root,pkg;
  for(let depth=0;depth<32;depth++){
   try{const candidate=path.join(dir,'node_modules',...sdk.split('/'));pkg=JSON.parse(await read(path.join(candidate,'package.json')));root=await fs.realpath(candidate);break;}catch(e){if(e.code!=='ENOENT')throw e;}
   const parent=path.dirname(dir);if(parent===dir)break;dir=parent;
  }
  if(!pkg||pkg.name!==sdk||!pkg.exports||typeof pkg.exports!=='object'||Object.keys(pkg.exports).some(k=>k.includes('*')))return result;
  for(const item of requested){
   const subpath=item.spec===sdk?'.':'.'+item.spec.slice(sdk.length);
   if(!Object.hasOwn(pkg.exports,subpath)||pkg.exports[subpath]===null){result.diagnostics.push({code:'ARKIV_IMPORT_SUBPATH',subpath});continue;}
   const entries=typeTargets(pkg.exports[subpath]);if(!entries.length)throw Error('unmeasured');
   // A missing name is reported only when absent from every readable standard
   // import/require declaration target. Missing targets leave it unmeasured.
   const names=new Set();for(const entry of entries)for(const name of await exportsOf(root,entry))names.add(name);
   for(const name of item.names)if(!names.has(name))result.diagnostics.push({code:'ARKIV_IMPORT_NAME',subpath,name});
  }
  result.measured=true;return result;
 }catch{return {measured:false,diagnostics:[]};}
}
export async function hook(input){
 if(input?.hook_event_name!=='PostToolUse'||!['Write','Edit'].includes(input.tool_name)||typeof input.tool_input?.file_path!=='string'||typeof input.cwd!=='string')return {};
 const r=await checkFile(input.tool_input.file_path,input.cwd);
 if(!r.measured||!r.diagnostics.length)return {};
 return {hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'Arkiv import check: '+r.diagnostics.map(d=>d.code==='ARKIV_IMPORT_SUBPATH'?`The installed SDK does not export subpath ${d.subpath}.`:`The installed declarations for ${d.subpath} do not export ${d.name}.`).join(' ')+' Inspect the installed declarations before changing the integration. This advisory check does not authorize installation or network calls.'}};
}
async function main(){
 if(process.argv[2]==='--hook'){let s='';for await(const b of process.stdin){s+=b;if(Buffer.byteLength(s)>32768)return;}const r=await hook(JSON.parse(s));if(Object.keys(r).length)console.log(JSON.stringify(r));}
 else console.log(JSON.stringify(await checkFile(path.resolve(process.argv[2]??''),process.cwd())));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{process.exitCode=0;});
