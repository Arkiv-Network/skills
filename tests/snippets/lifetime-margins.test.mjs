import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {checkLifetimeMargins,inspectLifetimeMargins} from '../../scripts/check-lifetime-margins.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
test('current guidance scopes maximum-lifetime margin/subtraction to SDK 1.0.0',async()=>{
 const result=await checkLifetimeMargins(root);console.log(JSON.stringify({lifetimeMarginInventory:result}));assert.equal(result.passed,true,JSON.stringify(result.failures));
});
for(const text of [
 'Read a published maxLifetime parameter when available, otherwise use the dated measured 7,884,000-block bound and an inclusion margin.',
 'Use the maximum lifetime minus a margin.',
 'Subtract 30 blocks from MAX_LIFETIME.',
 'Choose a below-maximum lifetime of fromBlocks(7_883_970).',
 'SDK 1.0.0 is installed elsewhere. Subtract 30 blocks from MAX_LIFETIME.',
 'MAX_LIFETIME needs no manual subtraction; use an inclusion margin.',
 '```typescript\nconst cap = MAX_LIFETIME - 30n;\n```',
])test('unscoped lifetime-margin mutation is rejected: '+text,()=>assert.notDeepEqual(inspectLifetimeMargins(text),[]));
test('versioned legacy advice and no-margin max() guidance are accepted',()=>{
 for(const text of [
  'For SDK 1.0.0, use the measured lifetime bound with an inclusion margin.',
  'The conservative maximum-lifetime margin fallback applies only to 1.0.0.',
  'For SDK 1.0.1+, use ExpirationTime.max() without manual subtraction.',
  '`max()` needs no manually subtracted inclusion margin.',
  'These absolute-deadline examples retain the conservative SDK 1.0.0 compatibility margin.\n\n```typescript\nconst cap = MAX_LIFETIME - 30n;\n```',
  'Compare the gas estimate plus fee margin with the approved budget.',
  'For parent/child ordering, check remaining-life margin before submission.',
 ])assert.deepEqual(inspectLifetimeMargins(text),[],text);
});
test('newly discovered reference and CLI reject a maximum-lifetime subtraction',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'arkiv-lifetime-margin-'));
 t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('arkiv-lifetime-margin-'));await fs.rm(directory,{recursive:true});});
 const file=path.join(directory,'skills/new/references/lifetime.md');await fs.mkdir(path.dirname(file),{recursive:true});
 const invoke=()=>spawnSync(process.execPath,[path.join(root,'scripts/check-lifetime-margins.mjs'),directory],{encoding:'utf8'});
 await fs.writeFile(file,'For SDK 1.0.0, subtract 30 blocks from MAX_LIFETIME.');assert.equal(invoke().status,0);
 await fs.writeFile(file,'Subtract 30 blocks from MAX_LIFETIME.');assert.equal(invoke().status,1);
 assert.equal((await checkLifetimeMargins(directory)).passed,false);
});

test('maximum-lifetime heading context reaches nested advice and scoped legacy headings',()=>{
 assert.notDeepEqual(inspectLifetimeMargins('# Maximum lifetime\n\n## Renewal\n\nSubtract 30 blocks.'),[]);
 assert.deepEqual(inspectLifetimeMargins('# Maximum lifetime\n\n## Renewal\n\nUse ExpirationTime.max() without manual subtraction.'),[]);
 assert.deepEqual(inspectLifetimeMargins('# Maximum lifetime: SDK 1.0.0\n\n## Renewal\n\nSubtract 30 blocks.'),[]);
});
test('an unrelated or newer-version clause cannot borrow the legacy scope',()=>{
 for(const text of [
  'SDK 1.0.0 is installed elsewhere; subtract 30 blocks from MAX_LIFETIME.',
  'For SDK 1.0.0, use a margin; but SDK 1.0.1 requires an inclusion margin.',
  '# Maximum lifetime: SDK 1.0.0\n\n## SDK 1.0.1\n\nSubtract 30 blocks.',
 ])assert.notDeepEqual(inspectLifetimeMargins(text),[],text);
});
test('a sibling fee section ends the maximum-lifetime context',()=>{
 assert.deepEqual(inspectLifetimeMargins('# Maximum lifetime\n\nUse ExpirationTime.max() without manual subtraction.\n\n# Fees\n\nKeep a fee margin.'),[]);
});
