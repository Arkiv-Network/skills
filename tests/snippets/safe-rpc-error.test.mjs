import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {test} from 'node:test';
import {safeProviderError,safeProviderDiagnostic} from '../../scripts/safe-rpc-error.mjs';

test('CLI diagnostics drop provider messages, names, stacks and every nested cause',()=>{
 const marker='synthetic-surf-no-real-credential';
 const url='https://rpc.rabdi.db-chain.testnet.arkiv.network/'+marker;
 const original=Object.assign(new Error(url,{cause:new Error(url)}),{name:url,code:'ERR_ASSERTION'});
 original.stack=url;
 for(const stage of ['seed','lifetime','live',url]){
  const error=safeProviderError(original,stage),diagnostic=safeProviderDiagnostic(original,stage);
  for(const value of [inspect(error,{depth:null}),JSON.stringify(error),JSON.stringify(diagnostic)]){
   assert.equal(value.includes(marker),false);
   assert.equal(value.includes(url),false);
  }
  assert.equal(Object.hasOwn(error,'cause'),false);
 }
});

test('sanitization does not even read provider-controlled getters',()=>{
 const original=new Proxy({}, {get(){assert.fail('Do not inspect provider error properties');}});
 assert.equal(safeProviderError(original,'seed').name,'ArkivOperationError');
 assert.equal(safeProviderDiagnostic(original,'seed').errorName,'ArkivOperationError');
});
