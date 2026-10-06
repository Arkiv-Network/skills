import {mkdir,readFile,writeFile,lstat,rename,access,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {evalInputs} from './record-eval-inputs.mjs';
import {sha256} from './extract-snippets.mjs';

const within=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
export function validateEvalOutput(root,output){
 if(!path.isAbsolute(output)||path.resolve(output)===path.resolve(root)||within(root,output))throw Error('Choose a new absolute evaluation directory outside the repository');
}
export async function captureNativeTraces(directory){
 const bytes=await readFile(path.join(directory,'run.json')),report=JSON.parse(bytes);
 const observations=[],owned=new Set();await mkdir(path.join(directory,'traces'));
 for(const entry of report.cases??[])for(const [arm,runs]of Object.entries(entry.arms??{}))for(let index=0;index<runs.length;index++){
  if(!/^[a-z0-9-]+$/.test(entry.name)||!['with','without'].includes(arm))throw Error('Unrecognized native case or arm');
  const model=runs[index];if(!model.tracePath)continue;
  const source=path.resolve(model.tracePath),temporary=path.dirname(path.dirname(source));
  if(path.resolve(path.dirname(temporary))!==path.resolve(tmpdir())||!/^claude-eval-[A-Za-z0-9]{6}$/.test(path.basename(temporary))||
   source!==path.join(temporary,'out','trace.jsonl')||(await lstat(temporary)).isSymbolicLink()||!(await lstat(source)).isFile())throw Error('Native trace does not identify an owned evaluation directory');
  const traceBytes=await readFile(source),savedTrace=path.join(directory,'traces',`${entry.name}-${arm}-${index}.jsonl`);
  await writeFile(savedTrace,traceBytes,{flag:'wx'});if(sha256(await readFile(savedTrace))!==sha256(traceBytes))throw Error('Native trace copy differs');
  observations.push({id:entry.name,arm,run:index,savedTrace,traceSha256:sha256(traceBytes),error:model.error??null});owned.add(temporary);
 }
 const archive=path.join(directory,'owned-temp-archive');await mkdir(archive);
 for(const temporary of owned){
  const target=path.join(archive,path.basename(temporary));await rename(temporary,target);
  try{await access(temporary);throw Error('Owned temporary directory still exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!(await lstat(target)).isDirectory())throw Error('Owned temporary archive is absent');
 }
 const evidence={sourceSha256:sha256(bytes),partial:Boolean(report.partial),observations,retirement:{method:'archive-own-native-temporary-directories',count:owned.size,originalsAbsent:true}};
 await writeFile(path.join(directory,'trace-observations.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 return evidence;
}
export async function runModelEvals({root=repositoryRoot,output,filter='*',executable=process.platform==='win32'?'claude.exe':'claude',runs=3}={}){
 validateEvalOutput(root,output);if(!/^[a-z0-9*?_-]+$/.test(filter)||!Number.isSafeInteger(runs)||runs<1||runs>3)throw Error('Invalid case filter or run count');
 await mkdir(output,{recursive:false});const inputs=await evalInputs(root);
 await writeFile(path.join(output,'inputs.json'),JSON.stringify(inputs,null,2)+'\n',{flag:'wx'});
 const stdout=await open(path.join(output,'stdout.log'),'wx'),stderr=await open(path.join(output,'stderr.log'),'wx');
 let exit;
 try{
  const child=spawn(executable,['plugin','eval','.', '--case',filter,'--runs',String(runs),'--ablation','with-without','--concurrency','3',
   '--model','opus','--judge-model','opus','--trust-plugin','--no-publish','--no-scaffold','--mocks','record','--keep-temp',
   '--output-dir',output,'--json',path.join(output,'run.json')],{cwd:root,stdio:['ignore',stdout.fd,stderr.fd],windowsHide:true});
  exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 }finally{await stdout.close();await stderr.close();}
 const after=await evalInputs(root),inputsUnchanged=JSON.stringify(inputs.sourceFiles)===JSON.stringify(after.sourceFiles);
 await writeFile(path.join(output,'inputs-after.json'),JSON.stringify({...after,inputsUnchanged},null,2)+'\n',{flag:'wx'});
 const traces=await captureNativeTraces(output);return{exit:inputsUnchanged?(exit??1):1,inputsUnchanged,partial:traces.partial,modelRuns:traces.observations.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [output,filter='*',count='3']=process.argv.slice(2);if(!output||process.argv.length>5)throw Error('Usage: node scripts/run-model-evals.mjs /new/external/output [case-glob] [1|2|3]');
  const result=await runModelEvals({output,filter,runs:Number(count)});console.log(JSON.stringify(result));process.exitCode=result.exit;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
