import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {installedPackage} from '../../scripts/check-snippets.mjs';
import {readSnippets} from '../../scripts/extract-snippets.mjs';

export async function loadDependencies(workspace) {
  const sdkPackage = await installedPackage(workspace, '@arkiv-network/sdk');
  const viemPackage = await installedPackage(workspace, 'viem');
  if (sdkPackage.metadata.version !== '0.8.1' || viemPackage.metadata.version !== '2.57.3') throw new Error('Live verification requires the pinned SDK and viem versions');
  const imports = {};
  for (const [specifier, pkg, subpath] of [['@arkiv-network/sdk', sdkPackage, '.'], ['@arkiv-network/sdk/attr', sdkPackage, './attr'],
    ['@arkiv-network/sdk/query', sdkPackage, './query'], ['@arkiv-network/sdk/chains', sdkPackage, './chains'],
    ['viem', viemPackage, '.'], ['viem/accounts', viemPackage, './accounts']]) {
    const target = pkg.metadata.exports[subpath].import;
    if (!target?.startsWith('./') || target.includes('..')) throw new Error('Unexpected dependency export path');
    imports[specifier] = pathToFileURL(path.join(pkg.directory, target)).href;
  }
  const [sdk, chains, viem, accounts, attr, query] = await Promise.all([
    import(imports['@arkiv-network/sdk']), import(imports['@arkiv-network/sdk/chains']), import(imports.viem),
    import(imports['viem/accounts']), import(imports['@arkiv-network/sdk/attr']), import(imports['@arkiv-network/sdk/query'])]);
  return {sdk: {...sdk, tiramisu: chains.tiramisu}, viem, accounts, attr, query, imports};
}
export async function skillModules(root, dependencies) {
  const {files, snippets} = await readSnippets(root);
  const load = async id => {
    const snippet = snippets.find(snippet => snippet.id === id);
    if (!snippet || snippet.skipReason || snippet.language === 'tsx') throw new Error('Required live skill module is missing');
    const executable = stripTypeScriptTypes(snippet.source).replace(/\bfrom\s+(["'])([^"']+)\1/g, (_, quote, specifier) => {
      if (!dependencies.imports[specifier]) throw new Error('Live skill module has an unreviewed dependency');
      return `from ${JSON.stringify(dependencies.imports[specifier])}`;
    });
    return {module: await import('data:text/javascript;base64,' + Buffer.from(executable).toString('base64')),
      source: {id: snippet.id, sha256: snippet.sha256, file: snippet.file, line: snippet.line}};
  };
  return {files, load};
}
