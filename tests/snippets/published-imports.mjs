// Explicit network reproduction, separate from offline tests and production hooks.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {checkFile} from '../../skills/arkiv/scripts/check-imports.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-published-'));
const receipts=[];
try{
 for(const version of ['0.7.0','0.8.1']){
  const response=await fetch('https://registry.npmjs.org/@arkiv-network%2fsdk/'+version,{signal:AbortSignal.timeout(20000)});assert.ok(response.ok);const meta=await response.json();
  const tar=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(20000)});assert.ok(tar.ok);const bytes=Buffer.from(await tar.arrayBuffer());
  const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');assert.equal(integrity,meta.dist.integrity);
  const dir=path.join(root,version),archive=path.join(root,version+'.tgz');await fs.mkdir(dir);await fs.writeFile(archive,bytes);
  const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');assert.ok(entries.every(p=>p.startsWith('package/')&&!p.split('/').includes('..')));
  const dest=path.join(dir,'node_modules/@arkiv-network/sdk');await fs.mkdir(dest,{recursive:true});execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',dest]);
  const file=path.join(dir,'integration.ts');await fs.writeFile(file,"import { tiramisu } from '@arkiv-network/sdk/chains';\n");
  const result=await checkFile(file,dir);receipts.push({version,integrity,result});assert.equal(result.measured,true);
  assert.equal(result.diagnostics.length,version==='0.7.0'?1:0);
 }
 console.log(JSON.stringify({publishedReproduction:true,receipts},null,2));
}finally{await fs.rm(root,{recursive:true,force:true});}
