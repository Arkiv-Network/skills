import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import {pathToFileURL} from 'node:url';
import {before,after,test} from 'node:test';
import {inspectGasBounds} from '../gas-bound-check.mjs';

const workspace=process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace);
const manifest=JSON.parse(await fs.readFile(path.join(workspace,'snippet-manifest.json'),'utf8'));
const directory=await fs.mkdtemp(path.join(workspace,'extracted-gas-'));
const fetchBefore=globalThis.fetch;
before(()=>{globalThis.fetch=()=>{throw new Error('Network forbidden in gas-bound tests');};});
after(async()=>{globalThis.fetch=fetchBefore;assert.equal(path.dirname(directory),path.resolve(workspace));assert.ok(path.basename(directory).startsWith('extracted-gas-'));await fs.rm(directory,{recursive:true});});
async function load(source,internal) {
 const row=manifest.rows.find(x=>x.source===source&&x.language==='typescript');assert.ok(row);
 const markdown=await fs.readFile(source,'utf8'),fence=[...markdown.matchAll(/```typescript\r?\n([\s\S]*?)\r?\n```/g)][0][1];
 assert.equal(createHash('sha256').update(fence).digest('hex'),row.sha256,'Execute the compiled exact documentation fence');
 const code=await fs.readFile(row.path.replace(/\.ts$/,'.js'),'utf8');
 const target=path.join(directory,source.replaceAll('/','__')+'.mjs');
 // Only expose a private function for testing; its compiled body is unchanged.
 await fs.writeFile(target,code+(internal?'\nexport { '+internal+' };\n':''),{flag:'wx'});
 return import(pathToFileURL(target));
}
const first=await load('skills/arkiv-first-write/SKILL.md');
const expiration=await load('skills/arkiv-entity-expiration/SKILL.md','params');
const lifecycle=await load('skills/arkiv-entity-lifecycle/SKILL.md','txParams');
const relationships=await load('skills/arkiv-data-modeling/references/relationships.md');
const encryption=await load('skills/arkiv-encryption/references/sdk-bytes.md');
const estimator=await load('skills/arkiv-first-write/references/estimate.md');
const address='0x'+'11'.repeat(20),key='0x'+'22'.repeat(32),childKey='0x'+'33'.repeat(32),txHash='0x'+'44'.repeat(32);
const marker='synthetic-no-real-rpc-credential',privateUrl='https://example.invalid/'+marker;
function state(limit=10000000n) {
 const h={sends:0,signatures:0,reads:0,gas:undefined};
 const builder={};for(const method of ['from','createdBy','where','limit'])builder[method]=()=>builder;builder.fetch=async()=>({entities:[]});
 const reader={chain:{id:7794095},getChainId:async()=>7794095,select:()=>builder,
  getBlock:async options=>{assert.deepEqual(options,{blockTag:'latest'});h.reads++;if(h.blockError)throw new Error(privateUrl,{cause:new Error(privateUrl)});return {gasLimit:limit};},
  getTransactionCount:async()=>2,getBalance:async()=>10n**24n,request:async({method})=>{assert.equal(method,'eth_gasPrice');return '0x3';},
  getTransactionReceipt:async()=>({status:'success'}),getBlockNumber:async()=>100n,getEntity:async()=>({$expiresAt:500n}),
  predictEntityKeys:async()=>[{key,salt:1n},{key:childKey,salt:2n}]};
 const send=async(...args)=>{h.sends++;h.gas=args.at(-1).gas;return {txHash,entityKey:key,expiresAt:1000n,createdEntities:[key,childKey],patchedEntities:[],deletedEntities:[],extendedEntities:[],ownershipChanges:[]};};
 const wallet={account:{address},chain:{id:7794095},createEntity:send,extendEntity:send,executeBatch:send};
 return Object.assign(h,{reader,wallet});
}
const families=[
 {name:'rabdiTxParams',floor:1000000n,call:(h,e)=>first.rabdiTxParams(h.reader,address,10n**24n,e),entry:(h,e)=>first.ensureFirstNote(h,async()=>{}, {expiresAtBlock:1000n,minLifetime:0n},10n**24n,async()=>e)},
 {name:'expiration.params',floor:1000000n,call:(h,e)=>expiration.params(h.reader,h.wallet,e),entry:(h,e)=>expiration.addOneHour(h.reader,h.wallet,key,7884000n,async()=>e)},
 {name:'lifecycle.txParams',floor:1000000n,call:(h,e)=>lifecycle.txParams(h.reader,h.wallet,e),entry:(h,e)=>lifecycle.publish(h.reader,h.wallet,{expiresAtBlock:1000n,minLifetime:0n},1n,async()=>e)},
 {name:'createRelated',floor:1400000n,call:(h,e)=>relationships.createRelated(h.reader,h.wallet,address,'gas-test',async()=>e)},
 {name:'writeEncryptedNote',floor:1000000n,call:(h,e)=>encryption.writeEncryptedNote(h.reader,h.wallet,{encrypt:async()=>new Uint8Array([1])},'test',1n,async()=>e)},
];
for(const family of families) {
 test(family.name+' below half-block bound passes with twice the estimate',async()=>{
  const h=state(),result=await family.call(h,2000000n);assert.equal(result.gas??h.gas,4000000n);assert.equal(h.reads,1);
 });
 test(family.name+' above half-block bound throws before any send',async()=>{
  const h=state();await assert.rejects(family.call(h,4000000n),/half the latest block limit/);assert.equal(h.reads,1);assert.equal(h.sends,0);
  if(family.entry){const entry=state();await assert.rejects(family.entry(entry,4000000n),/half the latest block limit/);assert.equal(entry.sends,0);}
 });
 test(family.name+' preserves its operation floor and accepts exact half-block equality',async()=>{
  const h=state(family.floor*2n+1n),result=await family.call(h,100000n);assert.equal(result.gas??h.gas,family.floor);assert.equal(h.reads,1);
 });
 test(family.name+' refuses a floor above half the block even with a tiny estimate',async()=>{
  const h=state(family.floor*2n-1n);await assert.rejects(family.call(h,100000n),/half the latest block limit/);assert.equal(h.sends,0);
 });
 test(family.name+' latest block provider errors cannot leak keyed diagnostics',async()=>{
  const h=state();h.blockError=true;
  await assert.rejects((family.entry??family.call)(h,100000n),error=>{
   assert.equal(inspect(error,{depth:null}).includes(marker),false);assert.equal(Object.hasOwn(error,'cause'),false);return true;
  });assert.equal(h.sends,0);
 });
}
async function unsigned(estimate,limit,fail=false) {
 const h={reads:0,signatures:0,sends:0};
 const account={type:'local',address,signTransaction:async()=>{h.signatures++;throw new Error('Signing forbidden');}};
 const chain={id:7794095,name:'Synthetic',nativeCurrency:{name:'Test',symbol:'TEST',decimals:18},rpcUrls:{default:{http:['https://example.invalid']}}};
 const rpc={request:async({method,params})=>{
  if(method==='eth_chainId')return '0x76edaf';
  if(method==='eth_estimateGas'){assert.equal(params[1],'latest');return '0x'+estimate.toString(16);}
  if(method==='eth_getBlockByNumber'){h.reads++;assert.deepEqual(params,['latest',false]);if(fail)throw new Error(privateUrl);return {gasLimit:'0x'+limit.toString(16)};}
  h.sends++;throw new Error('Unexpected request');
 }};
 h.run=()=>estimator.estimateWithRequest(account,chain,rpc,wallet=>wallet.request({method:'eth_estimateGas',params:[{from:address,to:address,data:'0x'}]}));
 return h;
}
test('unsigned estimator accepts a padded cap below the latest bound without signing',async()=>{
 const h=await unsigned(2000000n,10000000n);assert.equal(await h.run(),2000000n);assert.equal(h.reads,1);assert.equal(h.signatures+h.sends,0);
});
test('unsigned estimator rejects an impossible padded cap without signing or sending',async()=>{
 const h=await unsigned(4000000n,10000000n);await assert.rejects(h.run(),/half the latest block limit/);assert.equal(h.reads,1);assert.equal(h.signatures+h.sends,0);
});
test('unsigned estimator checks the floor as well as twice the raw estimate',async()=>{
 const h=await unsigned(100000n,1999999n);await assert.rejects(h.run(),/half the latest block limit/);assert.equal(h.signatures+h.sends,0);
 const equal=await unsigned(100000n,2000001n);assert.equal(await equal.run(),100000n);assert.equal(equal.reads,1);
});
test('unsigned estimator sanitizes latest-block RPC failures',async()=>{
 const h=await unsigned(100000n,10000000n,true);await assert.rejects(h.run(),error=>{assert.equal(inspect(error,{depth:null}).includes(marker),false);assert.equal(Object.hasOwn(error,'cause'),false);return true;});assert.equal(h.signatures+h.sends,0);
});

