import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './build-plugin.mjs';

export async function checkEvals(root = repositoryRoot) {
  const catalog = JSON.parse(await readFile(path.join(root,'evals/catalog.json'),'utf8'));
  assert.equal(catalog.schemaVersion,1);
  const skills = (await readdir(path.join(root,'skills'),{withFileTypes:true})).filter(item=>item.isDirectory()).map(item=>item.name);
  const ids = new Set();
  for (const entry of catalog.cases) {
    assert.match(entry.id,/^[a-z0-9-]+$/); assert.ok(!ids.has(entry.id),'Duplicate eval ID'); ids.add(entry.id);
    const directory = path.join(root,'evals',entry.id);
    const prompt = await readFile(path.join(directory,'prompt.md'),'utf8');
    const grader = await readFile(path.join(directory,'graders/criteria.md'),'utf8');
    assert.match(prompt,/^---\r?\n/); assert.match(prompt,/allowed_tools: \[Read, Glob, Grep, Skill\]/);
    assert.match(prompt,/timeout_seconds: (120|180)/); assert.ok(!/TODO|REPLACE_ME/.test(prompt+grader));
    assert.match(grader,/type: llm/); assert.match(grader,/weight: 1/);
    const metadata = JSON.parse(await readFile(path.join(directory,'sources.json'),'utf8'));
    assert.deepEqual(metadata.sources,entry.sources,'Eval provenance differs from catalog');
    for (const source of entry.sources) {
      assert.match(source,/^skills\/[a-z0-9-]+\/(SKILL\.md|references\/[a-z0-9-]+\.md)$/);
      assert.ok((await stat(path.join(root,source))).isFile(),'Missing eval source');
    }
  }
  for (const skill of skills) for (const category of ['trigger','negative','outcome']) {
    assert.ok(catalog.cases.some(entry=>entry.skill===skill&&entry.category===category),`Missing ${skill} ${category} case`);
  }
  for (const id of ['multi-encrypted-expiring','adversarial-untrusted-payload','adversarial-rpc-url','adversarial-key-custody','version-mismatch']) assert.ok(ids.has(id),`Missing ${id}`);
  return {result:'PASS',cases:catalog.cases.length,skills:skills.length,execution:'Authored case coverage only; model outcomes require native eval results.'};
}
if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await checkEvals()));} catch(error) {console.error(error.message);process.exitCode=1;}
}
