import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const normalize = value => value.replace(/\r\n/g, '\n');
const start = '<!-- arkiv-install:start -->';
const end = '<!-- arkiv-install:end -->';

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid plugin configuration');
  const required = ['name', 'version', 'description', 'author', 'repository', 'license', 'mcpUrl', 'sdkVersion', 'sdkRange', 'network', 'networkLabel', 'chainId'];
  if (Object.keys(config).some(key => !required.includes(key)) || required.some(key => !(key in config))) throw new Error('Unexpected or missing plugin configuration field');
  if (!/^[a-z][a-z0-9-]*$/.test(config.name)) throw new Error('Invalid plugin name');
  for (const field of ['version', 'sdkVersion']) if (!/^\d+\.\d+\.\d+$/.test(config[field])) throw new Error(`Invalid ${field}`);
  for (const field of ['description', 'networkLabel']) if (typeof config[field] !== 'string' || !config[field].trim() || /[\r\n]/.test(config[field])) throw new Error(`Invalid ${field}`);
  if (!config.author || typeof config.author.name !== 'string' || !config.author.name.trim() || Object.keys(config.author).some(key => key !== 'name')) throw new Error('Invalid author');
  if (config.license !== 'MIT') throw new Error('Expected MIT license');
  if (!/^[a-z][a-z0-9-]*$/.test(config.network) || !Number.isSafeInteger(config.chainId) || config.chainId < 1) throw new Error('Invalid network');
  const range = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)$/.exec(config.sdkRange);
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (!range || compare(config.sdkVersion.split('.').map(Number), range.slice(1, 4).map(Number)) < 0 || compare(config.sdkVersion.split('.').map(Number), [...range.slice(4).map(Number), 0]) >= 0) throw new Error('sdkVersion must be inside sdkRange');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new Error('Expected a public GitHub repository URL');
  const url = new URL(config.mcpUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Expected an HTTPS MCP URL without credentials, query or fragment');
  return config;
}

export function renderRules(config, source) {
  const text = normalize(source).trim().replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key) => {
    if (!['sdkRange', 'networkLabel'].includes(key)) throw new Error(`Unknown rule placeholder: ${key}`);
    return config[key];
  }) + '\n';
  if (/\{\{|\}\}/.test(text) || text.trim().split('\n').length > 10 || !text.startsWith('## Arkiv rules for this project\n') || !text.trim().split('\n').at(-1).includes('arkiv router')) throw new Error('Expected at most ten project-rule lines ending with the router');
  return text;
}

export function installation(config) {
  const repo = config.repository.replace('https://github.com/', '');
  const selector = `${config.name}@${config.name}`;
  return [
    '### Full plugin', '',
    'The plugin bundles the skills, an MCP connection, and project guidance. It does not install the Arkiv SDK or fund a wallet. Use `arkiv-first-write` to set up the SDK and verify a first entity.', '',
    '**Claude Code**', '', '```bash',
    `claude plugin marketplace add ${repo}`,
    `claude plugin install ${selector}`, '```', '',
    'Restart the session. The SessionStart hook adds the rules when the project package.json declares @arkiv-network/sdk. Skills are namespaced: start with `arkiv:arkiv`.', '',
    '**Codex**', '', '```bash',
    `codex plugin marketplace add ${repo}`,
    `codex plugin add ${selector}`, '```', '',
    'Restart Codex and load `arkiv` for an Arkiv task. Review the plugin hooks before trusting them; installation alone does not enable untrusted hooks. Until then, ask your agent to append the [project rules](templates/AGENTS.snippet.md) to your project AGENTS.md while preserving its existing guidance.', '',
    '**Cursor**', '',
    `Copy this repository into a new folder at \`~/.cursor/plugins/local/${config.name}\`, then restart Cursor or run Developer: Reload Window. In Customize, confirm the skills, the MCP connection, and the Arkiv rule. The plugin supplies an always-apply rule. External symlinks are skipped; organization policy can block local imports.`, '',
    'A Cursor marketplace install requires a reviewed listing. See the [official local installation instructions](https://cursor.com/docs/plugins#test-plugins-locally).', '',
    '### Individual skills', '',
    'Use this route for skills without the plugin. Start with the router; replace its name to install another skill from the index above.', '',
    '```bash', '# npm', `npx skills add ${repo} --skill arkiv`, '', '# pnpm', `pnpm dlx skills add ${repo} --skill arkiv`, '```', '',
    'The default scope is the current project. Add `--global` for your user account. Check `npx skills --help` for host selection. Maintainers can use `--all` to install every skill into every supported agent without prompts; use the selected-skill route for a focused install.', '',
    '### MCP only', '',
    `Endpoint: [${config.mcpUrl}](${config.mcpUrl}). This connects source discovery and available profile tools; it does not install local skills or project rules. It never signs entity transactions. Optional feedback tools require consent before sharing data.`, '',
    '```bash', '# Claude Code: personal connection available across projects',
    `claude mcp add --transport http --scope user ${config.name} ${config.mcpUrl}`,
    '', '# Codex: personal connection', `codex mcp add ${config.name} --url ${config.mcpUrl}`, '```', '',
    'For Cursor, add this server through its MCP settings:', '', '```json',
    json({mcpServers: {[config.name]: {url: config.mcpUrl}}}).trimEnd(), '```', '',
    'When using the full plugin, use its bundled connection instead of adding a second copy. Host approval and authentication policies still apply.', '',
    '### Install prompt for other agents', '',
    'Paste this into your agent and review the proposed host configuration and project-rule edits:', '',
    '> Install the Arkiv skills from ' + config.repository + ', starting with arkiv. If I choose MCP tools, configure ' + config.mcpUrl + ' using this host\'s supported MCP format. Read templates/AGENTS.snippet.md from that repository and propose appending its Arkiv rules to my project AGENTS.md, preserving existing instructions. Ask before changing host settings or that file. Load the arkiv router for Arkiv tasks. Keep credentials out of source code, URLs and chat.', '',
    '### Verification and maintenance', '',
    `This release targets SDK ${config.sdkRange} and ${config.networkLabel} (chain ID ${config.chainId}). Skills declare their checked SDK range, network, and date. These declarations do not certify a completed funded test or current service health.`, '',
    'Installation files come from `plugin.config.json` and `source/always-on.md`. Regenerate them with `node scripts/build-plugin.mjs`; verify freshness with `node scripts/build-plugin.mjs --check` and content with `node scripts/check-static.mjs`.', '',
    'Host formats: [Claude Code](https://code.claude.com/docs/en/plugins-reference), [Codex](https://developers.openai.com/plugins/build/plugins), [Cursor](https://cursor.com/docs/reference/plugins).', '',
    'Licensed under [MIT](LICENSE).'
  ].join('\n') + '\n';
}