const checkedSource="export async function newHelper(reader, estimate) {\nconst gas = estimate * 2n;\nconst block = await reader.getBlock({ blockTag: 'latest' });\nif (gas > block.gasLimit / 2n) throw new Error('Stopped');\nreturn gas;\n}";
const checkerMutations=[
 ['positive',text=>text,true],
 ['removed guard',text=>text.replace("if (gas > block.gasLimit / 2n) throw new Error('Stopped');",''),false],
 ['wrong comparison',text=>text.replace('gas > block','gas < block'),false],
 ['full-block bound',text=>text.replace('/ 2n','/ 1n'),false],
 ['historical block',text=>text.replace("'latest'","'safe'"),false],
 ['after return',text=>text.replace("if (gas > block.gasLimit / 2n) throw new Error('Stopped');\nreturn gas;","return gas;\nif (gas > block.gasLimit / 2n) throw new Error('Stopped');"),false],
 ['comment only',text=>text.replace('if (gas >','// if (gas >'),false],
 ['unreachable guard',text=>text.replace("if (gas > block.gasLimit / 2n) throw new Error('Stopped');","if (false) { if (gas > block.gasLimit / 2n) throw new Error('Stopped'); }"),false],
];
for(const [name,mutate,passed] of checkerMutations)test('automatic gas checker discovers a new helper: '+name,async t=>{
 const root=await fs.mkdtemp(path.join(directory,'new-guide-'));await fs.mkdir(path.join(root,'new'));
 await fs.writeFile(path.join(root,'new/SKILL.md'),'```typescript\n'+mutate(checkedSource)+'\n```\n');
 const result=await inspectGasBounds(root,workspace);assert.equal(result.inventory.length,1);assert.equal(result.passed,passed);
});

