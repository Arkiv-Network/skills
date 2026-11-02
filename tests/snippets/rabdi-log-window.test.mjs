import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {checkRabdiLogWindow,rangeProhibition} from '../../scripts/check-rabdi-log-window.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const catalogs=['skills/arkiv-troubleshooting/SKILL.md','skills/arkiv-troubleshooting/references/error-catalog.md'];
const originals=new Map(await Promise.all(catalogs.map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')])));
async function fixture(t) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-log-window-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-log-window-'));await fs.rm(directory,{recursive:true});});
 const put=async(file,text)=>{const target=path.join(directory,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text,'utf8');};
 for(const [file,text] of originals)await put(file,text);
 return {directory,put};
}
test('all discovered guidance distinguishes the Rabdi log-window error and forbids range workarounds',async()=>{
 const result=await checkRabdiLogWindow(root);console.log(JSON.stringify({rabdiLogWindowInventory:result}));assert.equal(result.passed,true,JSON.stringify(result.failures));
});
for(const file of catalogs)test('log-window omission mutation fails: '+file,async t=>{
 const f=await fixture(t);assert.equal((await checkRabdiLogWindow(f.directory)).passed,true);
 await f.put(file,originals.get(file).split(/\r?\n/).filter(line=>!line.startsWith('|')||!line.includes('segment_range_of')).join('\n'));
 const result=await checkRabdiLogWindow(f.directory);assert.equal(result.passed,false);assert.ok(result.failures.some(x=>x.file===file));
 await f.put(file,originals.get(file));assert.equal((await checkRabdiLogWindow(f.directory)).passed,true);
});
const unsafe=[
 'Split the range into smaller requests.',
 'Retry the range until it succeeds.',
 'Do not log credentials. Split the range.',
 rangeProhibition+' Retry the same range once.',
 'Use smaller chunks for the range.',
 'Halve the range and repeat the request.',
];
for(const [index,text] of unsafe.entries())test('range-workaround mutation is rejected in a newly discovered guide: '+index,async t=>{
 const f=await fixture(t),file=index%3===0?'skills/new/SKILL.md':index%3===1?'skills/new/references/logs.md':'skills/new/AGENTS.md';
 await f.put(file,'# segment_range_of(transactions): NotImplemented\n\n'+rangeProhibition+'\n');assert.equal((await checkRabdiLogWindow(f.directory)).passed,true);
 await f.put(file,'# segment_range_of(transactions): NotImplemented\n\n'+text+'\n');
 const result=await checkRabdiLogWindow(f.directory);assert.equal(result.passed,false);assert.ok(result.failures.some(x=>x.file===file));
});
test('CLI mutation rejects a range permission beside the valid troubleshooting prohibition',async t=>{
 const f=await fixture(t),invoke=()=>spawnSync(process.execPath,[path.join(root,'scripts/check-rabdi-log-window.mjs'),f.directory],{encoding:'utf8'});
 assert.equal(invoke().status,0);
 await f.put(catalogs[1],originals.get(catalogs[1]).replace(rangeProhibition,rangeProhibition+' Split the range.'));
 const result=invoke();assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).passed,false);
});
test('range guidance for a source EVM chain does not become a Rabdi recovery rule',async t=>{
 const f=await fixture(t);await f.put('skills/source/SKILL.md','For the source EVM chain, split the eth_getLogs range.\n');
 assert.equal((await checkRabdiLogWindow(f.directory)).passed,true);
});
