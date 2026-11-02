import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {discoverRetryGuides} from './check-retry-policy.mjs';

const related=/segment_range_of|github\.com\/Arkiv-Network\/arkiv\/issues\/283|\bRabdi\b[^\n]*eth_getLogs|eth_getLogs[^\n]*\bRabdi\b/i;
const action=/\b(?:split\w*|retr(?:y|ies|ied|ying)\w*|subdivid\w*|chunk\w*|halve\w*)\b|\brepeat\s+(?:the\s+)?(?:range|request)\b/i;
export const rangeProhibition='Do not split or retry the range.';
const catalogs=['skills/arkiv-troubleshooting/SKILL.md','skills/arkiv-troubleshooting/references/error-catalog.md'];

export async function checkRabdiLogWindow(root) {
 const files=await discoverRetryGuides(root),contents=new Map(),failures=[];
 for(const file of files)contents.set(file,await fs.readFile(path.join(root,file),'utf8'));
 for(const file of catalogs) {
  const row=(contents.get(file)??'').split(/\r?\n/).find(line=>line.startsWith('|')&&/segment_range_of\(transactions\): NotImplemented/.test(line));
  const required=[/eth_getLogs/,/-32603/,/about 1,000 blocks/,/live tail at head works/,/recreate the watcher at head/,/current state.*query/,/backfill.*catch-up/,/known old transaction/,/eth_getTransactionReceipt/,/issues\/283/];
  if(!row||!row.includes(rangeProhibition)||required.some(pattern=>!pattern.test(row)))failures.push({file,line:row?contents.get(file).split(/\r?\n/).indexOf(row)+1:1,reason:'Distinct log-window row and its bounded recovery guidance are required'});
 }
 for(const [file,text] of contents) {
  let paragraph=[],start=1,context=false,headingContext=false;const headings=[];
  const inspect=(body,line,carry=true)=>{
   const relevant=headingContext||context||related.test(body);
   if(relevant&&action.test(body.replaceAll(rangeProhibition,'')))failures.push({file,line,reason:'Unclassified split/range-retry wording for the Rabdi log-window error',text:body});
   if(carry&&related.test(body))context=true;
  };
  const flush=()=>{if(paragraph.length)inspect(paragraph.join(' '),start);paragraph=[];};
  for(const [index,line] of text.split(/\r?\n/).entries()) {
   const heading=/^(#{1,6})\s/.exec(line);
   if(heading){
    flush();const level=heading[1].length;
    if(context&&headings.length&&level>headings.at(-1).level)headings.at(-1).related=true;
    while(headings.length&&headings.at(-1).level>=level)headings.pop();
    headings.push({level,related:related.test(line)});context=false;headingContext=headings.some(x=>x.related);continue;
   }
   if(/^\s*\|/.test(line)){flush();inspect(line,index+1,false);continue;}
   if(!line.trim()){flush();continue;}
   if(!paragraph.length)start=index+1;paragraph.push(line.trim());
  }
  flush();
 }
 return {passed:failures.length===0,files,failures};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
 const result=await checkRabdiLogWindow(root);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