test('automatic gas checker attributes nested callback arithmetic to the computed gas, not the transport',async()=>{
 for(const valid of [true,false]) {
  const root=await fs.mkdtemp(path.join(directory,'callback-guide-'));await fs.mkdir(path.join(root,'new'));
  const body=checkedSource.slice(checkedSource.indexOf('{')+1,checkedSource.lastIndexOf('}'));
  const callback=valid?body:body.replace("if (gas > block.gasLimit / 2n) throw new Error('Stopped');",'');
  await fs.writeFile(path.join(root,'new/SKILL.md'),'```typescript\nexport function outer(reader, estimate) { const transport = custom({ async request() { '+callback+' } }); return transport; }\n```\n');
  const result=await inspectGasBounds(root,workspace);assert.equal(result.inventory.length,1);assert.equal(result.inventory[0].variable,'gas');assert.equal(result.passed,valid);
 }
});

test('automatic gas checker requires awaiting an asynchronous delegated bound before return',async()=>{
 for(const awaited of [true,false]) {
  const root=await fs.mkdtemp(path.join(directory,'delegate-guide-'));await fs.mkdir(path.join(root,'new'));
  const guard="async function bounded(reader, gas) { const block = await reader.getBlock({ blockTag: 'latest' }); if (gas > block.gasLimit / 2n) throw new Error('Stopped'); }";
  const source=guard+'\nexport async function newHelper(reader, estimate) { const gas = estimate * 2n; '+(awaited?'await ':'')+'bounded(reader, gas); return gas; }';
  await fs.writeFile(path.join(root,'new/SKILL.md'),'```typescript\n'+source+'\n```\n');
  const result=await inspectGasBounds(root,workspace);assert.equal(result.inventory.length,1);assert.equal(result.passed,awaited);
 }
});
