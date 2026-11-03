import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeFixture} from './fixtures/importer-rpc-fixture.mjs';

const workspace=process.env.ARKIV_SNIPPET_WORKSPACE;
assert.ok(workspace,'Supply the existing SDK 1.0.1 workspace');
const load=name=>import(pathToFileURL(path.join(workspace,'node_modules',name)));
const sdk=await load('@arkiv-network/sdk/dist/index.js');
const entity=await load('@arkiv-network/sdk/dist/entity/index.js');
const chains=await load('@arkiv-network/sdk/dist/chains/index.js');
const attr=await load('@arkiv-network/sdk/dist/schema/index.js');
const viem=await load('viem/_esm/index.js');
const accounts=await load('viem/_esm/accounts/index.js');

function setup({estimate=100000n,reverted=false}={}) {
 const account=accounts.privateKeyToAccount(accounts.generatePrivateKey());
 const fixture=makeFixture(account.address,{sdk,viem,chains,attr});
 fixture.estimatedGas=estimate;
 const request=async input=>{
  const result=await fixture.request(input);
  if(reverted&&input.method==='eth_getTransactionReceipt'&&result){
   const gas=fixture.transactions.get(result.transactionHash).gas;
   return {...result,status:'0x0',gasUsed:gas,cumulativeGasUsed:gas,logs:[]};
  }
  return result;
 };
 const wallet=sdk.createWalletClient({account,chain:chains.rabdi({accessKey:'synthetic-offline-key'}),cacheTime:0,transport:viem.custom({request},{retryCount:0})});
 const Model=sdk.defineSchema('sdk_101_contract',{title:sdk.str()});
 const create=(expiration=sdk.ExpirationTime.max(),gas)=>wallet.createEntity(Model,{title:'offline SDK behavior'},
  {expiration,salt:1n},{nonce:0,gasPrice:1n,...(gas===undefined?{}:{gas})});
 return {fixture,create};
}

test('SDK 1.0.1 exports the bounded maximum from root and entity, and max resolves at inclusion',async()=>{
 assert.equal(sdk.MAX_LIFETIME,7884000n);assert.equal(entity.MAX_LIFETIME,sdk.MAX_LIFETIME);
 const {fixture,create}=setup(),result=await create();
 assert.equal(result.expiresAt,fixture.head+sdk.MAX_LIFETIME);
 assert.equal(fixture.sends.length,1);
});
test('SDK 1.0.1 refuses a one-year lifetime before signing or forwarding',async()=>{
 const {fixture,create}=setup();
 await assert.rejects(create(sdk.ExpirationTime.fromYears(1)),entity.InvalidExpiryError);
 assert.equal(fixture.sends.length,0);assert.ok(!fixture.methods.some(x=>x.startsWith('eth_send')));
});
for(const [name,estimate,expected] of [
 ['25 percent headroom',100000n,125000n],
 ['integer headroom rounding',100003n,125003n],
 ['padding capped at the transaction limit',2n**24n-1000n,2n**24n],
 ['an estimate already above the limit remains oversized',2n**24n+1000n,2n**24n+1000n],
])test('SDK 1.0.1 default gas: '+name,async()=>{
 const {fixture,create}=setup({estimate}),result=await create();
 assert.equal(BigInt(fixture.transactions.get(result.txHash).gas),expected);
});
test('SDK 1.0.1 uses caller gas unchanged and does not estimate automatically',async()=>{
 const {fixture,create}=setup(),result=await create(sdk.ExpirationTime.max(),1000000n);
 assert.equal(BigInt(fixture.transactions.get(result.txHash).gas),1000000n);
 assert.ok(!fixture.methods.includes('eth_estimateGas'));
});
test('SDK 1.0.1 identifies authoritative gas exhaustion without a second submission',async()=>{
 const {fixture,create}=setup({reverted:true});
 await assert.rejects(create(),error=>error instanceof sdk.EntityMutationError&&/ran out of gas/.test(error.message)&&/^0x[0-9a-f]{64}$/.test(error.txHash));
 assert.equal(fixture.sends.length,1);
});
