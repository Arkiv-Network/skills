import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {checkSdk101Guidance,inspectSdk101Markdown,inspectSdk101Code,inspectSdk101Json} from '../../scripts/check-sdk-101-guidance.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),previous=[1,0,0].join('.'),label='SDK '+previous;
const oldUrl='https://unpkg.com/@arkiv-network/sdk@'+previous+'/src/errors.ts';
const oldInstall='npm install --save-exact @arkiv-network/sdk@'+previous;

test('current SDK citations and setup admit the verified 1.0.1 release',async()=>{const result=await checkSdk101Guidance(root);console.log(JSON.stringify({sdk101GuidanceInventory:result}));assert.equal(result.passed,true,JSON.stringify(result.failures));});
for(const text of [
 'Sources: ['+label+' source]('+oldUrl+').',
 'Sources: [SDK README]('+oldUrl+').',
 'Current SDK source: '+oldUrl,
 oldInstall,
 'This guide targets '+label+'.',
 'This application uses '+label+'.',
 'The current '+label+' is required.',
 'Checked against published '+label+' source on 2026-10-30.',
 label+' README',
 'Historical receipt from 2026-10-30. Sources: [SDK source]('+oldUrl+').',
 '[Historical '+label+' behavior]('+oldUrl+') and [current source]('+oldUrl+').',
 '# Historical '+label+' receipts\n\n[old source]('+oldUrl+')\n\n## Current setup\n\n'+oldInstall,
])test('unscoped current SDK-version mutation fails: '+text,()=>assert.notDeepEqual(inspectSdk101Markdown(text),[]));

test('explicit historical and old-version behavior links remain valid',()=>{
 for(const text of [
  'Historical '+label+' behavior: [old source]('+oldUrl+').',
  '['+label+' behavior: native revert]('+oldUrl+').',
  '[Historical '+label+' source]('+oldUrl+').',
  '# Historical '+label+' receipt on 2026-10-30\n\n[source]('+oldUrl+')\n\n```bash\n'+oldInstall+'\n```',
  'For '+label+' compatibility, retain the measured lifetime fallback.',
  'The manual margin is only a compatibility fallback for '+label+'.',
 ])assert.deepEqual(inspectSdk101Markdown(text),[],text);
});
test('compatible ranges and current source are accepted',()=>{
 for(const text of ['SDK `^'+previous+'`, verified with 1.0.1.','SDK `>='+previous+' <2`, verified with 1.0.1.','SDK 1.0 on Rabdi.','npm install @arkiv-network/sdk@1.0.1','[SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/errors.ts)'])assert.deepEqual(inspectSdk101Markdown(text),[]);
});
test('code setup pins fail while the dated reconciliation runner stays historical',()=>{
 assert.notDeepEqual(inspectSdk101Code('const sdkVersion = "'+previous+'";'),[]);
 assert.notDeepEqual(inspectSdk101Code('exec("'+oldInstall+'");'),[]);
 assert.deepEqual(inspectSdk101Code('// Historical '+label+' runner for the 2026-10-30 journal.\nconst sdkVersion = "'+previous+'";'),[]);
});
test('catalog metadata, source-map strings and keys cannot hide current SDK pins',()=>{
 for(const data of [{sdkVersion:previous},{dependencies:{'@arkiv-network/sdk':previous}},{name:'@arkiv-network/sdk',version:previous},{names:[label+' source']},{sources:[oldUrl]},{sourcesContent:[oldInstall]},{[oldUrl]:'value'},{scope:'historical',child:{scope:'current',sdkVersion:previous}}])assert.notDeepEqual(inspectSdk101Json(data),[],JSON.stringify(data));
 assert.deepEqual(inspectSdk101Json({scope:'historical',sdkVersion:previous,source:oldUrl}),[]);
 assert.deepEqual(inspectSdk101Json({name:'unrelated-application',version:previous}),[]);
 assert.deepEqual(inspectSdk101Json({sdkVersion:'^'+previous}),[]);
});
test('mismatched historical label and current source version fail',()=>{
 assert.notDeepEqual(inspectSdk101Markdown('[Historical '+label+' source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/errors.ts)'),[]);
});
test('new reference and generated-catalog mutations fail the CLI',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-sdk-guidance-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-sdk-guidance-'));await fs.rm(directory,{recursive:true});});
 const reference=path.join(directory,'skills/new/references/source.md'),catalog=path.join(directory,'generated/catalog.json');await fs.mkdir(path.dirname(reference),{recursive:true});await fs.mkdir(path.dirname(catalog),{recursive:true});
 const invoke=()=>spawnSync(process.execPath,[path.join(root,'scripts/check-sdk-101-guidance.mjs'),directory],{encoding:'utf8'});
 await fs.writeFile(reference,'[SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/errors.ts)');assert.equal(invoke().status,0);
 await fs.writeFile(reference,'[SDK source]('+oldUrl+')');assert.equal(invoke().status,1);
 await fs.writeFile(reference,'[SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/errors.ts)');await fs.writeFile(catalog,JSON.stringify({sdkVersion:previous}));assert.equal(invoke().status,1);
});
