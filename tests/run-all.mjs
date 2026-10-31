// Run deterministic gates first; only then enter the separately authorized live smoke.
import { spawnSync } from 'node:child_process';
for (const argv of [['tests/run-checks.mjs'], ['tests/run-live.mjs', process.argv[2]]]) {
  const result = spawnSync(process.execPath, argv, { stdio: 'inherit', env: { ...process.env, DEBUG: '', NODE_DEBUG: '' } });
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
