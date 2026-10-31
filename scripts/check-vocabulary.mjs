import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Assemble the retired term so the guard's own source follows the vocabulary rule.
const retired = new RegExp(['pay', 'load'].join(''), 'i');
const omitted = new Set(['.git', 'node_modules', '.checks', '.checks-surf']);
const textFile = /\.(?:md|mdx|[cm]?[jt]sx?|jsonl?|ya?ml|html|txt|csv|snap|css|svg)$/i;

export async function checkVocabulary(root) {
  const failures = [];
  let files = 0;
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes: true})) {
      if (omitted.has(entry.name)) continue;
      const file = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Vocabulary scan refuses symlinks: ${file}`);
      if (retired.test(file)) failures.push({file, line: 0, rule: 'resource-name'});
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && textFile.test(entry.name)) {
        files++;
        const lines = (await readFile(path.join(root, file), 'utf8')).split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (retired.test(lines[index])) failures.push({file, line: index + 1, rule: 'entity-vocabulary'});
        }
      }
    }
  }
  await visit();
  return {passed: failures.length === 0, files, failures};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkVocabulary(root);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
