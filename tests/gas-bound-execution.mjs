import path from 'node:path';
import {Worker} from 'node:worker_threads';

// Inventory drives execution coverage. An absent adapter or unexecutable body
// is a failure, including when the structural layer already rejected the guide.
export async function executeGasBounds(root,workspace,inventory) {
 const results=[];
 for(const row of inventory)results.push(await new Promise(resolve=>{
  const worker=new Worker(new URL('./gas-bound-worker.mjs',import.meta.url),{workerData:{root:path.resolve(root),workspace:path.resolve(workspace),row}});
  let settled=false,message;
  const done=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve({...row,...result});};
  const timer=setTimeout(async()=>{await worker.terminate();done({passed:false,error:'Execution deadline exceeded'});},15000);
  worker.once('message',result=>{message=result;});
  worker.once('error',error=>done({passed:false,error:error.message}));
  worker.once('exit',code=>{if(!settled)done(code===0&&message?message:{passed:false,error:'Execution did not finish cleanly with a result: '+code});});
 }));
 return {passed:results.length>0&&results.every(x=>x.passed),results,failures:results.filter(x=>!x.passed)};
}
