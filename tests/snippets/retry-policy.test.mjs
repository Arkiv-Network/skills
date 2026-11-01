import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {checkRetryPolicy,retryContract} from '../../scripts/check-retry-policy.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const audit=await checkRetryPolicy(root);
console.log(JSON.stringify({retryPolicyInventory:{...audit,inventory:audit.inventory.map(({context,...entry})=>entry)}}));
for(const file of audit.files)test('A3 automatically discovered retry policy: '+file,()=>{
  assert.deepEqual(audit.failures.filter(x=>x.file===file),[], 'Unclassified or weaker transaction-retry wording in '+file);
});

async function fixture(t, files={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-retry-policy-'));
  t.after(async()=>{
    assert.equal(path.dirname(directory),os.tmpdir());
    assert.ok(path.basename(directory).startsWith('arkiv-retry-policy-'));
    await fs.rm(directory,{recursive:true});
  });
  const put=async(file,text)=>{const target=path.join(directory,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text,'utf8');};
  await put('skills/arkiv-write-safety/SKILL.md','# Write safety\n\n## Reconcile before another submission\n\n'+retryContract+'\n');
  for(const [file,text] of Object.entries(files))await put(file,text);
  return {directory,put};
}
const reference='Any transaction retry must satisfy every condition of the [write-safety retry contract](../arkiv-write-safety/SKILL.md#reconcile-before-another-submission); no other retry or resend is allowed.';
test('automatic discovery includes new and nested SKILL, reference and AGENTS resources without a file catalog',async t=>{
  const f=await fixture(t,{'new/SKILL.md':'No automatic retry.','nested/references/deep/recovery.md':'The helpers do not retry.','nested/AGENTS.local.md':'No automatic retry.','AGENTS.md':'The helpers do not retry.'});
  const result=await checkRetryPolicy(f.directory);
  assert.equal(result.passed,true);assert.equal(result.discoveredFiles,5);
  assert.ok(result.files.includes('new/SKILL.md'));assert.ok(result.files.includes('nested/references/deep/recovery.md'));assert.ok(result.files.includes('nested/AGENTS.local.md'));
});
test('a short reference requires the complete canonical contract and exact local anchor',async t=>{
  const f=await fixture(t,{'skills/new/SKILL.md':reference});
  assert.equal((await checkRetryPolicy(f.directory)).passed,true);
  for(const target of ['../arkiv-query/SKILL.md#reconcile-before-another-submission','../arkiv-write-safety/SKILL.md#other','https://example.invalid/policy']) {
    await f.put('skills/new/SKILL.md',reference.replace('../arkiv-write-safety/SKILL.md#reconcile-before-another-submission',target));
    assert.equal((await checkRetryPolicy(f.directory)).passed,false);
  }
});
const weakPermissions=[
 'Permit at most one corrected retry only after an authoritative reverted receipt; consuming the full gas cap supports raising the approved cap.',
 'Check successful receipts; retry at most once only after a confirmed revert and corrected cause.',
 'Retry the transaction after fixing the cause.',
 'Resubmit the transaction after a reverted receipt.',
 'Send the write again after a failure.',
 'You may resend once after any revert.',
 'Do not forget to retry after SDK success.',
 'No automatic retry. Retry once manually after any revert.',
 'Retry the\ntransaction after fixing the cause.',
 'Allow at most one retry per operation, after any revert. '+retryContract,
 '```javascript\nretryWrite();\n```',
];
for(const [index,text] of weakPermissions.entries())test('new retry/resend/resubmit/again permission fails closed: '+index,async t=>{
  const file=index%3===0?'new/SKILL.md':index%3===1?'new/references/nested/recovery.md':'new/AGENTS.md';
  const f=await fixture(t,{[file]:text});const result=await checkRetryPolicy(f.directory);
  assert.equal(result.passed,false);assert.ok(result.failures.some(x=>x.file===file));
});
test('a valid contract or reference cannot hide a weaker sentence appended in the same paragraph',async t=>{
  for(const text of [retryContract+' Retry after any revert.',reference+' You may resend after an uncertain submission.']) {
    const f=await fixture(t,{'skills/new/SKILL.md':text});
    assert.equal((await checkRetryPolicy(f.directory)).passed,false);
  }
});
const conditions=['at most one retry per operation','only after an authoritative reverted receipt','gasUsed === gasLimit','the SDK did not report success','fresh unsigned estimate at `latest`','operation floor','2 × estimate','at least double the previous gas cap','gas <= latestBlock.gasLimit / 2','fresh nonce','current network gasPrice','exclusive signer custody','approved balance/spend','Never resend after SDK success or an uncertain submission','Non-gas reverts are terminal'];
for(const condition of conditions)test('removing contract condition is rejected: '+condition,async t=>{
  const f=await fixture(t,{'skills/new/SKILL.md':reference});
  const changed=retryContract.replace(condition,'omitted condition');assert.notEqual(changed,retryContract);
  await f.put('skills/arkiv-write-safety/SKILL.md','## Reconcile before another submission\n\n'+changed);
  const result=await checkRetryPolicy(f.directory);assert.equal(result.passed,false);
  assert.ok(result.failures.some(x=>x.classification==='unsafe-canonical-contract'));
  assert.ok(result.failures.some(x=>x.file==='skills/new/SKILL.md'));
});
test('CLI rejects a newly introduced guide outside the old catalog',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.directory,'scripts'));
  await fs.copyFile(path.join(root,'scripts/check-retry-policy.mjs'),path.join(f.directory,'scripts/check-retry-policy.mjs'));
  const cli=()=>spawnSync(process.execPath,['scripts/check-retry-policy.mjs'],{cwd:f.directory,encoding:'utf8'});
  assert.equal(cli().status,0);
  await f.put('new/SKILL.md','Resubmit once after fixing the cause.');
  const result=cli();assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).failures[0].file,'new/SKILL.md');
});
