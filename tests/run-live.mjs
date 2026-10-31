// Optional adapter for a contributor's existing secrets CLI. No credentials are read here.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const secretsCli = process.argv[2];
assert.ok(secretsCli && path.isAbsolute(secretsCli), 'Pass the existing secrets CLI path');
const state = path.resolve('.checks/seed-state');
const evidence = path.resolve('.checks/live-evidence');
await fs.mkdir(state, { recursive: true, mode: 0o700 });
await fs.mkdir(evidence, { recursive: true });
const result = spawnSync(process.execPath, [secretsCli, 'run',
  '--env', 'ARKIV_ACCESS_KEY_A=arkiv-rabdi.env:ARKIV_ACCESS_KEY_A',
  '--env', 'TEST_SKILLS_ADDRESS=arkiv-rabdi-test-wallets.env:TEST_SKILLS_ADDRESS',
  '--env', 'TEST_SKILLS_PRIVATE_KEY=arkiv-rabdi-test-wallets.env:TEST_SKILLS_PRIVATE_KEY',
  '--', process.execPath, '--experimental-vm-modules', '--test', '--test-concurrency=1', 'tests/live/lifetime.test.mjs', 'tests/live/live.test.mjs'],
  { stdio: 'inherit', env: { ...process.env, DEBUG: '', NODE_DEBUG: '', AGENT_SECRETS_DIR: path.join(os.homedir(), '.agent-secrets'),
    ARKIV_SNIPPET_WORKSPACE: path.resolve('.checks'), ARKIV_SEED_STATE_DIR: state, ARKIV_EVIDENCE_DIR: evidence } });
if ((await fs.readdir(state)).length) {
  const archive = path.resolve('.checks/seed-state-and-helper.tar.gz');
  const handle = await fs.open(archive, 'w', 0o600);
  await handle.close();
  await fs.chmod(archive, 0o600);
  const parts = ['seed-state'];
  try { await fs.access('.checks/runtime'); parts.push('runtime'); } catch {}
  const saved = spawnSync('tar', ['-czf', archive, '-C', path.resolve('.checks'), ...parts], { stdio: 'inherit' });
  assert.equal(saved.status, 0, 'Private recovery archive failed; retain the original state');
  const bytes = await fs.readFile(archive);
  await fs.writeFile(path.join(evidence, 'state-archive.json'), JSON.stringify({
    path: '.checks/seed-state-and-helper.tar.gz', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), mode: '0600',
    contains: 'Private synthetic signed-transaction journal and exact importer helper; no signing or access key values',
  }, null, 2));
}
process.exitCode = result.status ?? 1;
