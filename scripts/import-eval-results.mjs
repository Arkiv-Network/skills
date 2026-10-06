import {readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {evalInputs} from './record-eval-inputs.mjs';
import {sha256} from './extract-snippets.mjs';

async function json(file){return JSON.parse(await readFile(file,'utf8'));}
const arkivCall=name=>name==='arkiv'||name?.startsWith('arkiv:');
export async function importEvalResults({root=repositoryRoot,bundles=[],now=new Date()}={}){
 const current=await evalInputs(root),config=await json(path.join(root,'plugin.config.json'));
 const catalog=await json(path.join(root,'evals/catalog.json'));
 const currentHashes=new Map(current.sourceFiles.map(item=>[item.file,item.sha256]));
 const observed=new Map(), rejected=[];
 for(const directory of bundles){
  try{
   const bytes=await readFile(path.join(directory,'run.json'));
   const run=JSON.parse(bytes),before=await json(path.join(directory,'inputs.json')),
    after=await json(path.join(directory,'inputs-after.json')),traces=await json(path.join(directory,'trace-observations.json'));
   if(run.schemaVersion!==1||run.partial||!run.cases?.length||before.version!==1||after.inputsUnchanged!==true||
    before.sdk!==config.sdkVersion||before.pluginVersion!==config.version||
    JSON.stringify(before.sourceFiles)!==JSON.stringify(after.sourceFiles)||
    traces.sourceSha256!==sha256(bytes)||traces.partial||
    !run.suite?.plugins?.some(plugin=>plugin.name===config.name&&plugin.version===config.version)||
    Date.parse(before.capturedAt)>Date.parse(run.startedAt)||Date.parse(after.capturedAt)<Date.parse(run.startedAt)||
    !Number.isFinite(Date.parse(run.startedAt))||Date.parse(run.startedAt)>now.getTime()+300000)throw Error('Incomplete native run provenance');
   const hashes=new Map(before.sourceFiles.map(item=>[item.file,item.sha256]));
   const accepted=[];
   for(const entry of run.cases){
    const expected=catalog.cases.find(item=>item.id===entry.name);if(!expected)throw Error('Unknown native case');
    const relevant=[...expected.sources,'plugin.config.json','.claude-plugin/plugin.json','.mcp.json','hooks/hooks.json','hooks/arkiv-rules.mjs','source/always-on.md','templates/AGENTS.snippet.md',
     `evals/${entry.name}/prompt.md`,`evals/${entry.name}/graders/criteria.md`,`evals/${entry.name}/sources.json`];
    const families=new Set(expected.sources.map(file=>file.split('/')[1]));
    for(const file of current.sourceFiles)if(file.file.startsWith('skills/')&&families.has(file.file.split('/')[1]))relevant.push(file.file);
    let status='PASS',reason;
    if(relevant.some(file=>hashes.get(file)!==currentHashes.get(file))){status='SKIPPED';reason='Current case or guidance differs from the evaluated inputs';}
    const arms=entry.arms;
    if(!Array.isArray(arms?.with)||!arms.with.length||!Array.isArray(arms.without)||!arms.without.length)throw Error('Native ablation arms missing');
    const calls=[],actualFamilies=new Set(families);
    for(const [arm,runs]of Object.entries(arms))for(let index=0;index<runs.length;index++){
     const model=runs[index],trace=traces.observations.find(item=>item.id===entry.name&&item.arm===arm&&item.run===index);
     if(!trace||model.error||trace.error||model.skippedPaidGraders||typeof model.passed!=='boolean')throw Error('Model run or trace missing');
     const file=path.resolve(trace.savedTrace),relative=path.relative(path.resolve(directory,'traces'),file);
     if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!(await lstat(file)).isFile())throw Error('Trace is outside its evidence bundle');
     const traceBytes=await readFile(file);if(sha256(traceBytes)!==trace.traceSha256)throw Error('Trace bytes differ');
     const events=traceBytes.toString('utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
     const init=events.find(item=>item.type==='system'&&item.subtype==='init');
     const loaded=init?.plugins?.some(plugin=>plugin.name===config.name&&plugin.version===config.version);
     if(arm==='with'&&!loaded||arm==='without'&&loaded)throw Error('Host plugin ablation differs');
     const skills=events.flatMap(item=>item.message?.content??[]).filter(item=>item.type==='tool_use'&&item.name==='Skill').map(item=>item.input?.skill);
     if(arm==='with'){
      calls.push(...skills);
      for(const name of skills)if(arkivCall(name))actualFamilies.add(name.split(':').at(-1));
      for(const event of events)for(const item of event.message?.content??[])if(item.type==='tool_use'&&item.name==='Read'){
       const match=String(item.input?.file_path??'').replaceAll('\\','/').match(/\/skills\/(arkiv(?:-[a-z0-9-]+)?)\//);
       if(match)actualFamilies.add(match[1]);
      }
      if(status!=='SKIPPED'&&!model.passed){status='FAIL';reason='Native with-plugin grader failed';}
      if(status!=='SKIPPED'&&expected.category==='negative'&&skills.some(arkivCall)){status='FAIL';reason='Negative case invoked an Arkiv skill';}
      if(status!=='SKIPPED'&&expected.category==='trigger'&&!skills.some(name=>name===`${config.name}:${expected.skill}`||name===expected.skill)){
       status='FAIL';reason='Expected skill invocation was absent from the native trace';
      }
    }else if(skills.some(arkivCall))throw Error('Without-plugin arm invoked Arkiv guidance');
    }
    const actualSources=current.sourceFiles.filter(item=>item.file.startsWith('skills/')&&actualFamilies.has(item.file.split('/')[1]));
    if(actualSources.some(item=>hashes.get(item.file)!==item.sha256)){status='SKIPPED';reason='Actually invoked guidance differs from the evaluated inputs';}
    const value={id:entry.name,status,skills:expected.skill?[expected.skill]:[...families],
     evidence:{nativeReportSha256:sha256(bytes),model:run.suite.modelOverride,withRuns:arms.with.length,withoutRuns:arms.without.length,skillCalls:calls,baselinePassRate:arms.without.filter(item=>item.passed).length/arms.without.length},...(reason?{reason}:{})};
    accepted.push({name:entry.name,at:Date.parse(run.startedAt),value});
   }
   for(const entry of accepted)if(!observed.has(entry.name)||observed.get(entry.name).at<entry.at)observed.set(entry.name,entry);
  }catch{rejected.push({reason:'Bundle lacks current authenticated native input, ablation or trace evidence'});}
 }
 const cases=catalog.cases.map(entry=>observed.get(entry.id)?.value??{id:entry.id,status:'SKIPPED',skills:entry.skill?[entry.skill]:[...new Set(entry.sources.map(file=>file.split('/')[1]))],reason:'A current complete native model run is missing'});
 const result=cases.some(item=>item.status==='FAIL')?'FAIL':cases.some(item=>item.status==='SKIPPED')?'SKIPPED':'PASS';
 return{version:1,checkedAt:now.toISOString(),sdk:config.sdkVersion,chain:{name:'synthetic',id:null},kind:'evals',result,
  ...(result==='SKIPPED'?{reason:'Model coverage or current source provenance is incomplete'}:{}),sourceFiles:current.sourceFiles.filter(item=>item.file.startsWith('skills/')),cases,rejectedBundles:rejected,
  scope:'Native model behavior and observed skill invocation; no transaction, service or host-rule-loading certification'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [output,...bundles]=process.argv.slice(2);if(!output||!path.isAbsolute(output))throw Error('Pass an absolute output path and native evidence directories');
  const report=await importEvalResults({bundles});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,cases:report.cases.length,rejectedBundles:report.rejectedBundles.length}));if(report.result==='FAIL')process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
