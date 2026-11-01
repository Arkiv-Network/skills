import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {inspectGasBounds} from '../gas-bound-check.mjs';

const workspace=process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace);
const importer='skills/arkiv-write-safety/references/resumable-import.md';
const direct='skills/arkiv-first-write/SKILL.md';
const originals=new Map(await Promise.all([importer,direct].map(async file=>[file,await fs.readFile(file,'utf8')])));
function replaceOnce(text,needle,replacement) {assert.equal(text.split(needle).length,2,'Mutation must target the exact published code');return text.replace(needle,replacement);}
const noOp='const check = (ok, why) => { /* if (!ok) throw safeError(why); */ };';
function earlyReturn(file,text) {
 const needle=file===importer?'async function checkHalfBlock(reader, gas) {':'operations = 1): Promise<TxParams> {';
 return replaceOnce(text,needle,needle+'\n  return;');
}
function commentOnly(file,text) {
 if(file===importer)return replaceOnce(text,'const check = (ok, why) => { if (!ok) throw safeError(why); };',noOp);
 text=replaceOnce(text,'```typescript\n','```typescript\n'+noOp+'\n');
 return replaceOnce(text,"if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');","check(gas <= block.gasLimit / 2n, 'Rejected');");
}
async function inspectFixture(t,file,mutate) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-gas-reachability-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-gas-reachability-'));await fs.rm(directory,{recursive:true});});
 const target=path.join(directory,file);await fs.mkdir(path.dirname(target),{recursive:true});
 await fs.writeFile(target,mutate(originals.get(file)),'utf8');
 return inspectGasBounds(directory,workspace);
}
for(const file of [importer,direct])for(const [name,mutate] of [['early return',earlyReturn],['comment-only no-op assertion',commentOnly]]) {
 test('published '+file+' rejects '+name,async t=>{
  const result=await inspectFixture(t,file,text=>mutate(file,text));
  assert.ok(result.inventory.length>0);assert.equal(result.passed,false,'A non-executing published guard must never pass');
  assert.ok(result.failures.some(x=>x.file===file));
 });
}
for(const file of [importer,direct])test('published '+file+' keeps its executable positive guard',async t=>{
 const result=await inspectFixture(t,file,text=>text);assert.equal(result.passed,true,JSON.stringify(result.failures));
});

const prefixes=[
 ['unconditional throw',"throw new Error('Stopped before checking');"],
 ['constant early return','if (true) return;'],
 ['conditional early return','if (reader.skip) return;'],
 ['short-circuit early return','if (true || reader.skip) return;'],
 ['infinite prefix','while (true) {}'],
 ['for prefix','for (;;) { throw new Error("No read"); }'],
 ['finally return','try {} finally { return; }'],
 ['switch return','switch (gas) { default: return; }'],
];
for(const file of [importer,direct])for(const [name,prefix] of prefixes)test(file+' rejects '+name+' before the bound',async t=>{
 const result=await inspectFixture(t,file,text=>{
  const needle=file===importer?'async function checkHalfBlock(reader, gas) {':'operations = 1): Promise<TxParams> {';
  return replaceOnce(text,needle,needle+'\n'+prefix);
 });assert.equal(result.passed,false);
});
test('comments do not hide the actual executable assertion or its predicate',async t=>{
 const result=await inspectFixture(t,importer,text=>replaceOnce(text,'if (!ok) throw safeError(why);','/* before */ if (/* predicate */ !ok) { /* branch */ throw safeError(why); }'));
 assert.equal(result.passed,true,JSON.stringify(result.failures));
});
test('comments inside a real direct comparison are parsed as trivia',async t=>{
 const result=await inspectFixture(t,direct,text=>replaceOnce(text,'gas > block.gasLimit / 2n','gas /* gas */ > block.gasLimit /* limit */ / 2n'));
 assert.equal(result.passed,true,JSON.stringify(result.failures));
});
test('a local no-op assertion cannot borrow a valid outer check implementation',async t=>{
 const result=await inspectFixture(t,importer,text=>replaceOnce(text,'async function checkHalfBlock(reader, gas) {','async function checkHalfBlock(reader, gas) {\n'+noOp));
 assert.equal(result.passed,false);
});
test('an asynchronous assertion cannot enforce the bound without await',async t=>{
 const result=await inspectFixture(t,importer,text=>replaceOnce(text,'const check = (ok, why) =>','const check = async (ok, why) =>'));
 assert.equal(result.passed,false);
});
for(const expression of ['false && gas > block.gasLimit / 2n','true || gas > block.gasLimit / 2n'])test('a short-circuit expression is not a direct bound: '+expression,async t=>{
 const result=await inspectFixture(t,direct,text=>replaceOnce(text,'gas > block.gasLimit / 2n',expression));assert.equal(result.passed,false);
});

test('a shadowed no-op delegated guard cannot borrow the outer implementation',async t=>{
 const result=await inspectFixture(t,importer,text=>{
  const needle='await checkHalfBlock(reader, gas);';assert.equal(text.split(needle).length,3);
  return text.replaceAll(needle,'const checkHalfBlock = async (_reader, _gas) => { return; }; '+needle);
 });assert.equal(result.passed,false);
});
