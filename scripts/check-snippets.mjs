import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { extractSnippets, noSnippetCases } from './extract-snippets.mjs';

export async function installedPackage(workspace, name) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)) throw new Error('Invalid package name');
  let parentDirectory = path.resolve(workspace);
  for (;;) {
    const directory = path.join(parentDirectory, 'node_modules', name);
    try {
      const file = path.join(directory, 'package.json');
      const metadata = JSON.parse(await readFile(file, 'utf8'));
      if (metadata.name === name) return {directory, metadata};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(parentDirectory);
    if (parent === parentDirectory) throw new Error(`Cannot locate installed package metadata: ${name}`);
    parentDirectory = parent;
  }
}

export async function checkSnippets({root = repositoryRoot, workspace = path.join(root, 'tests/snippets')} = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(workspace, '.generated', stamp);
  const expected = JSON.parse(await readFile(path.join(root, 'tests/snippets/package.json'), 'utf8'));
  const versions = {};
  let compiler;
  for (const [name, version] of Object.entries({...expected.dependencies, ...expected.devDependencies})) {
    const installed = await installedPackage(workspace, name);
    versions[name] = installed.metadata.version;
    if (versions[name] !== version) throw new Error(`Expected ${name}@${version}; installed ${versions[name]}`);
    if (name === 'typescript') compiler = path.join(installed.directory, installed.metadata.bin.tsc);
  }
  const scaffolds = JSON.parse(await readFile(path.join(root, 'tests/snippets/scaffolds.json'), 'utf8'));
  const manifest = await extractSnippets({root, output, scaffolds});
  const configuration = {compilerOptions: {target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    skipLibCheck: true, noEmit: true, types: ['node'], lib: ['ES2022', 'DOM'], jsx: 'react-jsx'}, files: manifest.snippets.map(snippet => snippet.generatedFile)};
  await writeFile(path.join(output, 'tsconfig.json'), JSON.stringify(configuration, null, 2) + '\n', {flag: 'wx'});
  const checked = spawnSync(process.execPath, [compiler, '--project', path.join(output, 'tsconfig.json'), '--pretty', 'false'],
    {cwd: workspace, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
  const diagnostics = checked.stdout + checked.stderr;
  const failures = [];
  for (const line of diagnostics.split('\n').filter(Boolean)) {
    const match = /([^/\\]+\.(?:mts|tsx))\((\d+),(\d+)\): error TS(\d+): (.*)/.exec(line);
    const snippet = match && manifest.snippets.find(snippet => snippet.generatedFile === match[1]);
    failures.push(snippet ? {id: snippet.id, file: snippet.file, line: snippet.line + Number(match[2]) - snippet.prefixLines - 1,
      column: Number(match[3]), code: Number(match[4]), message: match[5]} : {message: line});
  }
  let head;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); } catch { head = null; }
  const report = {version: 1, checkedAt: new Date().toISOString(), head, sdk: versions['@arkiv-network/sdk'],
    chain: {name: 'synthetic', id: null}, result: checked.status === 0 && !checked.error ? 'PASS' : 'FAIL', kind: 'typecheck',
    versions, output, sourceFiles: manifest.sourceFiles, snippets: manifest.snippets, skipped: manifest.skipped, failures,
    cases: [...manifest.snippets.map(snippet => ({id: snippet.id, skill: snippet.file.split('/')[1], status: failures.some(failure => failure.id === snippet.id) ? 'FAIL' : checked.status === 0 ? 'PASS' : 'SKIPPED', evidence: {sourceHash: snippet.sha256}})),
      ...noSnippetCases(manifest.sourceFiles, [...manifest.snippets, ...manifest.skipped])],
    ...(checked.error ? {error: checked.error.message} : {})};
  await writeFile(path.join(output, 'typecheck.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return report;
}

export function parseWorkspaceArgs(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--workspace' && path.isAbsolute(args[1])) return {workspace: args[1]};
  throw new Error('Usage: node scripts/check-snippets.mjs [--workspace /absolute/dependency/workspace]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await checkSnippets(parseWorkspaceArgs(process.argv.slice(2)));
    console.log(JSON.stringify({result: report.result, sdk: report.sdk, checked: report.snippets.length, skipped: report.skipped, failures: report.failures, report: path.join(report.output, 'typecheck.json')}));
    if (report.result !== 'PASS') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
