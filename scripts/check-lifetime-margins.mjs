import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
const cap=/maxLifetime|MAX_LIFETIME|maximum|measured[^.]*bound|inclusion\s+margin/i;
const advice=/\bmargin\b|\bsubtrac\w*|\bdeduct\w*|\bbelow[- ]maximum\b|7_?883_?970|(?:maxLifetime|MAX_LIFETIME)\s*-\s*\d/i;
const legacy=/\bSDK\s+1\.0\.0\b|\b(?:applies?\s+(?:only\s+)?to|only\s+(?:on|in|for))\s+1\.0\.0\b/i;

export function inspectLifetimeMargins(markdown){
 const failures=[];let paragraph=[],start=1,fence,legacyCode=false;
 function flush(){
  if(!paragraph.length)return;
  const body=paragraph.join(' ');legacyCode=legacy.test(body)&&/margin|deadline|subtrac/i.test(body);
  if(cap.test(body))for(const {segment,index} of segmenter.segment(body)){
   if(legacy.test(segment))continue;
   for(const clause of segment.split(/;|\bbut\b|\bhowever\b/i)){
    if(/^\s*Do not carry that manual margin advice over to `max\(\)` on SDK 1\.0\.1\./.test(clause))continue;
    const positive=clause.replace(/\b(?:no|without)\s+(?:\w+[ -]+){0,4}margin\b/gi,'')
     .replace(/\b(?:no|without)\s+(?:manual(?:ly)?\s+)?subtrac\w*/gi,'');
    if(advice.test(positive))failures.push({line:start,reason:'Maximum-lifetime margin/subtraction advice must explicitly be scoped to SDK 1.0.0',text:segment.trim()});
   }
  }
  paragraph=[];
 }
 for(const [index,line] of markdown.split(/\r?\n/).entries()){
  const delimiter=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if(delimiter){flush();if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence=undefined;continue;}
  if(fence){if(/(?:maxLifetime|MAX_LIFETIME)\s*-\s*\d/.test(line)&&!legacyCode)failures.push({line:index+1,reason:'Deadline-cap subtraction in a code example requires explicit SDK 1.0.0 compatibility context',text:line.trim()});continue;}
  if(!line.trim()){flush();continue;}
  if(/^\s*\|/.test(line)||/^#{1,6}\s/.test(line)){flush();start=index+1;paragraph=[line];flush();continue;}
  if(!paragraph.length)start=index+1;paragraph.push(line.trim());
 }
 flush();return failures;
}

export async function checkLifetimeMargins(root){
 const files=[],failures=[];
 async function walk(relative=''){
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
   if(['.git','node_modules','.checks','.checks-surf'].includes(entry.name))continue;
   const file=path.posix.join(relative,entry.name);
   if(entry.isSymbolicLink())throw new Error('Cannot certify symlinked guidance: '+file);
   if(entry.isDirectory())await walk(file);
   else if(/\.md$/i.test(entry.name)){files.push(file);for(const failure of inspectLifetimeMargins(await fs.readFile(path.join(root,file),'utf8')))failures.push({file,...failure});}
  }
 }
 await walk();return {passed:failures.length===0,files:files.sort(),failures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
 const result=await checkLifetimeMargins(root);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
