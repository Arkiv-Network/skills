// Upgrade only the SDK; reuse the contributor's existing viem/TypeScript installations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const [viemWorkspace, typescriptWorkspace, nodeTypesWorkspace] = process.argv.slice(2);
assert.ok(viemWorkspace && typescriptWorkspace && nodeTypesWorkspace,
  'Pass existing workspaces containing viem, typescript and @types/node; no peers are installed');
const root = path.resolve('.checks');
await fs.mkdir(path.join(root, 'node_modules/@arkiv-network/sdk'), { recursive: true });
await fs.mkdir(path.join(root, 'node_modules/@types'), { recursive: true });
for (const [name, workspace] of [['viem', viemWorkspace], ['typescript', typescriptWorkspace], ['@types/node', nodeTypesWorkspace]]) {
  const source = path.join(workspace, 'node_modules', name);
  const destination = path.join(root, 'node_modules', name);
  await fs.access(path.join(source, 'package.json'));
  try { await fs.symlink(source, destination, 'dir'); }
  catch (error) { if (error.code !== 'EEXIST' || await fs.realpath(destination) !== await fs.realpath(source)) throw error; }
}
const response = await fetch('https://registry.npmjs.org/@arkiv-network%2fsdk/1.0.0', { signal: AbortSignal.timeout(20000) });
assert.ok(response.ok);
const metadata = await response.json();
const tar = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(20000) });
assert.ok(tar.ok);
const bytes = Buffer.from(await tar.arrayBuffer());
assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), metadata.dist.integrity);
const archive = path.join(root, 'sdk-1.0.0.tgz');
await fs.writeFile(archive, bytes);
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', path.join(root, 'node_modules/@arkiv-network/sdk')]);
console.log(JSON.stringify({ sdk: metadata.version, integrity: metadata.dist.integrity, peers: 'reused', workspace: root }));
