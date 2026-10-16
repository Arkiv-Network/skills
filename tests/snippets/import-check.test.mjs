import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkFile,hook} from '../../skills/arkiv/scripts/check-imports.mjs';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-import-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const put=async(p,v)=>{await fs.mkdir(path.dirname(path.join(dir,p)),{recursive:true});await fs.writeFile(path.join(dir,p),typeof v==='string'?v:JSON.stringify(v));};
 await put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',version:'0.7.0',exports:{'.':{types:'./index.d.ts'},'./chains':{types:'./chains.d.ts'}}});
 await put('node_modules/@arkiv-network/sdk/index.d.ts',"export { createPublicClient } from './client.js';");
 await put('node_modules/@arkiv-network/sdk/chains.d.ts','export declare const braga: unknown; export declare const kaolin: unknown; export declare const localhost: unknown;');
 return {dir,put};}
const cases=[
 ['observed old SDK lacks current chain',"import { tiramisu } from '@arkiv-network/sdk/chains';",1],
 ['existing old export',"import { braga as network } from '@arkiv-network/sdk/chains';",0],
 ['root missing expiration helper',"import { ExpirationTime } from '@arkiv-network/sdk';",1],
 ['root known export',"import { createPublicClient } from '@arkiv-network/sdk';",0],
 ['unrelated chain connection',"import { mainnet } from 'viem/chains';",0],
 ['comment neighbor',"// import { tiramisu } from '@arkiv-network/sdk/chains';",0],
 ['string neighbor',"const example = `import { tiramisu } from '@arkiv-network/sdk/chains';`",0],
 ['multiline alias',"import {\n tiramisu /* current */ as network,\n} from '@arkiv-network/sdk/chains';",1],
 ['type import',"import type { Missing } from '@arkiv-network/sdk';",1],
 ['missing subpath',"import { x } from '@arkiv-network/sdk/absent';",1],
];
for(const [name,source,count]of cases)test(name,async t=>{const f=await fixture(t);await f.put('app.ts',source);const r=await checkFile(path.join(f.dir,'app.ts'),f.dir);assert.equal(r.diagnostics.length,count);});
test('each hook execution rechecks exact edited file and workspace',async t=>{const f=await fixture(t);await f.put('app.ts',cases[0][1]);await f.put('unrelated.ts','export const count = 1;');
 const input={hook_event_name:'PostToolUse',tool_name:'Write',cwd:f.dir,tool_input:{file_path:path.join(f.dir,'app.ts')}};
 assert.ok((await hook(input)).hookSpecificOutput);assert.deepEqual(await hook({...input,tool_input:{file_path:path.join(f.dir,'unrelated.ts')}}),{});
 assert.deepEqual(await hook({...input,tool_name:'Bash'}),{});assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),path.join(f.dir,'outside')),{measured:false,diagnostics:[]});});
test('unknown declarations never imply a missing export',async t=>{const f=await fixture(t);await f.put('app.ts',cases[0][1]);await f.put('node_modules/@arkiv-network/sdk/chains.d.ts',"export * from 'external';");assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});});

test('published JS export targets resolve adjacent declarations conservatively',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports:{'./chains':{import:'./chains.js',require:'./chains.cjs'}}});
 assert.equal((await checkFile(path.join(f.dir,'app.ts'),f.dir)).measured,false);
 await f.put('node_modules/@arkiv-network/sdk/chains.d.cts','export declare const tiramisu: unknown;');
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:true,diagnostics:[]});
 await f.put('node_modules/@arkiv-network/sdk/chains.d.cts','export declare const braga: unknown;');
 assert.equal((await checkFile(path.join(f.dir,'app.ts'),f.dir)).diagnostics.length,1);
});

test('a compound variable declaration cannot establish a missing name',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/chains.d.ts','export declare const braga: unknown, tiramisu: unknown;');
 assert.equal((await checkFile(path.join(f.dir,'app.ts'),f.dir)).measured,false);
});

test('unsupported root export shapes cannot establish a missing subpath',async t=>{
 const f=await fixture(t);await f.put('app.ts',"import { createPublicClient } from '@arkiv-network/sdk';");
 for(const exports of [{types:'./index.d.ts',import:'./index.js'},['./index.js'],{'node':{types:'./index.d.ts'},default:'./index.js'}]){
  await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports});
  assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});
 }
});

test('unresolved export conditions cannot establish a missing name',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/node.d.ts','export declare const tiramisu: unknown;');
 await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports:{'./chains':{node:{types:'./node.d.ts'},default:'./chains.js'}}});
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});
});

test('the published Bun condition is inspected as data rather than ignored',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports:{'./chains':{bun:'./source.ts',import:'./chains.js'}}});
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});
 await f.put('node_modules/@arkiv-network/sdk/source.ts','throw Error("must never execute"); export const tiramisu = {};');
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:true,diagnostics:[]});
 await f.put('node_modules/@arkiv-network/sdk/source.ts','throw Error("must never execute"); export const braga = {};');
 const result=await checkFile(path.join(f.dir,'app.ts'),f.dir);
 assert.equal(result.measured,true);assert.equal(result.diagnostics.length,1);
});

test('an explicit types target does not hide a supported runtime condition',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports:{'./chains':{types:'./chains.d.ts',bun:'./source.ts',import:'./chains.js'}}});
 await f.put('node_modules/@arkiv-network/sdk/source.ts','throw Error("must never execute"); export const tiramisu = {};');
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:true,diagnostics:[]});
});

test('a nested fallback array cannot be ignored when establishing a missing name',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 await f.put('node_modules/@arkiv-network/sdk/alternative.d.ts','export declare const tiramisu: unknown;');
 for(const fallback of [['./alternative.js'],'./native.node',42]){
  await f.put('node_modules/@arkiv-network/sdk/package.json',{name:'@arkiv-network/sdk',exports:{'./chains':{types:'./chains.d.ts',default:fallback}}});
  assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});
 }
});

test('namespace and ambient exports cannot be mistaken for package-level exports',async t=>{
 const f=await fixture(t);await f.put('app.ts',cases[0][1]);
 for(const declarations of [
  'export declare namespace legacy { export const tiramisu: unknown; }',
  'declare namespace legacy { export const tiramisu: unknown; } export { legacy };',
  "declare module 'neighbor' { export const tiramisu: unknown; } export declare const braga: unknown;",
 ]){
  await f.put('node_modules/@arkiv-network/sdk/chains.d.ts',declarations);
  assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:false,diagnostics:[]});
 }
 await f.put('node_modules/@arkiv-network/sdk/chains.d.ts','export declare const tiramisu: unknown;');
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:true,diagnostics:[]});
 await f.put('node_modules/@arkiv-network/sdk/chains.d.ts','export declare const braga: unknown;');
 assert.deepEqual(await checkFile(path.join(f.dir,'app.ts'),f.dir),{measured:true,diagnostics:[{code:'ARKIV_IMPORT_NAME',subpath:'./chains',name:'tiramisu'}]});
});
