// Compile every published TypeScript fence as its own module against the installed SDK.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const workspace = path.resolve(process.env.ARKIV_SNIPPET_WORKSPACE ?? '.checks');
const sdk = JSON.parse(await fs.readFile(path.join(workspace, 'node_modules/@arkiv-network/sdk/package.json'), 'utf8'));
assert.equal(sdk.version, '1.0.0');
const generated = path.join(workspace, 'fences');
await fs.mkdir(generated, { recursive: true });
await fs.writeFile(path.join(workspace, 'package.json'), '{"type":"module"}\n');
const rows = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.name.endsWith('.md')) {
      const text = await fs.readFile(file, 'utf8');
      for (const [index, fence] of [...text.matchAll(/```(typescript|javascript)\r?\n([\s\S]*?)\r?\n```/g)].entries()) {
        const name = path.relative(process.cwd(), file).replaceAll(path.sep, '/');
        const output = path.join(generated, name.replaceAll('/', '__') + '-' + index + (fence[1] === 'typescript' ? '.ts' : '.mjs'));
        await fs.writeFile(output, fence[2]);
        rows.push({ source: name, line: text.slice(0, fence.index).split('\n').length,
          language: fence[1], path: output, sha256: createHash('sha256').update(fence[2]).digest('hex') });
      }
    }
  }
}
await walk('skills');
const contractOutput = path.join(generated, 'sdk-type-contract.ts');
await fs.copyFile('tests/type-contract.ts', contractOutput);
const sources = rows.filter(row => row.language === 'typescript').map(row => row.path);
sources.push(contractOutput);
const compiler = path.join(workspace, 'node_modules/typescript/bin/tsc');
const compile = spawnSync(process.execPath, [compiler, '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck',
  '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2023,DOM',
  '--types', 'node', '--typeRoots', path.join(workspace, 'node_modules/@types'), ...sources], { encoding: 'utf8' });
process.stdout.write(compile.stdout ?? ''); process.stderr.write(compile.stderr ?? '');
if (compile.status !== 0) process.exit(compile.status ?? 1);
for (const row of rows.filter(row => row.language === 'javascript')) {
  const result = spawnSync(process.execPath, ['--check', row.path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
await fs.writeFile(path.join(workspace, 'snippet-manifest.json'), JSON.stringify({ sdk: sdk.version, rows }, null, 2));
console.log(JSON.stringify({ sdk: sdk.version, typecheckedFences: sources.length - 1,
  typeContractChecked: true, javascriptChecked: rows.filter(row => row.language === 'javascript').length }));
