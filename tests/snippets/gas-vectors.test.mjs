import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deepFreeze,frozenProvider,gasVectors,GAS_VECTOR_SEED} from '../gas-bound-fixtures.mjs';

test('Turn 12 vector boundaries and seeded samples are reproducible',()=>{
 const vectors=gasVectors();assert.deepEqual(vectors,gasVectors());assert.equal(GAS_VECTOR_SEED,0x41524b49);
 const exact=vectors.find(x=>x.name==='exact half'),over=vectors.find(x=>x.name==='half plus one');
 assert.equal(exact.gas,exact.blockLimit/2n);assert.equal(exact.above,false);
 assert.equal(over.gas,over.blockLimit/2n+1n);assert.equal(over.above,true);
 assert.ok(vectors.find(x=>x.name==='far above').above);
 assert.ok(new Set(vectors.map(x=>String(x.blockLimit))).size>1);
 assert.ok(new Set(vectors.map(x=>String(x.estimate))).size>1);
 assert.ok(vectors.filter(x=>x.name.startsWith('seeded ')).length>1);
 assert.ok(Object.isFrozen(vectors)&&vectors.every(Object.isFrozen));
});
test('Turn 12 provider data is deeply frozen at synchronous and asynchronous boundaries',async()=>{
 const provider=frozenProvider({chain:{nativeCurrency:{symbol:'TEST'}},getBlock:async()=>({gasLimit:100n,transactions:[{hash:'0x00'}]}),read:()=>({nested:{value:1}})});
 assert.ok(Object.isFrozen(provider)&&Object.isFrozen(provider.chain.nativeCurrency));
 const block=await provider.getBlock();assert.ok(Object.isFrozen(block)&&Object.isFrozen(block.transactions[0]));
 assert.throws(()=>{block.gasLimit=1000n;},TypeError);
 assert.throws(()=>Object.defineProperty(block,'gasLimit',{value:1000n}),TypeError);
 assert.throws(()=>{provider.read().nested.value=2;},TypeError);
});
test('Turn 12 freezing handles cyclic fixture graphs',()=>{
 const value={nested:{}};value.nested.parent=value;deepFreeze(value);
 assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.nested));
});
test('Turn 12 mutable SDK builder state stays behind a frozen facade',async()=>{
 const builder={count:0,limit(value){this.count=value;return this;},async fetch(){return {entities:[{count:this.count}]};}};
 const provider=frozenProvider({select:()=>builder}),query=provider.select();
 assert.ok(Object.isFrozen(query));assert.equal(query.count,undefined);
 assert.equal(query.limit(3),query);assert.equal(builder.count,3);
 const page=await query.fetch();assert.equal(page.entities[0].count,3);
 assert.ok(Object.isFrozen(page)&&Object.isFrozen(page.entities[0]));
});
