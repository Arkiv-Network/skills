import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkVocabulary} from '../../scripts/check-vocabulary.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const retired = ['pay', 'load'].join('');

test('all repository guidance, code and generated text use entity bytes vocabulary', async () => {
  const result = await checkVocabulary(root);
  assert.deepEqual(result.failures, []);
  assert.ok(result.files > 0);
});

test('vocabulary CLI rejects injected prose, code, generated data, snapshots and resource names', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'arkiv-vocabulary-'));
  try {
    const cases = [
      ['skills/example/SKILL.md', '# Entity bytes', `# Entity ${retired.toUpperCase()}`],
      ['scripts/seed.mjs', 'const entityBytes = [];', `const entity${retired} = [];`],
      ['generated/entities.json', '{"column":"bytes"}', JSON.stringify({column: retired})],
      ['captures/current.snap', 'Bytes column', `Entity ${retired}`],
      [`references/sdk-${retired}.md`, null, '# Entity bytes'],
    ];
    for (let index = 0; index < cases.length; index++) {
      const [file, clean, mutation] = cases[index];
      const fixture = path.join(scratch, String(index));
      await mkdir(path.dirname(path.join(fixture, file)), {recursive: true});
      const invoke = () => spawnSync(process.execPath, [path.join(root, 'scripts/check-vocabulary.mjs'), fixture], {encoding: 'utf8'});
      if (clean !== null) {
        await writeFile(path.join(fixture, file), clean);
        assert.equal(invoke().status, 0, `${file}: positive control`);
      }
      await writeFile(path.join(fixture, file), mutation);
      const rejected = invoke();
      assert.equal(rejected.status, 1, `${file}: mutation must fail`);
      assert.equal(JSON.parse(rejected.stdout).passed, false);
    }
  } finally {
    assert.equal(path.dirname(scratch), tmpdir());
    assert.ok(path.basename(scratch).startsWith('arkiv-vocabulary-'));
    await rm(scratch, {recursive: true});
  }
});
