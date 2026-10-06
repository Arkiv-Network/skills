import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {repositoryRoot} from '../../scripts/build-plugin.mjs';
import {evalInputs} from '../../scripts/record-eval-inputs.mjs';
import {importEvalResults} from '../../scripts/import-eval-results.mjs';
import {sha256} from '../../scripts/extract-snippets.mjs';

async function fixture(context,{id='arkiv-query-trigger',passed=true,call='arkiv:arkiv-query',contamination=false}={}){
 const directory=await mkdtemp(path.join(process.env.ARKIV_TEST_TMPDIR||tmpdir(),'arkiv-eval-evidence-'));
 context.after(()=>rm(directory,{recursive:true,force:false}));
 await mkdir(path.join(directory,'traces'));
 const inputs=await evalInputs(repositoryRoot),startedAt=new Date().toISOString();
 const run={schemaVersion:1,partial:false,startedAt,suite:{modelOverride:'controlled-fixture-NOT-a-model',plugins:[{name:'arkiv',version:'0.1.0'}]},cases:[{name:id,arms:{with:[{passed,error:null,skippedPaidGraders:false}],without:[{passed:false,error:null,skippedPaidGraders:false}]}}]};
 const observations=[];
 for(const arm of ['with','without']){
  const events=[{type:'system',subtype:'init',plugins:arm==='with'||contamination?[{name:'arkiv',version:'0.1.0'}]:[]}];
  if(arm==='with'&&call)events.push({message:{content:[{type:'tool_use',name:'Skill',input:{skill:call}}]}});
  const bytes=Buffer.from(events.map(item=>JSON.stringify(item)).join('\n')+'\n'),file=path.join(directory,'traces',`${id}-${arm}.jsonl`);
  await writeFile(file,bytes);observations.push({id,arm,run:0,savedTrace:file,traceSha256:sha256(bytes)});
 }
 const bytes=JSON.stringify(run);
 await writeFile(path.join(directory,'run.json'),bytes);
 await writeFile(path.join(directory,'inputs.json'),JSON.stringify(inputs));
 await writeFile(path.join(directory,'inputs-after.json'),JSON.stringify({...inputs,capturedAt:new Date().toISOString(),inputsUnchanged:true}));
 await writeFile(path.join(directory,'trace-observations.json'),JSON.stringify({partial:false,sourceSha256:sha256(bytes),observations}));
 return directory;
}
test('current native ablation and matching trace admit only the observed case',async context=>{
 const bundle=await fixture(context);const report=await importEvalResults({bundles:[bundle]});
 assert.equal(report.result,'SKIPPED');assert.equal(report.cases.find(item=>item.id==='arkiv-query-trigger').status,'PASS');
 assert.ok(report.cases.some(item=>item.status==='SKIPPED'));assert.equal(report.rejectedBundles.length,0);
});
test('with-plugin grader failure is retained as failed evidence',async context=>{
 const bundle=await fixture(context,{passed:false});const report=await importEvalResults({bundles:[bundle]});assert.equal(report.result,'FAIL');
});
test('negative invocation cannot pass solely on an LLM grade',async context=>{
 const bundle=await fixture(context,{id:'arkiv-query-negative'});const report=await importEvalResults({bundles:[bundle]});
 assert.equal(report.cases.find(item=>item.id==='arkiv-query-negative').status,'FAIL');
});
test('baseline plugin contamination rejects the bundle',async context=>{
 const bundle=await fixture(context,{contamination:true});const report=await importEvalResults({bundles:[bundle]});
 assert.equal(report.rejectedBundles.length,1);assert.ok(report.cases.every(item=>item.status==='SKIPPED'));
});
test('trace tampering and late invalid cases cannot leave partial accepted evidence',async context=>{
 const bundle=await fixture(context);const file=path.join(bundle,'run.json');const run=JSON.parse(await readFile(file,'utf8'));
 run.cases.push({name:'unknown-case'});const bytes=JSON.stringify(run);await writeFile(file,bytes);
 const trace=JSON.parse(await readFile(path.join(bundle,'trace-observations.json'),'utf8'));trace.sourceSha256=sha256(bytes);
 await writeFile(path.join(bundle,'trace-observations.json'),JSON.stringify(trace));
 const rejected=await importEvalResults({bundles:[bundle]});assert.ok(rejected.cases.every(item=>item.status==='SKIPPED'));
 await writeFile(path.join(bundle,'traces','arkiv-query-trigger-with.jsonl'),'tampered');
 assert.equal((await importEvalResults({bundles:[bundle]})).rejectedBundles.length,1);
});
test('changed source hashes and partial model runs stay incomplete',async context=>{
 const bundle=await fixture(context);const before=JSON.parse(await readFile(path.join(bundle,'inputs.json'),'utf8'));
 before.sourceFiles.find(item=>item.file==='skills/arkiv-query/SKILL.md').sha256='a'.repeat(64);
 await writeFile(path.join(bundle,'inputs.json'),JSON.stringify(before));
 await writeFile(path.join(bundle,'inputs-after.json'),JSON.stringify({...before,capturedAt:new Date().toISOString(),inputsUnchanged:true}));
 assert.equal((await importEvalResults({bundles:[bundle]})).cases.find(item=>item.id==='arkiv-query-trigger').status,'SKIPPED');
 const run=JSON.parse(await readFile(path.join(bundle,'run.json'),'utf8'));run.partial=true;await writeFile(path.join(bundle,'run.json'),JSON.stringify(run));
 assert.equal((await importEvalResults({bundles:[bundle]})).rejectedBundles.length,1);
});
