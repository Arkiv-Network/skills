import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
const cap=/maxLifetime|MAX_LIFETIME|maximum|measured[^.]*bound|inclusion\s+margin/i;
const advice=/\bmargin\b|\bsubtrac\w*|\bdeduct\w*|\bbelow[- ]maximum\b|7_?883_?970|(?:maxLifetime|MAX_LIFETIME)\s*-\s*\d/i;
const legacy=/(?:\b(?:for|in|on|with)\s+SDK\s+1\.0\.0\b|\bSDK\s+1\.0\.0\s+(?:compatibility|fallback|only|needs|requires|uses)\b|\b(?:fallback|compatibility)\b[^.;]{0,30}\bSDK\s+1\.0\.0\b|\b(?:applies?\s+(?:only\s+)?to|only\s+(?:on|in|for))\s+1\.0\.0\b)/i;
const otherVersion=/\bSDK\s+(?!1\.0\.0\b)\d+\.\d+\.(?:\d+|x)\b/i;

export function inspectLifetimeMargins(markdown){
 const failures=[],headings=[];let paragraph=[],start=1,fence,legacyCode=false;
 const headingScope=()=>{let scoped=false;for(const heading of headings){if(heading.legacy)scoped=true;else if(heading.other)scoped=false;}return scoped;};
 function flush(){
  if(!paragraph.length)return;
  const body=paragraph.join(' ');legacyCode=headingScope()||(legacy.test(body)&&/margin|deadline|subtrac/i.test(body));
  if(headings.some(x=>x.related)||cap.test(body))for(const {segment} of segmenter.segment(body)){
   const sentenceScope=/^\s*(?:For|In|On|With)\s+SDK\s+1\.0\.0\b/i.test(segment);
   for(const clause of segment.split(/;|\bbut\b|\bhowever\b/i)){
    if(!otherVersion.test(clause)&&(headingScope()||sentenceScope||legacy.test(clause)))continue;
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
  const heading=/^(#{1,6})\s/.exec(line);
  if(heading){flush();const level=heading[1].length;while(headings.length&&headings.at(-1).level>=level)headings.pop();headings.push({level,related:cap.test(line),legacy:/\bSDK\s+1\.0\.0\b/i.test(line),other:otherVersion.test(line)});start=index+1;paragraph=[line];flush();continue;}
  if(/^\s*\|/.test(line)){flush();start=index+1;paragraph=[line];flush();continue;}
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
