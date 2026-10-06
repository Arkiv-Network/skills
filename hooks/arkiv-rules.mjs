import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export async function rulesForProject(projectDir, root = pluginRoot) {
  if (typeof projectDir !== 'string' || !path.isAbsolute(projectDir)) return '';
  try {
    const bytes = await readFile(path.join(projectDir, 'package.json'));
    if (bytes.length > 262144) return '';
    const pkg = JSON.parse(bytes.toString('utf8'));
    if (!pkg || !dependencyFields.some(field => typeof pkg[field]?.['@arkiv-network/sdk'] === 'string')) return '';
    return await readFile(path.join(root, 'templates/AGENTS.snippet.md'), 'utf8');
  } catch { return ''; }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8');
    if (input.length > 16384) return;
  }
  let context = {};
  if (input.trim()) {
    try { context = JSON.parse(input); } catch { return; }
    if (!context || typeof context !== 'object' || Array.isArray(context)) return;
  }
  // cwd follows a worktree; Codex does not promise CLAUDE_PROJECT_DIR.
  const projectDir = context.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const rules = await rulesForProject(projectDir);
  if (rules) process.stdout.write(rules);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.exitCode = 0; });
}
