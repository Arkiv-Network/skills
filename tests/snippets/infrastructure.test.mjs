import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fencedSnippets, withScaffold, noSnippetCases } from '../../scripts/extract-snippets.mjs';
import { healthForSkill, validateReport, catalogHash, nightlyObservation } from '../../scripts/build-health.mjs';
import { runLiveCheck } from '../../scripts/run-live-check.mjs';
import { semanticPage, namedExports, usedSdkExports } from '../../scripts/check-sources.mjs';
import { publishHealth } from '../../scripts/publish-health.mjs';
import { contentFindings, frontmatter } from '../../scripts/check-static.mjs';
import { formLabels, submittedHeadings } from '../../scripts/check-feedback-forms.mjs';

const contentMutations = [
  ['brand-vocabulary', 'TTL records API key on Ethereum'],
  ['unqualified-guarantee', 'Arkiv provides permanent storage.'],
  ['retired-source', 'Braga @dev llms.txt'],
  ['legacy-api', '```ts\nclient.updateEntity({});\n```'],
  ['timestamp-i32', '```ts\ni32(Date.now());\n```'],
  ['public-key-env', '```ts\nprocess.env.NEXT_PUBLIC_ARKIV_KEY;\n```'],
  ['array-rpc-url', '```ts\nhttp(tiramisu.rpcUrls.default.http);\n```'],
  ['untyped-system-filter', '```ts\nlte("expiresAt", u64(1n));\n```'],
  ['legacy-package', '```ts\nimport { x } from "arkiv-sdk";\n```'],
  ['legacy-sdk-install', '```bash\nnpm install @arkiv-network/sdk@0.7.0\n```'],
  ['creation-flags-input', '```ts\nclient.createEntity({creationFlags: true});\n```'],
  ['attribute-name', '```ts\nconst x={attributes:[{key:"entityType",value:"post"}]};\n```'],
  ['install-label', '```bash\n# pnpm\nbun add viem\n```'],
  ['credential-literal', 'PRIVATE_KEY = "0x' + 'a'.repeat(64) + '"'],
];
for (const [rule, mutation] of contentMutations) test(`static rule rejects its targeted mutation: ${rule}`, () => {
  assert.ok(contentFindings(mutation).some(finding => finding.rule === rule));
});
test('frontmatter rejects duplicated metadata headers and typed API identifiers remain valid', () => {
  assert.throws(() => frontmatter('---\nname: x\ndescription: x\nlicense: MIT\nmetadata:\n  network: x\nmetadata:\n  verified: 2026-10-05\n---\n'), /Duplicate/);
  assert.deepEqual(contentFindings('Do not promise permanent archive access.\n`ExpirationTime.permanent()`\n```ts\nstr("post"); reader.select({creationFlags: true});\n```'), []);
});

