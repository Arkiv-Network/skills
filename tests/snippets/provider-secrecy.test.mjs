import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspect} from 'node:util';
import {pathToFileURL} from 'node:url';
import {test, before, after} from 'node:test';

const workspace=process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace, 'Use the existing SDK snippet workspace');
const manifest=JSON.parse(await fs.readFile(path.join(workspace,'snippet-manifest.json'),'utf8'));
const load=async source=>{
 const row=manifest.rows.find(x=>x.source===source&&x.language==='typescript');
 assert.ok(row,'Compiled exact documentation fence missing: '+source);
 return import(pathToFileURL(row.path.replace(/\.ts$/,'.js')));
};
const sdk=await import(pathToFileURL(path.join(workspace,'node_modules/@arkiv-network/sdk/dist/index.js')));
const chains=await import(pathToFileURL(path.join(workspace,'node_modules/@arkiv-network/sdk/dist/chains/index.js')));
const accounts=await import(pathToFileURL(path.join(workspace,'node_modules/viem/_esm/accounts/index.js')));
const account=accounts.privateKeyToAccount(accounts.generatePrivateKey());
const marker='synthetic-surf-no-real-credential';
const url='https://rpc.rabdi.db-chain.testnet.arkiv.network/'+marker;
const originalFetch=globalThis.fetch;
let fetchCalls=0;
function providerError(){
 const error=new Error('HTTP transport failed at '+url,{cause:new Error('Nested request '+url)});
 error.name=url;
 error.details={url,accessKey:marker};
 return error;
}
before(()=>{globalThis.fetch=()=>{fetchCalls++;throw providerError();};});
after(()=>{globalThis.fetch=originalFetch;});
async function rejected(task){let error;try{await task();}catch(caught){error=caught;}
 assert.ok(error instanceof Error);
 for(const text of [inspect(error,{depth:null}),String(error),JSON.stringify(error,(_,value)=>typeof value==='bigint'?value.toString():value)]){
  assert.equal(text.includes(marker),false,'A returned diagnostic contains the synthetic access key');
  assert.equal(text.includes(url),false,'A returned diagnostic contains the keyed RPC URL');
 }
 assert.equal(Object.hasOwn(error,'cause'),false,'No raw or nested provider cause may escape');
 return error;
}

for(const failingMethod of ['eth_chainId','eth_estimateGas'])test('exact estimator drops keyed transport diagnostics on '+failingMethod,async()=>{
 const module=await load('skills/arkiv-first-write/references/estimate.md');
 const methods=[];let prepares=0;
 const rpc={request:async input=>{methods.push(input.method);if(input.method===failingMethod)throw providerError();return '0x76edaf';}};
 const error=await rejected(()=>module.estimateWithRequest(account,chains.rabdi({accessKey:marker}),rpc,async wallet=>{
  prepares++;return wallet.request({method:'eth_estimateGas',params:[{from:account.address,to:account.address,data:'0x'}]});
 }));
 assert.equal(error.message,'Unsigned preparation/estimate failed');
 assert.ok(methods.includes(failingMethod));
 assert.equal(prepares,failingMethod==='eth_chainId'?0:1);
});

test('convenience estimator protects its real HTTP transport and chain-ID preflight',async()=>{
 const module=await load('skills/arkiv-first-write/references/estimate.md');
 let prepared=0;const previous=fetchCalls;
 await rejected(()=>module.estimateWrite(account,marker,async()=>{prepared++;assert.fail('Must not reach prepare');}));
 assert.equal(prepared,0);
 assert.ok(fetchCalls>previous,'The real keyed HTTP transport must have been exercised');
});

test('wallet connection drops account and add-chain provider errors',async()=>{
 const module=await load('skills/arkiv-app-integration/references/browser-wallet.md');
 await rejected(()=>module.connectArkivWallet({request:async()=>{throw providerError();}},marker));
 let addChain=false;
 await rejected(()=>module.connectArkivWallet({request:async({method})=>{
  if(method==='eth_requestAccounts')return [account.address];
  if(method==='wallet_switchEthereumChain')throw Object.assign(new Error('Unknown chain'),{code:4902});
  if(method==='wallet_addEthereumChain'){addChain=true;throw providerError();}
  assert.fail('Unexpected method');
 }},marker));
 assert.equal(addChain,true);
});

test('event errors and asynchronous handler failures reach the UI as sanitized diagnostics',async()=>{
 const module=await load('skills/arkiv-app-integration/references/realtime.md');
 for(const mode of ['provider','handler']){
  let report;
  const reported=new Promise(resolve=>{report=resolve;});
  const client={watchEntityEvents:options=>{
   queueMicrotask(()=>mode==='provider'?options.onError(providerError()):options.onEvent({}));
   return ()=>{};
  }};
  const stop=module.watchSerially(client,async()=>{throw providerError();},report);
  const error=await reported;await rejected(async()=>{throw error;});stop();
 }
});

test('confirmed first-write read failure preserves only validated local identifiers',async()=>{
 const module=await load('skills/arkiv-first-write/SKILL.md');
 const txHash='0x'+'11'.repeat(32),entityKey='0x'+'22'.repeat(32);
 const builder={};for(const method of ['from','createdBy','where','limit'])builder[method]=()=>builder;
 builder.fetch=async()=>({entities:[]});
 const reader={getChainId:async()=>7794095,select:()=>builder,getTransactionCount:async()=>0,
  request:async()=> '0x1',getBalance:async()=>10000000n,getTransactionReceipt:async()=>{throw providerError();}};
 const wallet={chain:{id:7794095},account:{address:account.address},createEntity:async()=>({txHash,entityKey,expiresAt:1000n})};
 const error=await rejected(()=>module.ensureFirstNote({reader,wallet},async()=>{},sdk.ExpirationTime.fromDays(1),10000000n,async()=>100000n));
 assert.equal(error.txHash,txHash);assert.equal(error.entityKey,entityKey);assert.equal(error.expiresAt,1000n);
 assert.match(error.message,/needs reconciliation/);
});

test('query and publication readers sanitize provider failures',async()=>{
 let reads=0;
 const builder={};for(const method of ['from','createdBy','where','orderBy','withCount','limit','offset'])builder[method]=()=>builder;
 builder.fetch=async()=>{reads++;throw providerError();};
 const client={select:()=>builder};
 const query=await load('skills/arkiv-query/SKILL.md');
 await rejected(()=>query.cheapestPage(client,account.address));
 await rejected(()=>query.fetchAllListings(client,account.address));
 const trust=await load('skills/arkiv-security-trust/references/trust-boundary.md');
 await rejected(()=>trust.readPublicationPage(client,[account.address]));
 assert.equal(reads,3);
});
