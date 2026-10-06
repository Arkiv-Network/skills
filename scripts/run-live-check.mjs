import { readFile, writeFile, access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { readSnippets } from './extract-snippets.mjs';
import { validateReport } from './build-health.mjs';

export async function runLiveCheck({root = repositoryRoot, output, env = process.env, execute = spawnSync} = {}) {
  if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute report output path');
  await mkdir(path.dirname(output), {recursive: true});
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const {files} = await readSnippets(root); const runner = path.join(root, 'tests/live/e2e.mjs');
  let reason;
  if (env.ARKIV_ENABLE_LIVE !== 'true') reason = 'Funded testing was not opted in';
  else if (!/^0x[0-9a-fA-F]{64}$/.test(env.ARKIV_PRIVATE_KEY ?? '')) reason = 'A valid funded CI signer is not configured';
  else if (!/^[1-9]\d*$/.test(env.ARKIV_MAX_SPEND_WEI ?? '')) reason = 'Set an explicit positive funded-test budget';
  else if (!/^\d+$/.test(env.ARKIV_CHAIN_ID ?? '') || BigInt(env.ARKIV_CHAIN_ID) < 1n) reason = 'Verified chain ID is missing';
  else {
    try { const url = new URL(env.ARKIV_RPC_URL); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(); }
    catch { reason = 'Verified public HTTPS RPC URL is missing or contains credentials'; }
  }
  if (!reason) try { await access(runner); } catch { reason = 'The reviewed funded runner is not available yet'; }
  const skipped = reason => ({version: 1, checkedAt: new Date().toISOString(), sdk: config.sdkVersion, chain: {name: config.network, id: config.chainId},
    kind: 'live', result: 'SKIPPED', reason, sourceFiles: files, cases: []});
  let report;
  if (reason) report = skipped(reason);
  else {
    const relative = path.relative(root, path.dirname(output));
    const evidenceBase = relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ? path.dirname(output) : tmpdir();
    const freshDirectory = await mkdtemp(path.join(evidenceBase, 'arkiv-live-run-'));
    const freshOutput = path.join(freshDirectory, 'live.json');
    const result = execute(process.execPath, [runner], {cwd: root, env: {...env, ARKIV_HEALTH_OUTPUT: freshOutput}, stdio: 'ignore', timeout: 300000});
    try {
      report = validateReport(JSON.parse(await readFile(freshOutput, 'utf8')));
      if (report.kind !== 'live' || result.status !== 0 && report.result === 'PASS') throw new Error('Invalid live process/report outcome');
    }
    catch { report = skipped(result.error ? 'Funded runner deadline/process failed without valid evidence' : 'Funded runner did not return valid evidence'); }
  }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [output] = process.argv.slice(2); if (!output || process.argv.length !== 3) throw new Error('Usage: node scripts/run-live-check.mjs /absolute/output.json');
    const report = await runLiveCheck({output}); console.log(JSON.stringify({result: report.result, reason: report.reason}));
    if (report.result === 'FAIL' && !report.operational && report.httpStatus !== 429) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
