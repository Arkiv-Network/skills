import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const expectedRepository = 'SantiagoDevRel/skills';
const branch = 'arkiv-status';
const markerPath = '.arkiv-health-owner.json';
export function validateStatus(status) {
  if (status?.version !== 1 || !Number.isFinite(Date.parse(status.generatedAt)) || !status.skills || !Object.keys(status.skills).length ||
    Object.values(status.skills).some(skill => !['green', 'yellow', 'red'].includes(skill.status) || !Array.isArray(skill.failing) || !Array.isArray(skill.pending))) throw new Error('Invalid status artifact');
  const text = JSON.stringify(status);
  if (/PRIVATE.KEY|-----BEGIN|gh[pousr]_[A-Za-z0-9]{20,}|(?:password|token|secret)\s*["']?\s*:/i.test(text)) throw new Error('Sensitive field in status artifact');
  return status;
}
export async function publishHealth({status, repository, token, event, ref, request = fetch}) {
  validateStatus(status);
  if (repository !== expectedRepository || !token || !['schedule', 'workflow_dispatch'].includes(event)) throw new Error('Status publication is limited to the reviewed fork and trusted events');
  const call = async (route, method = 'GET', body) => {
    const response = await request(`https://api.github.com/repos/${repository}/${route}`, {method,
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28'},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15000)});
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw new Error(`GitHub status publication failed: HTTP ${response.status}`);
    return response.json();
  };
  const repo = await call('');
  if (!repo?.fork || repo.full_name !== expectedRepository || ref !== `refs/heads/${repo.default_branch}`) throw new Error('Publication requires this fork default branch');
  let statusBranch = await call(`git/ref/heads/${branch}`);
  const ownership = {version: 1, generator: 'arkiv-skills-ci', repository};
  if (!statusBranch) {
    const base = await call(`git/ref/heads/${repo.default_branch}`);
    await call('git/refs', 'POST', {ref: `refs/heads/${branch}`, sha: base.object.sha});
    await call(`contents/${markerPath}`, 'PUT', {message: 'Initialize owned Arkiv health branch', branch, content: Buffer.from(JSON.stringify(ownership, null, 2) + '\n').toString('base64')});
    statusBranch = true;
  } else {
    const marker = await call(`contents/${markerPath}?ref=${branch}`);
    let current;
    try { current = JSON.parse(Buffer.from(marker?.content ?? '', 'base64').toString('utf8')); } catch { current = null; }
    if (current?.generator !== ownership.generator || current.repository !== repository || current.version !== 1) throw new Error('Existing branch has no matching ownership marker; preserve it');
  }
  const file = await call(`contents/status.json?ref=${branch}`);
  const content = JSON.stringify(status, null, 2) + '\n';
  if (file?.content && Buffer.from(file.content, 'base64').toString('utf8') === content) return {changed: false, repository, branch};
  await call('contents/status.json', 'PUT', {message: 'Update verified Arkiv health evidence', branch, content: Buffer.from(content).toString('base64'), ...(file?.sha ? {sha: file.sha} : {})});
  return {changed: true, repository, branch, url: `https://raw.githubusercontent.com/${repository}/${branch}/status.json`};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [file, flag] = process.argv.slice(2);
    if (!file || flag !== '--publish' || process.argv.length !== 4 || process.env.ARKIV_PUBLISH_STATUS !== 'true') throw new Error('Publication needs --publish and ARKIV_PUBLISH_STATUS=true');
    const result = await publishHealth({status: JSON.parse(await readFile(file, 'utf8')), repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF});
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
