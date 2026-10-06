import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { frontmatter } from './check-static.mjs';
import { readSnippets, sha256 } from './extract-snippets.mjs';

const kinds = ['static', 'typecheck', 'runtime', 'live', 'sources', 'mcp', 'evals'];
const states = ['PASS', 'FAIL', 'SKIPPED'];
export const catalogHash = files => sha256(JSON.stringify(files.map(({file, sha256}) => ({file, sha256}))
  .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0)));
export function nightlyObservation(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.ARKIV_HEALTH_WORKFLOW !== 'nightly') return null;
  if (!['schedule', 'workflow_dispatch', 'repository_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '') ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !/^refs\/heads\/.+/.test(env.GITHUB_REF ?? '') ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) return null;
  return {workflow: 'nightly', repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, commit: env.GITHUB_SHA,
    url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`};
}
export function validateReport(report) {
  if (report?.version !== 1 || !kinds.includes(report.kind) || !states.includes(report.result) ||
      !Number.isFinite(Date.parse(report.checkedAt)) || !/^\d+\.\d+\.\d+$/.test(report.sdk) ||
      typeof report.chain?.name !== 'string' || !(report.chain.id === null || Number.isSafeInteger(report.chain.id) && report.chain.id > 0) ||
      !Array.isArray(report.cases) || report.cases.some(test => typeof test.id !== 'string' || !test.id.trim() || !states.includes(test.status) ||
        test.skills !== undefined && (!Array.isArray(test.skills) || test.skills.some(skill => typeof skill !== 'string'))) ||
      report.sourceFiles !== undefined && (!Array.isArray(report.sourceFiles) || report.sourceFiles.some(file => typeof file.file !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)))) throw new Error('Invalid verification report');
  if (report.result === 'SKIPPED' && !report.reason?.trim()) throw new Error('Skipped report requires a reason');
  return report;
}

export function healthForSkill({skill, sdk, network, chainId, sourceHashes, reports, now = new Date(), maxAgeHours = 48}) {
  const failing = [], pending = [], checked = [];
  for (const kind of kinds) {
    const candidates = reports.filter(report => report.kind === kind).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
    const report = candidates[0];
    if (!report) { pending.push(`${kind}: evidence missing`); continue; }
    try { validateReport(report); } catch { pending.push(`${kind}: invalid evidence`); continue; }
    const age = now.getTime() - Date.parse(report.checkedAt);
    if (age < -300000 || age > maxAgeHours * 3600000) { pending.push(`${kind}: evidence stale or future-dated`); continue; }
    if (report.sdk !== sdk) { pending.push(`${kind}: SDK ${report.sdk} differs from verified ${sdk}`); continue; }
    if (report.result === 'SKIPPED' || report.operational || report.httpStatus === 429) { pending.push(`${kind}: ${report.reason || 'operational check unavailable'}`); continue; }
    if (kind === 'live' && report.executionMode !== 'live_rpc') { pending.push('live: verified live RPC execution evidence missing'); continue; }
    if (kind === 'mcp' && report.executionMode !== 'mcp_readonly') { pending.push('mcp: verified readonly gateway evidence missing'); continue; }
    if (['live', 'mcp'].includes(kind) && (report.chain.id !== chainId || report.chain.name !== network)) { pending.push(`${kind}: ${network} evidence missing`); continue; }
    if (kind === 'mcp' && report.result === 'FAIL' && report.cases.some(test => test.id === 'gateway-protocol' &&
        test.status === 'FAIL' && test.evidence?.scope === 'transport_protocol' && (test.skill === skill || test.skills?.includes(skill)))) {
      failing.push('mcp:gateway-protocol'); pending.push('mcp: published bytes could not be verified after protocol failure');
      checked.push(report.checkedAt); continue;
    }
    const recorded = new Map((report.sourceFiles ?? []).map(file => [file.file, file.sha256]));
    if (Object.entries(sourceHashes).some(([file, hash]) => recorded.get(file) !== hash)) { pending.push(`${kind}: current skill sources are not verified`); continue; }
    const tests = report.cases.filter(test => test.skill === skill || test.skills?.includes(skill));
    if (!tests.length) { pending.push(`${kind}: no cases for this skill`); continue; }
    const failed = tests.filter(test => test.status === 'FAIL');
    if (failed.length) failing.push(...failed.map(test => `${kind}:${test.id}`));
    if (tests.some(test => test.status === 'SKIPPED') || report.skipped?.some(test => test.id?.includes(`/${skill}/`))) pending.push(`${kind}: cases skipped`);
    if (kind === 'runtime' && report.moduleOnly?.some(id => id.includes(`/${skill}/`))) pending.push('runtime: outcome coverage missing');
    if (kind === 'sources' && report.changedSkills?.includes(skill)) pending.push('sources: cited source or package changed; re-verification required');
    if (report.result === 'FAIL' && !failed.length) pending.push(`${kind}: suite failed outside this skill`);
    checked.push(report.checkedAt);
  }
  return {status: failing.length ? 'red' : pending.length ? 'yellow' : 'green', sdkVerified: sdk, network,
    checkedAt: checked.length ? checked.sort()[0] : null, failing, pending};
}

export async function buildHealth({root = repositoryRoot, reports = [], now = new Date(), maxAgeHours = 48, observation = null} = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const {files} = await readSnippets(root);
  const skills = {};
  for (const source of files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file))) {
    const metadata = frontmatter(await readFile(path.join(root, source.file), 'utf8'));
    const skillFiles = files.filter(file => file.file.startsWith(`skills/${metadata.name}/`));
    const sourceHashes = Object.fromEntries(skillFiles.map(file => [file.file, file.sha256]));
    skills[metadata.name] = metadata.metadata.deprecated === 'true'
      ? {status: 'yellow', sdkVerified: config.sdkVersion, network: config.network, checkedAt: null, failing: [], pending: ['Deprecated entrypoint; use arkiv']}
      : healthForSkill({skill: metadata.name, sdk: config.sdkVersion, network: config.network, chainId: config.chainId, sourceHashes, reports, now, maxAgeHours});
  }
  return {version: 1, generatedAt: now.toISOString(), maxAgeHours, defaultNetwork: config.network, sdkVerified: config.sdkVersion,
    catalogHash: catalogHash(files), sourceCommit: observation?.commit ?? null, observation,
    reports: reports.map(report => ({kind: report.kind, checkedAt: report.checkedAt, result: report.result, sha256: sha256(JSON.stringify(report))})), skills};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [output, ...inputs] = process.argv.slice(2);
    if (!output) throw new Error('Usage: node scripts/build-health.mjs /output/status.json [report.json ...]');
    const reports = await Promise.all(inputs.map(async file => JSON.parse(await readFile(file, 'utf8'))));
    const status = await buildHealth({reports, observation: nightlyObservation()});
    await writeFile(output, JSON.stringify(status, null, 2) + '\n');
    console.log(JSON.stringify({output, skills: Object.keys(status.skills).length, counts: Object.values(status.skills).reduce((counts, skill) => ({...counts, [skill.status]: (counts[skill.status] ?? 0) + 1}), {})}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
