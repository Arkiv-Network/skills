// Reproducible vectors, independent of helper names or implementation text.
export const GAS_VECTOR_SEED=0x41524b49;
export function deepFreeze(value,seen=new WeakSet()) {
 if(value===null||!['object','function'].includes(typeof value)||seen.has(value))return value;
 seen.add(value);
 for(const name of Reflect.ownKeys(value)) {
  const descriptor=Object.getOwnPropertyDescriptor(value,name);
  if('value' in descriptor)deepFreeze(descriptor.value,seen);
 }
 return Object.freeze(value);
}
export function frozenProvider(client) {
 const builders=new WeakMap();
 const expose=value=>{
  // SDK query builders mutate private control state while chaining. Expose
  // only a frozen callable facade; never leak or freeze that private state.
  if(value&&typeof value==='object'&&(typeof value.from==='function'||typeof value.fetch==='function')) {
   if(builders.has(value))return builders.get(value);
   const facade={};builders.set(value,facade);
   for(const name of ['from','createdBy','ownedBy','where','limit','offset','orderBy','fetch'])if(typeof value[name]==='function')facade[name]=(...args)=>finish(value[name](...args));
   return deepFreeze(facade);
  }
  return deepFreeze(value);
 };
 const finish=result=>result&&typeof result.then==='function'?result.then(expose):expose(result);
 return deepFreeze(Object.fromEntries(Object.entries(client).map(([name,value])=>[name,typeof value==='function'?function(...args) {
  const result=value.apply(client,args);
  return finish(result);
 }:value])));
}
export function gasVectors() {
 let state=GAS_VECTOR_SEED;
 const next=()=>state=(Math.imul(1664525,state)+1013904223)>>>0;
 const vector=(name,estimate,blockLimit)=>({name,estimate,gas:2n*estimate,blockLimit,above:2n*estimate>blockLimit/2n});
 const vectors=[vector('within',2000000n,10000000n),vector('legacy oversized',4000000n,10000000n),
  vector('exact half',1300001n,5200004n),vector('half plus one',1500007n,6000026n),vector('far above',3000019n,4000010n)];
 for(let index=0;index<4;index++)vectors.push(vector('seeded '+(index+1),900000n+BigInt(next()%4200000),3000000n+BigInt(next()%19000000)));
 return deepFreeze(vectors);
}
