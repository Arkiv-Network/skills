import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { checkStatic } from './check-static.mjs';
import { readSnippets } from './extract-snippets.mjs';
import { checkSnippets } from './check-snippets.mjs';
import { runFixtures } from './run-snippet-fixtures.mjs';
import { buildHealth } from './build-health.mjs';

export async function runLocalChecks({root = repositoryRoot, workspace = path.join(root, 'tests/snippets'), output = path.join(root, 'tests/snippets/results')} = {}) {
  await mkdir(output, {recursive: true});
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const {files} = await readSnippets(root); const checked = await checkStatic(root);
  const staticReport = {version: 1, checkedAt: new Date().toISOString(), sdk: config.sdkVersion, chain: {name: 'synthetic', id: null},
    kind: 'static', result: checked.passed ? 'PASS' : 'FAIL', sourceFiles: files, failures: checked.failures,
    cases: files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file)).map(({file}) => {
      const skill = file.split('/')[1]; return {id: 'metadata-content-links-and-generated-files', skill,
        status: checked.failures.some(failure => failure.file?.startsWith(`skills/${skill}/`)) ? 'FAIL' : checked.passed ? 'PASS' : 'SKIPPED'};
    })};
  const reports = [staticReport]; await writeFile(path.join(output, 'static.json'), JSON.stringify(staticReport, null, 2) + '\n');
  for (const [kind, action] of [['typecheck', checkSnippets], ['runtime', runFixtures]]) {
    try { reports.push(await action({root, workspace})); }
    catch { reports.push({version: 1, checkedAt: new Date().toISOString(), sdk: config.sdkVersion, chain: {name: 'synthetic', id: null}, kind, result: 'SKIPPED', reason: 'Verifier could not run; inspect the local dependency/workspace setup', sourceFiles: files, cases: []}); }
    await writeFile(path.join(output, `${kind}.json`), JSON.stringify(reports.at(-1), null, 2) + '\n');
  }
  await writeFile(path.join(output, 'status.json'), JSON.stringify(await buildHealth({root, reports}), null, 2) + '\n');
  return {result: reports.every(report => report.result === 'PASS') ? 'PASS' : 'FAIL', reports: reports.map(report => ({kind: report.kind, result: report.result})), output};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!['--workspace', '--output'].includes(args[index]) || !args[index + 1] || !path.isAbsolute(args[index + 1])) throw new Error('Usage: node scripts/run-local-checks.mjs [--workspace /absolute/path] [--output /absolute/path]');
      options[args[index].slice(2)] = args[index + 1];
    }
    const result = await runLocalChecks(options); console.log(JSON.stringify(result)); if (result.result !== 'PASS') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
