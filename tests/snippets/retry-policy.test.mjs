import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {test} from 'node:test';

// These are independently copyable guides which authorize a new transaction retry.
// Read-only RPC retries and retries of an idempotent HTTP operation are separate.
const guides = [
  'AGENTS.md',
  'skills/arkiv-write-safety/SKILL.md',
  'skills/arkiv-first-write/SKILL.md',
  'skills/arkiv-entity-lifecycle/SKILL.md',
  'skills/arkiv-entity-expiration/SKILL.md',
  'skills/arkiv-app-integration/references/browser-wallet.md',
  'skills/arkiv-data-modeling/references/relationships.md',
  'skills/arkiv-encryption/references/sdk-bytes.md',
  'skills/arkiv-troubleshooting/references/error-catalog.md',
];
for (const file of guides) test('A3 bounded gas-exhaustion-only retry policy in ' + file, async () => {
  const text = await fs.readFile(file, 'utf8');
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  const policy = paragraphs.find(p => /at most one retry per operation/.test(p));
  assert.ok(policy, 'A standalone guide needs the bounded retry policy');
  assert.match(policy, /only after an authoritative reverted receipt/);
  assert.match(policy, /gas exhaustion \(`gasUsed === gasLimit`\)/);
  assert.match(policy, /fresh unsigned estimate at `latest`/);
  assert.match(policy, /gas <= latestBlock\.gasLimit \/ 2/);
  assert.match(policy, /fresh nonce and current network gasPrice/);
  assert.match(policy, /Never resend after SDK success or an uncertain submission/);
  assert.doesNotMatch(text, /retry only under the remaining authorization|retry only after an authoritative reverted receipt, refreshing|after a confirmed reverted receipt and a corrected cause/);
});
