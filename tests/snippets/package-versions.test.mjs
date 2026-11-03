import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {checkSdk101Guidance,inspectPackageGuidance,inspectSdk101Json,packageVersions} from '../../scripts/check-sdk-101-guidance.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const previous=[0,1,0].join('.');

test('whole-tree guidance names registry-verified package releases',async()=>{
 const result=await checkSdk101Guidance(root);
 console.log(JSON.stringify({packageVersionInventory:result}));
 assert.equal(result.passed,true,JSON.stringify(result.failures));
});

for(const [name,version] of Object.entries(packageVersions)){
 test(name+' current installs, labels and source links follow the version map',()=>{
  for(const text of ['npm install --save-exact '+name+'@'+version,'Use `'+name+'` '+version+'.','Sources: ['+name+' release guide](https://unpkg.com/'+name+'@'+version+'/README.md).'])assert.deepEqual(inspectPackageGuidance(text),[],text);
  for(const text of [
   'npm install --save-exact '+name+'@'+previous,
   'Use `'+name+'` '+previous+' or newer.',
   'Use '+name+' '+previous+'.',
   'npm install '+name+'@^'+previous,
   'Source: https://unpkg.com/'+name+'%40'+previous+'/README.md',
   'Inspect `'+name+'`. Use version '+previous+' for its public API.',
   'Sources: ['+name+' guide](https://unpkg.com/'+name+'@'+previous+'/README.md).',
   'Sources: ['+name+' '+previous+' guide](https://github.com/example/library/blob/'+name+'-v'+previous+'/README.md).',
   'Historical receipt. Current package: '+name+'@'+previous,
   '# Historical releases\n\n'+name+'@'+previous+'\n\n## Current setup\n\n'+name+'@'+previous,
  ])assert.ok(inspectPackageGuidance(text).some(x=>x.rule==='non_current_package_version'),text);
  assert.deepEqual(inspectPackageGuidance('Historical '+name+' '+previous+' behavior on 2026-10-30.'),[]);
  assert.deepEqual(inspectPackageGuidance('# Historical releases\n\n'+name+'@'+previous),[]);
 });
 test(name+' catalog and every source-map string/key are inspected',()=>{
  for(const value of [{dependencies:{[name]:previous}},{name,version:previous},{sources:['https://unpkg.com/'+name+'@'+previous+'/dist/index.js']},{sourcesContent:['npm install '+name+'@'+previous]},{names:[name+' '+previous]},{file:name+'-'+previous+'.js'},{[name+'@'+previous]:'text'},{scope:'historical',child:{scope:'current',dependencies:{[name]:previous}}}])assert.ok(inspectSdk101Json(value).some(x=>x.rule==='non_current_package_version'),JSON.stringify(value));
  assert.deepEqual(inspectSdk101Json({dependencies:{[name]:version}}),[]);
  assert.deepEqual(inspectSdk101Json({historical:true,dependencies:{[name]:previous}}),[]);
 });
}

test('the short encryption guide label cannot keep an older release',()=>{
 assert.ok(inspectPackageGuidance('Sources: [encryption '+previous+' guide](https://example.com/README.md).').length);
});

test('new reference and catalog mutations fail the existing guidance CLI',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-package-guidance-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-package-guidance-'));await fs.rm(directory,{recursive:true});});
 const reference=path.join(directory,'skills/new/references/packages.md'),catalog=path.join(directory,'generated/catalog.json');
 await fs.mkdir(path.dirname(reference),{recursive:true});await fs.mkdir(path.dirname(catalog),{recursive:true});
 const invoke=()=>spawnSync(process.execPath,[path.join(root,'scripts/check-sdk-101-guidance.mjs'),directory],{encoding:'utf8'});
 const [name,version]=Object.entries(packageVersions)[0];
 await fs.writeFile(reference,'Use '+name+' '+version+'.');assert.equal(invoke().status,0);
 await fs.writeFile(reference,'Use '+name+' '+previous+'.');assert.equal(invoke().status,1);
 await fs.writeFile(reference,'Historical '+name+' '+previous+' behavior.');assert.equal(invoke().status,0);
 await fs.writeFile(catalog,JSON.stringify({dependencies:{[name]:previous}}));assert.equal(invoke().status,1);
});
