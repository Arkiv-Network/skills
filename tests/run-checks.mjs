import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const workspace = path.resolve(process.env.ARKIV_SNIPPET_WORKSPACE ?? '.checks');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'arkiv-skills-check-'));
const environment = { ...process.env, ARKIV_SNIPPET_WORKSPACE: workspace, ARKIV_IMPORT_TEST_SCRATCH: scratch };
const tests = (await fs.readdir('tests/snippets')).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/snippets/' + name);
async function syntax(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await syntax(file);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', file], { env: environment, stdio: 'inherit' });
      if (result.status !== 0) throw new Error('JavaScript syntax failed: ' + file);
    }
  }
}
try {
  for (const directory of ['skills', 'scripts', 'tests']) await syntax(directory);
  for (const argv of [['scripts/check-vocabulary.mjs'], ['scripts/check-skill-references.mjs'], ['tests/check-snippets.mjs'],
    ['--experimental-vm-modules', '--test', ...tests], ['tests/snippets/published-imports.mjs']]) {
    const result = spawnSync(process.execPath, argv, { env: environment, stdio: 'inherit' });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  // This runner owns exactly this newly created scratch directory.
  if (path.dirname(scratch) === os.tmpdir() && path.basename(scratch).startsWith('arkiv-skills-check-')) {
    await fs.rm(scratch, { recursive: true });
  }
}
