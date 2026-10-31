import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Assemble the retired term so the guard's own source follows the vocabulary rule.
const retired = new RegExp(['pay', 'load'].join(''), 'i');
const omitted = new Set(['.git', 'node_modules', '.checks', '.checks-surf']);

export async function checkVocabulary(root) {
  const failures = [];
  let files = 0;
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes: true})) {
      if (omitted.has(entry.name)) continue;
      if (/^\.env(?:\.|$)/i.test(entry.name)) continue;
      const file = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Vocabulary scan refuses symlinks: ${file}`);
      if (retired.test(file)) failures.push({file, line: 0, rule: 'resource-name'});
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const declaredText = /\.(?:md|mdx|[cm]?[jt]sx?|jsonl?|map|ya?ml|html|txt|csv|snap|css|svg|sql|toml|sh|ps1)$/i.test(file);
        let text;
        try { text = new TextDecoder('utf-8', {fatal: true}).decode(await readFile(path.join(root, file))); }
        catch (error) { if (!(error instanceof TypeError)) throw error; if (declaredText) failures.push({file, line: 1, rule: 'invalid-utf8'}); continue; }
        if (text.includes(String.fromCharCode(0))) { if (declaredText) failures.push({file, line: 1, rule: 'invalid-text'}); continue; }
        files++;
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (retired.test(lines[index])) failures.push({file, line: index + 1, rule: 'entity-vocabulary'});
        }
        if (/\.(?:jsonl?|map)$/i.test(file)) {
          try {
            function inspect(value) {
              if (typeof value === 'string' && retired.test(value)) failures.push({file, line: 1, rule: 'json-string'});
              else if (Array.isArray(value)) value.forEach(inspect);
              else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
                if (retired.test(key)) failures.push({file, line: 1, rule: 'json-field'});
                inspect(item);
              }
            }
            if (/\.jsonl$/i.test(file)) lines.filter(line => line.trim()).forEach(line => inspect(JSON.parse(line)));
            else inspect(JSON.parse(text));
          } catch { failures.push({file, line: 1, rule: 'invalid-json'}); }
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