test('extractor handles both fence delimiters, source lines, skips and malformed fences', () => {
  const blocks = fencedSnippets('~~~ts\nconst x=1\n~~~\n```tsx\n// arkiv-snippet: skip — browser-only\n```\n', 'fixture.md');
  assert.equal(blocks.length, 2); assert.equal(blocks[0].line, 2); assert.equal(blocks[1].skipReason, 'browser-only');
  assert.throws(() => fencedSnippets('```typescript\nx\n', 'broken.md'), /Unclosed/);
  assert.equal(fencedSnippets('```json\n{}\n```\n', 'data.md').length, 0);
});
test('fragment scaffolds require a reason and exact source hash', () => {
  const [snippet] = fencedSnippets('```ts\nreturn 1\n```', 'fragment.md');
  assert.throws(() => withScaffold(snippet, {[snippet.id]: {reason: 'function body', sha256: 'old', prefix: '', suffix: ''}}), /matching/);
  const adapted = withScaffold(snippet, {[snippet.id]: {reason: 'function body', sha256: snippet.sha256, prefix: 'export function example(){', suffix: '}\n'}});
  assert.equal(adapted.prefixLines, 1); assert.ok(adapted.compiledSource.includes(snippet.source));
});
test('no-code coverage scans references and does not excuse skipped TypeScript', () => {
  const files = [{file: 'skills/arkiv/SKILL.md'}, {file: 'skills/arkiv-query/SKILL.md'}];
  const blocks = [{file: 'skills/arkiv-query/references/example.md', skipReason: 'requires a browser'}];
  assert.deepEqual(noSnippetCases(files, blocks).map(test => test.skill), ['arkiv']);
  assert.equal(noSnippetCases(files, blocks)[0].evidence.typescriptFenceCount, 0);
});
const now = new Date('2026-10-06T12:00:00Z');
const currentHash = 'a'.repeat(64);
const base = {skill: 'arkiv-query', sdk: '0.8.1', network: 'tiramisu', chainId: 7738577, sourceHashes: {'skills/arkiv-query/SKILL.md': currentHash}, now};
const report = kind => ({version: 1, kind, ...(kind === 'live' ? {executionMode: 'live_rpc'} : kind === 'mcp' ? {executionMode: 'mcp_readonly'} : {}), checkedAt: now.toISOString(), sdk: '0.8.1', chain: {name: 'tiramisu', id: 7738577}, result: 'PASS', sourceFiles: [{file: 'skills/arkiv-query/SKILL.md', sha256: currentHash}], cases: [{id: 'outcome', skill: 'arkiv-query', status: 'PASS'}]});
const reports = () => ['static', 'typecheck', 'runtime', 'live', 'sources', 'mcp', 'evals'].map(report);
test('health requires fresh complete evidence and missing/stale evidence is yellow', () => {
  assert.equal(healthForSkill({...base, reports: []}).status, 'yellow');
  assert.equal(healthForSkill({...base, reports: reports()}).status, 'green');
  const stale = reports(); stale[3].checkedAt = '2026-10-01T12:00:00Z'; assert.equal(healthForSkill({...base, reports: stale}).status, 'yellow');
});
test('observed current failure is red; a source change or operational 429 is yellow', () => {
  const failed = reports(); failed[2].result = 'FAIL'; failed[2].cases[0].status = 'FAIL'; assert.equal(healthForSkill({...base, reports: failed}).status, 'red');
  const changed = reports(); changed[4].changedSkills = [base.skill]; assert.equal(healthForSkill({...base, reports: changed}).status, 'yellow');
  const quota = reports(); Object.assign(quota[3], {result: 'FAIL', httpStatus: 429, reason: 'Anonymous provider quota exhausted'}); assert.equal(healthForSkill({...base, reports: quota}).status, 'yellow');
});
test('synthetic or legacy unclassified evidence cannot satisfy the live health layer', () => {
  for (const mode of [undefined, 'synthetic_transport']) {
    const altered = reports(); altered[3].executionMode = mode;
    assert.equal(healthForSkill({...base, reports: altered}).status, 'yellow');
    assert.equal(altered[3].kind, 'live'); // Preserve the original report; do not relabel historical evidence.
  }
  const synthetic = reports(); synthetic[3].kind = 'runtime'; synthetic[3].chain.name = 'synthetic';
  synthetic[3].executionMode = 'synthetic_transport';
  assert.equal(healthForSkill({...base, reports: synthetic}).status, 'yellow');
});

