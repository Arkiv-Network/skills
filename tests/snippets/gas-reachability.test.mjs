import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
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
 const opening=/```typescript(\r?\n)/.exec(text);assert.ok(opening,'Published TypeScript fence required');
 text=replaceOnce(text,opening[0],opening[0]+noOp+opening[1]);
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

// Exercise the published function itself as well as the AST gate. No imports,
// provider traffic, signing or wallet implementation enters this isolated probe.
const {default:ts}=await import(pathToFileURL(path.join(workspace,'node_modules/typescript/lib/typescript.js')));
async function aboveBound(markdown) {
 const fence=/```typescript\r?\n([\s\S]*?)\r?\n```/.exec(markdown);assert.ok(fence);
 const source=ts.createSourceFile('probe.ts',fence[1],ts.ScriptTarget.Latest,true);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='rabdiTxParams');assert.ok(fn);
 const compiled=ts.transpileModule(fn.getText(source).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let reads=0,sends=0;
 const reader={getBlock:async options=>{assert.deepEqual(options,{blockTag:'latest'});reads++;return {gasLimit:10000000n};},
  getTransactionCount:async()=>0,getBalance:async()=>10n**24n,
  createEntity:()=>{sends++;throw new Error('Send forbidden');}};
 const helper=new Function('safeError','sanitizedFailure','getGasPrice',compiled+'\nreturn rabdiTxParams;')(
  message=>new Error(message),()=>new Error('Sanitized failure'),async()=>1n);
 let rejected=false,result;
 try {result=await helper(reader,'0x'+'11'.repeat(20),10n**24n,4000000n);}catch{rejected=true;}
 assert.equal(reads,1);assert.equal(sends,0);
 return {rejected,result};
}
const caught='  } catch (error) {\n    throw sanitizedFailure(error);\n  }';
function handler(text,replacement) {
 // Only change rabdiTxParams, preserving every other published function.
 const start=text.indexOf('export async function rabdiTxParams('),end=text.indexOf('export async function ensureFirstNote',start);
 assert.ok(start>=0&&end>start);
 const body=text.slice(start,end),eol=body.includes('\r\n')?'\r\n':'\n';
 return text.slice(0,start)+replaceOnce(body,caught.replaceAll('\n',eol),replacement.replaceAll('\n',eol))+text.slice(end);
}
const catchCases=[
 ['catch returns','  } catch (error) {\n    return { nonce: 0, gas: 2n * estimate, gasPrice: 1n };\n  }',false],
 ['catch assigns and continues','  } catch (error) {\n    estimate = 2n * estimate;\n  }',false],
 ['finally returns','  } catch (error) {\n    throw sanitizedFailure(error);\n  } finally {\n    return { nonce: 0, gas: 2n * estimate, gasPrice: 1n };\n  }',false],
 ['nested catch swallows','  } catch (error) {\n    try { throw sanitizedFailure(error); } catch { estimate = 2n * estimate; }\n  }',false],
 ['nested call throws into returning catch','  } catch (error) {\n    try { (() => { throw safeError("Rejected"); })(); } catch { return { nonce: 0, gas: 2n * estimate, gasPrice: 1n }; }\n    throw sanitizedFailure(error);\n  }',false],
 ['nested finally returns','  } catch (error) {\n    try { throw sanitizedFailure(error); } finally { return { nonce: 0, gas: 2n * estimate, gasPrice: 1n }; }\n  }',false],
 ['sanitized rethrow','  } catch (error) {\n    throw safeError("Sanitized rejection");\n  }',true],
 ['nested sanitized rethrow','  } catch (error) {\n    try { throw sanitizedFailure(error); } catch { throw safeError("Sanitized rejection"); } finally { estimate = 0n; }\n  }',true],
];
for(const [name,replacement,protectedCaller] of catchCases)test('Turn 10 published direct helper: '+name,async t=>{
 const mutate=text=>handler(text,replacement),runtime=await aboveBound(mutate(originals.get(direct)));
 assert.equal(runtime.rejected,protectedCaller,'The extracted helper must expose the actual caller outcome');
 if(!protectedCaller&&runtime.result)assert.equal(runtime.result.gas,8000000n);
 const result=await inspectFixture(t,direct,mutate);assert.equal(result.passed,protectedCaller,JSON.stringify(result.failures));
});
for(const file of [importer,direct])test('Turn 10 published guard rejects if (false): '+file,async t=>{
 const result=await inspectFixture(t,file,text=>file===importer?
  replaceOnce(text,'check(gas <= block.gasLimit / 2n, "Gas exceeds half the latest block limit; retain intent and reconcile; split only unprepared work");','if (false) { check(gas <= block.gasLimit / 2n, "Gas exceeds half the latest block limit; retain intent and reconcile; split only unprepared work"); }'):
  replaceOnce(text,"if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');","if (false) { if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work'); }"));
 assert.equal(result.passed,false);
});
test('Turn 10 real published helper rejects above-bound gas at its caller',async t=>{
 assert.equal((await aboveBound(originals.get(direct))).rejected,true);
 assert.equal((await inspectFixture(t,direct,text=>text)).passed,true);
});
for(const [name,suffix,passed] of [
 ['catch returns','catch { return; }',false],
 ['catch swallows','catch { gas = gas; }',false],
 ['finally returns','finally { return; }',false],
 ['sanitized rethrow','catch { throw safeError("Sanitized rejection"); }',true],
])test('Turn 10 awaited delegated call: '+name,async t=>{
 const result=await inspectFixture(t,importer,text=>text.replaceAll('await checkHalfBlock(reader, gas);','try { await checkHalfBlock(reader, gas); } '+suffix));
 assert.equal(result.passed,passed);
});
test('Turn 10 CRLF fixture preserves the source and rejects the comment-only mutation',async t=>{
 const crlf=originals.get(direct).replace(/\r?\n/g,'\r\n'),mutated=commentOnly(direct,crlf);
 assert.ok(mutated.includes('```typescript\r\n'+noOp+'\r\n'));
 assert.equal(mutated.replace(noOp+'\r\n','').replace("check(gas <= block.gasLimit / 2n, 'Rejected');","if (gas > block.gasLimit / 2n) throw safeError('Gas exceeds half the latest block limit; split unprepared work');"),crlf);
 assert.equal((await inspectFixture(t,direct,()=>crlf)).passed,true);
 assert.equal((await inspectFixture(t,direct,()=>mutated)).passed,false);
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