export function buildArtifacts(config, source) {
  validateConfig(config);
  const rules = renderRules(config, source);
  const identity = {name: config.name, version: config.version, description: config.description, author: config.author, repository: config.repository, license: config.license};
  const marketplace = {name: config.name, owner: config.author, plugins: [{name: config.name, source: './', description: config.description}]};
  return new Map([
    ['.claude-plugin/plugin.json', json({...identity, keywords: ['arkiv', 'web3 database']})],
    ['.claude-plugin/marketplace.json', json({...marketplace, description: config.description})],
    ['.agents/plugins/marketplace.json', json({name: config.name, interface: {displayName: 'Arkiv'}, plugins: [{name: config.name, source: {source: 'local', path: './'}, policy: {installation: 'AVAILABLE', authentication: 'ON_INSTALL'}, category: 'Developer Tools'}]})],
    ['plugin.json', json({$schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity, extensions: {'com.openai': {hooks: './hooks/hooks.json'}}})],
    ['mcp.json', json({$schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {[config.name]: {type: 'streamable-http', url: config.mcpUrl}}})],
    ['.mcp.json', json({mcpServers: {[config.name]: {type: 'http', url: config.mcpUrl}}})],
    ['.cursor-plugin/plugin.json', json({...identity, skills: './skills/', rules: './cursor/rules/', mcpServers: './mcp.json', hooks: {hooks: {}}})],
    ['.cursor-plugin/marketplace.json', json({...marketplace, metadata: {description: config.description}})],
    ['cursor/rules/arkiv.mdc', '---\ndescription: Arkiv project rules\nalwaysApply: true\n---\n' + rules],
    ['hooks/hooks.json', json({hooks: {SessionStart: [{matcher: 'startup|resume|clear|compact', hooks: [{type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/arkiv-rules.mjs"'}]}]}})],
    ['templates/AGENTS.snippet.md', rules]
  ]);
}

export async function generate(root = repositoryRoot, check = false) {
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const source = await readFile(path.join(root, 'source/always-on.md'), 'utf8');
  const artifacts = buildArtifacts(config, source);
  const readmeFile = path.join(root, 'README.md');
  const readme = normalize(await readFile(readmeFile, 'utf8'));
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || readme.indexOf(end) < readme.indexOf(start)) throw new Error('README installation markers are missing, duplicated or reversed');
  artifacts.set('README.md', readme.slice(0, readme.indexOf(start) + start.length) + '\n\n' + installation(config) + '\n' + readme.slice(readme.indexOf(end)));
  const stale = [];
  for (const [relative, expected] of artifacts) {
    const file = path.join(root, relative);
    let current;
    try { current = await readFile(file, 'utf8'); } catch(error) { if (error.code !== 'ENOENT') throw error; }
    if (current === expected) continue;
    stale.push(relative);
    if (!check) { await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, expected); }
  }
  if (check && stale.length) throw new Error(`Generated files are stale: ${stale.join(', ')}`);
  return {files: [...artifacts.keys()], changed: stale, checked: check};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-plugin.mjs [--check]');
    console.log(JSON.stringify(await generate(repositoryRoot, process.argv.includes('--check'))));
  } catch(error) { console.error(error.message); process.exitCode = 1; }
}