test('MCP health rejects synthetic/unclassified evidence and reports real protocol failure without fabricated catalog hashes', () => {
  const incomplete = reports(); incomplete[5].sourceFiles = [];
  incomplete[5].result = 'FAIL'; incomplete[5].cases = [{id: 'gateway-protocol', skills: [base.skill], status: 'FAIL', evidence: {scope: 'transport_protocol'}}];
  assert.equal(healthForSkill({...base, reports: incomplete}).status, 'red');
  assert.deepEqual(incomplete[5].sourceFiles, []);
  for (const mode of [undefined, 'synthetic_transport']) {
    const synthetic = structuredClone(incomplete); synthetic[5].executionMode = mode;
    assert.equal(healthForSkill({...base, reports: synthetic}).status, 'yellow');
  }
  const quota = structuredClone(incomplete); quota[5].httpStatus = 429;
  assert.equal(healthForSkill({...base, reports: quota}).status, 'yellow');
  const catalogMismatch = reports(); catalogMismatch[5].sourceFiles = [];
  assert.equal(healthForSkill({...base, reports: catalogMismatch}).status, 'yellow');
});
test('source/hash mismatch, wrong network and newer SDK cannot produce green', () => {
  for (const mutate of [r => r[3].chain.id = 7706815, r => r[1].sdk = '0.8.2', r => r[0].sourceFiles[0].sha256 = 'previous']) {
    const altered = reports(); mutate(altered); assert.equal(healthForSkill({...base, reports: altered}).status, 'yellow');
  }
  assert.throws(() => validateReport({...report('live'), result: 'SKIPPED'}), /reason/);
  for (const malformed of [r => r[0].sourceFiles = {}, r => r[1].cases[0].skills = 'arkiv-query']) {
    const altered = reports(); malformed(altered); assert.equal(healthForSkill({...base, reports: altered}).status, 'yellow');
  }
});
test('nightly provenance requires an actual Actions context and catalog hashes survive ordering', () => {
  const env = {GITHUB_ACTIONS: 'true', ARKIV_HEALTH_WORKFLOW: 'nightly', GITHUB_EVENT_NAME: 'schedule',
    GITHUB_REPOSITORY: 'SantiagoDevRel/skills', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1'};
  assert.equal(nightlyObservation({}), null);
  assert.equal(nightlyObservation({...env, GITHUB_EVENT_NAME: 'pull_request'}), null);
  assert.equal(nightlyObservation({...env, GITHUB_ACTIONS: 'false'}), null);
  assert.equal(nightlyObservation(env).url, 'https://github.com/SantiagoDevRel/skills/actions/runs/123');
  const files = [{file: 'skills/b/SKILL.md', sha256: 'b'}, {file: 'skills/a/SKILL.md', sha256: 'a'}];
  assert.equal(catalogHash(files), catalogHash([...files].reverse()));
  assert.notEqual(catalogHash(files), catalogHash([{...files[0], sha256: 'changed'}, files[1]]));
});
test('semantic source watch excludes navigation and script-only changes', () => {
  assert.equal(semanticPage('<header>old</header><main>API <script>old()</script> text</main>'), semanticPage('<header>new</header><main>API <script>new()</script> text</main>'));
  assert.notEqual(semanticPage('<main>API one</main>'), semanticPage('<main>API two</main>'));
});
test('export comparison uses public aliases and includes type-only SDK bindings', () => {
  const declarations = namedExports('export { internal as publicName, type Client }; export declare function create(): void;');
  assert.ok(declarations.has('publicName')); assert.ok(!declarations.has('internal')); assert.ok(declarations.has('Client')); assert.ok(declarations.has('create'));
  assert.deepEqual([...namedExports('export{internal as publicName};')], ['publicName']);
  assert.throws(() => namedExports('export * from "./other";'), /resolution/);
  const imports = usedSdkExports([{id: 'fixture', file: 'skills/arkiv-query/SKILL.md', source: 'import {type Client, create as build,} from "@arkiv-network/sdk";'}]);
  assert.deepEqual(imports.map(item => item.name), ['Client', 'create']); assert.ok(!namedExports('export { Client };').has('create'));
});
test('funded gate prevents execution without complete opt-in and rejects stale or invalid runner evidence', async context => {
  const directory = await mkdtemp(path.join(process.env.ARKIV_TEST_TMPDIR || tmpdir(), 'arkiv-live-gate-'));
  context.after(() => rm(directory, {recursive: true}));
  await mkdir(path.join(directory, 'skills/arkiv'), {recursive: true});
  await mkdir(path.join(directory, 'tests/live'), {recursive: true});
  await writeFile(path.join(directory, 'plugin.config.json'), JSON.stringify({sdkVersion: '0.8.1', network: 'tiramisu', chainId: 7738577}));
  await writeFile(path.join(directory, 'skills/arkiv/SKILL.md'), 'Router fixture without TypeScript.\n');
  await writeFile(path.join(directory, 'tests/live/e2e.mjs'), '// A runner path fixture; this file is never executed.\n');
  const env = {ARKIV_ENABLE_LIVE: 'true', ARKIV_PRIVATE_KEY: '0x' + '1'.repeat(64), ARKIV_RPC_URL: 'https://example.invalid',
    ARKIV_CHAIN_ID: '7738577', ARKIV_MAX_SPEND_WEI: '1'};
  let calls = 0;
  for (const change of [{ARKIV_ENABLE_LIVE: 'false'}, {ARKIV_PRIVATE_KEY: ''}, {ARKIV_MAX_SPEND_WEI: '0'},
    {ARKIV_CHAIN_ID: '0'}, {ARKIV_RPC_URL: 'https://example.invalid?credential=synthetic'}, {ARKIV_RPC_URL: 'http://example.invalid'}]) {
    const skipped = await runLiveCheck({root: directory, output: path.join(directory, 'gate.json'), env: {...env, ...change},
      execute: () => {calls++; throw new Error('Gate must prevent execution');}});
    assert.equal(skipped.result, 'SKIPPED');
  }
  assert.equal(calls, 0);
  const valid = {...report('live'), checkedAt: new Date().toISOString()};
  const staleOutput = path.join(directory, 'cached.json');
  await writeFile(staleOutput, JSON.stringify(valid));
  const stale = await runLiveCheck({root: directory, output: staleOutput, env, execute: () => ({status: 0})});
  assert.equal(stale.result, 'SKIPPED');
  for (const [name, exit, expected] of [['valid', 0, 'PASS'], ['process-failed', 1, 'SKIPPED']]) {
    const result = await runLiveCheck({root: directory, output: path.join(directory, name + '.json'), env,
      execute: (command, args, options) => {
        assert.equal(command, process.execPath); assert.equal(args[0], path.join(directory, 'tests/live/e2e.mjs'));
        assert.equal(options.stdio, 'ignore'); assert.equal(options.env.ARKIV_PRIVATE_KEY, env.ARKIV_PRIVATE_KEY);
        writeFileSync(options.env.ARKIV_HEALTH_OUTPUT, JSON.stringify(valid)); return {status: exit};
      }});
    assert.equal(result.result, expected);
  }
});
test('feedback form validation compares exact field labels and ignores dropdown options', () => {
  const yaml = 'body:\n  - type: dropdown\n    attributes:\n      label: Which DB-chain?\n      options:\n        - Legacy option\n';
  assert.deepEqual(formLabels(yaml), ['Which DB-chain?']);
  assert.deepEqual(submittedHeadings('```markdown\n### Which DB-chain?\nTiramisu\n```'), formLabels(yaml));
  assert.notDeepEqual(submittedHeadings('```markdown\n### Which chain?\nTiramisu\n```'), formLabels(yaml));
});
const statusArtifact = {version: 1, generatedAt: now.toISOString(), skills: {arkiv: {status: 'yellow', failing: [], pending: ['Evidence missing']}}};
test('publisher rejects upstream and PR contexts before making any request', async () => {
  let calls = 0;
  const request = () => {calls++; throw new Error('Should not reach remote');};
  for (const options of [{repository: 'Arkiv-Network/skills', event: 'schedule'}, {repository: 'SantiagoDevRel/skills', event: 'pull_request'}]) {
    await assert.rejects(publishHealth({status: statusArtifact, token: 'synthetic', ref: 'refs/heads/main', request, ...options}), /limited/);
  }
  assert.equal(calls, 0);
});
test('publisher preserves a preexisting branch without its ownership marker', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, method: options.method});
    if (url === 'https://api.github.com/repos/SantiagoDevRel/skills') return Response.json({fork: true, full_name: 'SantiagoDevRel/skills', default_branch: 'main'});
    if (url.includes('/git/ref/heads/')) return Response.json({object: {sha: 'existing'}});
    return new Response('', {status: 404});
  };
  await assert.rejects(publishHealth({status: statusArtifact, repository: 'SantiagoDevRel/skills', token: 'synthetic', event: 'schedule', ref: 'refs/heads/main', request}), /ownership/);
  assert.ok(calls.every(call => call.method === 'GET'));
});
test('publisher updates its own status using prior SHA and never force-updates a ref', async () => {
  const writes = [];
  const request = async (url, options) => {
    if (options.method !== 'GET') { writes.push({url, body: JSON.parse(options.body), method: options.method}); return Response.json({commit: {sha: 'new'}}); }
    if (url === 'https://api.github.com/repos/SantiagoDevRel/skills') return Response.json({fork: true, full_name: 'SantiagoDevRel/skills', default_branch: 'main'});
    if (url.includes('/git/ref/heads/')) return Response.json({object: {sha: 'existing'}});
    if (url.includes('.arkiv-health-owner.json')) return Response.json({content: Buffer.from(JSON.stringify({version: 1, generator: 'arkiv-skills-ci', repository: 'SantiagoDevRel/skills'})).toString('base64')});
    return Response.json({sha: 'previous', content: Buffer.from('{}').toString('base64')});
  };
  const result = await publishHealth({status: statusArtifact, repository: 'SantiagoDevRel/skills', token: 'synthetic', event: 'schedule', ref: 'refs/heads/main', request});
  assert.equal(result.changed, true); assert.equal(writes.length, 1); assert.equal(writes[0].body.sha, 'previous'); assert.equal(writes[0].method, 'PUT'); assert.ok(writes[0].url.endsWith('/contents/status.json'));
});
test('publisher verifies the canonical repository route before initializing an owned status branch', async () => {
  const calls = [], repositoryUrl = 'https://api.github.com/repos/SantiagoDevRel/skills';
  const request = async (url, options) => {
    calls.push({url, method: options.method, ...(options.body ? {body: JSON.parse(options.body)} : {})});
    if (url === repositoryUrl) return Response.json({fork: true, full_name: 'SantiagoDevRel/skills', default_branch: 'main'});
    if (url === repositoryUrl + '/') return new Response('', {status: 404});
    if (options.method !== 'GET') return Response.json({commit: {sha: 'new'}});
    if (url.endsWith('/git/ref/heads/main')) return Response.json({object: {sha: 'verified-base'}});
    return new Response('', {status: 404});
  };
  const result = await publishHealth({status: statusArtifact, repository: 'SantiagoDevRel/skills', token: 'synthetic', event: 'workflow_dispatch', ref: 'refs/heads/main', request});
  assert.equal(result.changed, true);
  assert.deepEqual(calls[0], {url: repositoryUrl, method: 'GET'});
  assert.equal(calls.some(call => call.url === repositoryUrl + '/'), false);
  const writes = calls.filter(call => call.method !== 'GET');
  assert.deepEqual(writes.map(call => call.method), ['POST', 'PUT', 'PUT']);
  assert.deepEqual(writes[0].body, {ref: 'refs/heads/arkiv-status', sha: 'verified-base'});
  assert.ok(writes[1].url.endsWith('/contents/.arkiv-health-owner.json'));
  assert.ok(writes[2].url.endsWith('/contents/status.json'));
});
