import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';

const oldSdk=/\bSDK\s+1\.0\.0\b/i;
const oldSpec=/(?:@arkiv-network(?:\/|%2f)sdk@1\.0\.0\b|npmjs\.com\/package\/@arkiv-network\/sdk\/v\/1\.0\.0\b|registry\.npmjs\.org\/@arkiv-network(?:\/|%2f)sdk\/(?:-\/sdk-)?1\.0\.0\b)/i;
const history=/\b(?:historical|history|archived|dated evidence)\b/i;
const behavior=/\bSDK\s+1\.0\.0(?:-only)?\s+(?:behavior|compatibility|only|baseline)\b|\b(?:fallback|margin|compatibility|unavailable|original|legacy)\b[^.;]{0,100}\bSDK\s+1\.0\.0\b|\bFor SDK\s+1\.0\.0\b|\bSDK\s+1\.0\.0\b[^.;]{0,80}\b(?:unavailable|does not expose)\b/i;
const target=/\b(?:targets?|uses?|current|latest|installed|requires)\s+(?:the\s+)?SDK\s+1\.0\.0\b|\b(?:checked|tested)\s+(?:with|against)\s+(?:published\s+)?SDK\s+1\.0\.0\b|\bSDK\s+1\.0\.0\s+(?:source|README|uses|targets|is\s+(?:the\s+)?(?:latest|current))\b/i;
const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
const pin=/\b(?:sdk|sdk[_-]?version|version)\s*[:=]\s*['"]1\.0\.0['"]|['"]@arkiv-network\/sdk['"]\s*:\s*['"]1\.0\.0['"]|\bassert\.equal\([^\n]*\.version\s*,\s*['"]1\.0\.0['"]/i;

function blockFailures(body,line,scopedHistory=false){
 const failures=[],links=[];
 const masked=body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(whole,label,url,index)=>{links.push({whole,label,url,index});return 'X'.repeat(whole.length);});
 for(const {segment,index} of segmenter.segment(masked)){
  const original=body.slice(index,index+segment.length),prose=masked.slice(index,index+segment.length);
  const historic=scopedHistory||(history.test(prose)&&!/\b(?:current|latest)\b/i.test(prose));
  for(const link of links.filter(x=>x.index>=index&&x.index<index+segment.length))if(oldSpec.test(link.url)||oldSdk.test(link.label)){
   const explicit=historic||history.test(link.label)||/SDK\s+1\.0\.0(?:-only)?\s+behavior/i.test(link.label);
   if(!explicit||(oldSdk.test(link.label)&&link.url.includes('sdk@1.0.1/')))failures.push({line,rule:'current-sdk-source',text:link.whole});
  }
  if(oldSpec.test(prose)&&!historic&&!/SDK\s+1\.0\.0(?:-only)?\s+behavior/i.test(prose))failures.push({line,rule:'current-sdk-pin-or-url',text:original.trim()});
  if(oldSdk.test(prose)&&!historic&&(target.test(prose)||!behavior.test(prose)))failures.push({line,rule:'current-sdk-label-or-target',text:original.trim()});
 }
 return failures;
}

export function inspectSdk101Markdown(text,{historical=false}={}){
 const failures=[],headings=[];let paragraph=[],start=1,fence,codeHistory=false;
 const headingHistory=()=>{let value=historical;for(const h of headings){if(h.current)value=false;else if(h.history)value=true;}return value;};
 function flush(){if(!paragraph.length)return;const body=paragraph.join(' ');codeHistory=headingHistory()||history.test(body)||/SDK\s+1\.0\.0(?:-only)?\s+behavior/i.test(body);failures.push(...blockFailures(body,start,headingHistory()));paragraph=[];}
 for(const [index,line] of text.split(/\r?\n/).entries()){
  const delimiter=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if(delimiter){flush();if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence=undefined;continue;}
  if(fence){failures.push(...blockFailures(line,index+1,codeHistory));if(pin.test(line)&&!codeHistory&&!history.test(line))failures.push({line:index+1,rule:'current-sdk-exact-pin',text:line.trim()});continue;}
  const heading=/^(#{1,6})\s/.exec(line);
  if(heading){flush();const level=heading[1].length;while(headings.length&&headings.at(-1).level>=level)headings.pop();headings.push({level,history:history.test(line),current:/\b(?:current|latest)\b/i.test(line)});paragraph=[line];start=index+1;flush();continue;}
  if(!line.trim()){flush();continue;}
  if(/^\s*\|/.test(line)){flush();paragraph=[line];start=index+1;flush();continue;}
  if(!paragraph.length)start=index+1;paragraph.push(line.trim());
 }
 flush();return failures;
}

export function inspectSdk101Code(text){
 const failures=[],lines=text.split(/\r?\n/);
 // A dated old runner is retained for its original signed journal, not current setup.
 const historic=lines.slice(0,8).some(x=>/^\s*\/\/ Historical SDK 1\.0\.0 runner\b.*\b20\d\d-\d\d-\d\d\b/.test(x));
 for(const [index,line] of lines.entries()){
  if(/^\s*(?:\/\/|\*)/.test(line))failures.push(...blockFailures(line.replace(/^\s*(?:\/\/|\*)\s?/,''),index+1,historic));
  else {
   if(oldSpec.test(line)&&!historic&&!history.test(line))failures.push({line:index+1,rule:'current-sdk-code-pin-or-url',text:line.trim()});
   if(pin.test(line)&&!historic&&!history.test(line))failures.push({line:index+1,rule:'current-sdk-exact-pin',text:line.trim()});
   if(oldSdk.test(line)&&target.test(line)&&!historic&&!history.test(line)&&!behavior.test(line))failures.push({line:index+1,rule:'current-sdk-code-target',text:line.trim()});
  }
 }
 return failures;
}

export function inspectSdk101Json(value,{historical=false}={}){
 const failures=[];
 function visit(node,field='',inHistory=historical){
  if(typeof node==='string'){for(const failure of inspectSdk101Markdown(node,{historical:inHistory}))failures.push({...failure,field});return;}
  if(Array.isArray(node)){node.forEach((x,i)=>visit(x,field+'['+i+']',inHistory));return;}
  if(!node||typeof node!=='object')return;
  const current=node.current===true||node.scope==='current'||node.status==='current';
  const scoped=current?false:inHistory||node.historical===true||history.test(String(node.scope??node.status??''));
  for(const [key,child] of Object.entries(node)){
   const sdkField=/^(?:sdk|sdk[_-]?version|arkiv-sdk)$/i.test(key)||key==='@arkiv-network/sdk'||(key==='version'&&node.name==='@arkiv-network/sdk');
   if(sdkField&&child==='1.0.0'&&!scoped)failures.push({line:1,field:field+'.'+key,rule:'current-sdk-catalog-pin',text:child});
   visit(key,field+'.<key>',scoped);visit(child,field+'.'+key,scoped);
  }
 }
 visit(value);return failures;
}

export async function checkSdk101Guidance(root){
 const files=[],failures=[];
 async function walk(relative=''){
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
   if(['.git','node_modules','.checks','.checks-surf'].includes(entry.name))continue;
   const file=path.posix.join(relative,entry.name);if(entry.isSymbolicLink())throw new Error('Cannot certify symlinked authored guidance: '+file);
   if(entry.isDirectory()){await walk(file);continue;}
   if(!/\.(?:md|mdx|[cm]?[jt]sx?|jsonl?|map|ya?ml|txt|snap)$/i.test(file))continue;
   const text=await fs.readFile(path.join(root,file),'utf8');files.push(file);let found;
   if(/\.(?:json|map)$/i.test(file)){try{found=inspectSdk101Json(JSON.parse(text));}catch{found=[{line:1,rule:'invalid-catalog-json'}];}}
   else if(/\.jsonl$/i.test(file)){found=text.split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return inspectSdk101Json(JSON.parse(line));}catch{return [{line:1,rule:'invalid-catalog-json'}];}});}
   else if(/\.[cm]?[jt]sx?$/i.test(file))found=inspectSdk101Code(text);
   else found=inspectSdk101Markdown(text,{historical:/^CHANGELOG(?:\.[\w-]+)?\.md$/i.test(entry.name)});
   for(const failure of found)failures.push({file,...failure});
  }
 }
 await walk();return {passed:failures.length===0,files:files.sort(),failures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const result=await checkSdk101Guidance(path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;}
