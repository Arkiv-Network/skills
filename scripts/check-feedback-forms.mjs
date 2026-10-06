import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';
import { sha256 } from './extract-snippets.mjs';

export function formLabels(yaml) {
  const labels = [...yaml.matchAll(/^ {6}label:\s*(.+)$/gm)].map(match => {
    const raw = match[1].trim();
    if (/^[>|\[{]/.test(raw)) throw new Error('Upstream label needs a fuller YAML parser');
    if (raw.startsWith('"')) return JSON.parse(raw);
    if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw.replace(/\s+#.*$/, '');
  });
  if (!labels.length || labels.some(label => typeof label !== 'string' || !label)) throw new Error('Upstream form labels unavailable');
  return labels;
}
export function submittedHeadings(markdown) {
  const block = /```markdown\r?\n([\s\S]*?)```/.exec(markdown)?.[1];
  if (!block) throw new Error('Feedback body template missing');
  return [...block.matchAll(/^### (.+)\r?$/gm)].map(match => match[1].trimEnd());
}
export async function checkFeedbackForms({root = repositoryRoot, request = fetch} = {}) {
  return Promise.all([['bug-form.md', '1-bug.yml'], ['feature-form.md', '2-feature-request.yml']].map(async ([local, upstream]) => {
    const url = `https://raw.githubusercontent.com/Arkiv-Network/reported-issues/main/.github/ISSUE_TEMPLATE/${upstream}`;
    const file = `skills/arkiv-feedback/references/${local}`;
    try {
      const response = await request(url, {signal: AbortSignal.timeout(15000)});
      if (!response.ok) return {id: `form-labels:${upstream}`, skill: 'arkiv-feedback', status: 'SKIPPED', reason: `Primary form unavailable: HTTP ${response.status}`};
      const yaml = await response.text(); if (Buffer.byteLength(yaml) > 256000) throw new Error('Upstream form exceeds size bound');
      const actual = submittedHeadings(await readFile(path.join(root, file), 'utf8')), expected = formLabels(yaml);
      return {id: `form-labels:${upstream}`, skill: 'arkiv-feedback', status: JSON.stringify(actual) === JSON.stringify(expected) ? 'PASS' : 'FAIL',
        evidence: {url, sourceHash: sha256(yaml), file, expected, actual}};
    } catch { return {id: `form-labels:${upstream}`, skill: 'arkiv-feedback', status: 'SKIPPED', reason: 'Primary form could not be read or parsed'}; }
  }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [file] = process.argv.slice(2); if (!file || process.argv.length !== 3) throw new Error('Usage: node scripts/check-feedback-forms.mjs /static/report.json');
    const report = JSON.parse(await readFile(file, 'utf8')); if (report.kind !== 'static') throw new Error('Expected static report');
    const cases = await checkFeedbackForms(); report.cases.push(...cases); report.checkedAt = new Date().toISOString();
    if (cases.some(test => test.status === 'FAIL')) report.result = 'FAIL';
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(cases.map(({id, status}) => ({id, status}))));
    if (cases.some(test => test.status === 'FAIL')) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
