import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceTextModule,SyntheticModule} from 'node:vm';
import {parentPort,workerData} from 'node:worker_threads';
import {makeFixture} from './snippets/fixtures/importer-rpc-fixture.mjs';
import {deepFreeze,frozenProvider,gasVectors,GAS_VECTOR_SEED} from './gas-bound-fixtures.mjs';

const {root,workspace,row}=workerData;
globalThis.fetch=async function fetch(){throw new TypeError('fetch failed');};
const modules=new Map();
async function dependency(specifier) {
 const files={'@arkiv-network/sdk':'@arkiv-network/sdk/dist/index.js','@arkiv-network/sdk/schema':'@arkiv-network/sdk/dist/schema/index.js',
  '@arkiv-network/sdk/query':'@arkiv-network/sdk/dist/query/index.js','@arkiv-network/sdk/chains':'@arkiv-network/sdk/dist/chains/index.js',
  viem:'viem/_esm/index.js','viem/actions':'viem/_esm/actions/index.js','viem/accounts':'viem/_esm/accounts/index.js'};
 if(modules.has(specifier))return modules.get(specifier);
 if(!specifier.startsWith('node:')&&!files[specifier])throw new Error('Unregistered dependency: '+specifier);
 let value=await import(specifier.startsWith('node:')?specifier:pathToFileURL(path.join(workspace,'node_modules',files[specifier])));
 // Freeze the formatted SDK return values as well as the raw RPC fixtures.
 if(specifier==='@arkiv-network/sdk') {const sdk=value;value={...sdk,createPublicClient:(...args)=>frozenProvider(sdk.createPublicClient(...args))};}
 modules.set(specifier,value);return value;
}
const {default:ts}=await import(pathToFileURL(path.join(workspace,'node_modules/typescript/lib/typescript.js')));
async function extract() {
 const markdown=await fs.readFile(path.join(root,row.file),'utf8');
 const fences=[...markdown.matchAll(/```(typescript|javascript)\r?\n([\s\S]*?)\r?\n```/g)];
 const found=fences.filter(f=>ts.createSourceFile('guide.ts',f[2],ts.ScriptTarget.Latest,true).statements.some(n=>ts.isFunctionDeclaration(n)&&n.name?.text===row.function));
 assert.equal(found.length,1,'Exactly one executable source fence must contain the helper');
 const fence=found[0],source=ts.createSourceFile('guide.ts',fence[2],ts.ScriptTarget.Latest,true);
 const internal=['params','txParams','requiredGas','checkHalfBlock'].filter(name=>source.statements.some(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)));
 const code=fence[1]==='typescript'?ts.transpileModule(fence[2],{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:fence[2];
 // Expose private functions only; every published statement/body is retained.
 const module=new SourceTextModule(code+(internal.length?'\nexport { '+internal.join(', ')+' };':''),{identifier:row.file});
 await module.link(async specifier=>{const values=await dependency(specifier);return new SyntheticModule(Object.keys(values),function(){for(const [name,value] of Object.entries(values))this.setExport(name,value);});});
 await module.evaluate();return module.namespace;
}
const importer='skills/arkiv-write-safety/references/resumable-import.md';
const adapters=new Map([
 ['skills/arkiv-first-write/SKILL.md:rabdiTxParams','params'],
 ['skills/arkiv-entity-expiration/SKILL.md:params','params'],
 ['skills/arkiv-entity-lifecycle/SKILL.md:txParams','params'],
 ['skills/arkiv-data-modeling/references/relationships.md:createRelated','relationships'],
 ['skills/arkiv-encryption/references/sdk-bytes.md:writeEncryptedNote','encryption'],
 ['skills/arkiv-first-write/references/estimate.md:estimateWithRequest','estimator'],
 ...['requiredGas','checkHalfBlock','prepareImport','runImport'].map(name=>[importer+':'+name,'importer']),
]);
const address='0x'+'11'.repeat(20),key='0x'+'22'.repeat(32),child='0x'+'33'.repeat(32),hash='0x'+'44'.repeat(32);
function state(vector) {
 const h={reads:0,sends:0,signatures:0};
 const builder={};for(const name of ['from','createdBy','where','limit'])builder[name]=()=>builder;builder.fetch=async()=>deepFreeze({entities:[]});deepFreeze(builder);
 h.reader=frozenProvider({skip:true,chain:{id:7794095},select:()=>builder,getChainId:async()=>7794095,
  getBlock:async options=>{assert.deepEqual(options,{blockTag:'latest'});h.reads++;return deepFreeze({gasLimit:vector.blockLimit});},
  getTransactionCount:async()=>2,getBalance:async()=>10n**24n,request:async({method})=>{assert.equal(method,'eth_gasPrice');return '0x3';},
  predictEntityKeys:async()=>[{key,salt:1n},{key:child,salt:2n}],getTransactionReceipt:async()=>({status:'success'})});
 const send=async(...args)=>{h.sends++;h.gas=args.at(-1).gas;return deepFreeze({txHash:hash,entityKey:key,createdEntities:[key,child],patchedEntities:[],deletedEntities:[],extendedEntities:[],ownershipChanges:[]});};
 h.wallet=deepFreeze({account:{address},chain:{id:7794095},createEntity:send,executeBatch:send});return h;
}
async function importerCall(module,h,vector) {
 const {estimate,gas}=vector;
 if(row.function==='checkHalfBlock')return module.checkHalfBlock(h.reader,gas);
 if(row.function==='requiredGas') {
  // Pure arithmetic has no block input: execute its actual admission pair.
  const cap=module.requiredGas(estimate,1,7794095);assert.equal(cap,gas);
  await module.checkHalfBlock(h.reader,cap);return cap;
 }
 const sdk=await dependency('@arkiv-network/sdk'),viem=await dependency('viem'),chains=await dependency('@arkiv-network/sdk/chains'),attr=await dependency('@arkiv-network/sdk/schema'),accounts=await dependency('viem/accounts');
 const signer=accounts.privateKeyToAccount(accounts.generatePrivateKey()),fixture=makeFixture(signer.address,{sdk,viem,chains,attr});
 const account={...signer,signTransaction:async tx=>{h.signatures++;return signer.signTransaction(tx);}};
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-gas-execution-'));
 const options={account,chain:fixture.reader.chain,request:deepFreeze(async args=>{
  if(args.method==='eth_getBlockByNumber'&&args.params[0]==='latest')h.reads++;
  return deepFreeze(await fixture.request(args));
 }),jobId:'gas-execution',batchSize:1,gasCeiling:100000000n,maxTotalCost:1000000000n,fees:{gasPrice:1n},
  planPath:path.join(directory,'plan.json'),journalPath:path.join(directory,'journal.jsonl'),
  rows:[{id:'gas-row',salt:1n,expiresAt:fixture.head+3600n,schema:sdk.defineSchema('gas_execution',{body:sdk.bytes()}),values:{body:new Uint8Array([1])},flags:{readonly:true}}]};
 fixture.estimatedGas=estimate;fixture.blockGasLimit=row.function==='runImport'?100000000n:vector.blockLimit;
 try {
  const prepared=await module.prepareImport(options);
  if(row.function==='prepareImport'){assert.equal(prepared.batches,1);return prepared;}
  options.planSha256=prepared.planSha256;fixture.blockGasLimit=vector.blockLimit;h.reads=0;
  const result=await module.runImport(options);assert.equal(result.state,'complete');return result;
 } finally {
  h.sends=fixture.sends.length;
  assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-gas-execution-'));
  await fs.rm(directory,{recursive:true});
 }
}
async function call(module,h,vector,adapter) {
 const {estimate}=vector;
 if(adapter==='importer')return importerCall(module,h,vector);
 if(adapter==='params')return row.function==='rabdiTxParams'?module[row.function](h.reader,address,10n**24n,estimate):module[row.function](h.reader,h.wallet,estimate);
 if(adapter==='relationships')return module.createRelated(h.reader,h.wallet,address,'gas-execution',async()=>estimate);
 if(adapter==='encryption')return module.writeEncryptedNote(h.reader,h.wallet,{encrypt:async()=>new Uint8Array([1])},'test',1n,async()=>estimate);
 if(adapter==='estimator') {
  const rpc=frozenProvider({request:async({method,params})=>{
   if(method==='eth_chainId')return '0x76edaf';
   if(method==='eth_estimateGas'){assert.equal(params[1],'latest');return '0x'+estimate.toString(16);}
   if(method==='eth_getBlockByNumber'){assert.deepEqual(params,['latest',false]);h.reads++;return deepFreeze({gasLimit:'0x'+vector.blockLimit.toString(16)});}
   h.sends++;throw new Error('Unexpected request');
  }});
  const chain=deepFreeze({id:7794095,name:'Synthetic',nativeCurrency:{name:'Test',symbol:'TEST',decimals:18},rpcUrls:{default:{http:['https://example.invalid']}}});
  return module.estimateWithRequest({type:'local',address,signTransaction:async()=>{h.signatures++;throw new Error('Signing forbidden');}},chain,rpc,wallet=>wallet.request({method:'eth_estimateGas',params:[{from:address,to:address,data:'0x'}]}));
 }
 throw new Error('Unexecutable adapter');
}
try {
 const adapter=adapters.get(row.file+':'+row.function);assert.ok(adapter,'Missing execution adapter: '+row.file+':'+row.function);
 const cases=[];
 for(const vector of gasVectors()) {
  const {above}=vector,module=await extract(),h=state(vector);let rejected=false,result,error;
  try{result=await call(module,h,vector,adapter);}catch(e){rejected=true;error=e.message;}
  const passed=above?rejected&&h.reads>0&&h.sends===0&&h.signatures===0:!rejected&&h.reads>0;
  cases.push({name:vector.name,estimate:String(vector.estimate),gas:String(vector.gas),blockLimit:String(vector.blockLimit),above,rejected,reads:h.reads,sends:h.sends,signatures:h.signatures,passed,error});
 }
 parentPort.postMessage({passed:cases.every(x=>x.passed),seed:GAS_VECTOR_SEED,cases});
}catch(error){parentPort.postMessage({passed:false,error:error.message});}
