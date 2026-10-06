import path from 'node:path';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {installedPackage} from './check-snippets.mjs';
import {sha256} from './extract-snippets.mjs';

class RpcCheckError extends Error {
  constructor(code, {operational = false, httpStatus, retryAfterSeconds} = {}) {
    super(code); Object.assign(this, {code, operational, httpStatus, retryAfterSeconds});
  }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);

async function reviewedTarget(root, workspace) {
  let bytes, config;
  try {bytes = await readFile(path.join(root, 'plugin.config.json')); config = JSON.parse(bytes);}
  catch {throw new RpcCheckError('INVALID_PLUGIN_CONFIGURATION');}
  if (config.network !== 'tiramisu' || config.chainId !== 7738577) throw new RpcCheckError('VERIFIED_TIRAMISU_CONFIGURATION_REQUIRED');
  if (config.sdkVersion !== '0.8.1') throw new RpcCheckError('PINNED_SDK_REVIEW_REQUIRED', {operational: true});
  let pkg, moduleBytes, declarations, chains;
  try {
    pkg = await installedPackage(workspace, '@arkiv-network/sdk');
    if (pkg.metadata.version !== config.sdkVersion) throw new Error('Unreviewed SDK version');
    const target = pkg.metadata.exports?.['./chains']?.import;
    if (typeof target !== 'string' || !target.startsWith('./') || target.includes('..') || path.isAbsolute(target)) throw new Error('Unreviewed chain export');
    moduleBytes = await readFile(path.join(pkg.directory, target));
    declarations = await readFile(path.join(pkg.directory, 'src/chains/tiramisu.ts'));
    chains = await import(pathToFileURL(path.join(pkg.directory, target)).href);
  } catch {throw new RpcCheckError('PINNED_CHAIN_DECLARATIONS_UNAVAILABLE', {operational: true});}
  const chain = chains.tiramisu, endpoint = chain?.rpcUrls?.default?.http?.[0];
  let url;
  try {url = new URL(endpoint);} catch {throw new RpcCheckError('INVALID_SDK_CHAIN_ENDPOINT');}
  if (chain.id !== config.chainId || chain.network !== config.network || chain.testnet !== true ||
      url.protocol !== 'https:' || url.hostname !== 'rpc.tiramisu.db-chain.testnet.arkiv.network' ||
      url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/') throw new RpcCheckError('SDK_CHAIN_IDENTITY_MISMATCH');
  return {endpoint, sdk: config.sdkVersion, chain: {name: config.network, id: chain.id},
    sourceBinding: {configuration: {file: 'plugin.config.json', sha256: sha256(bytes)},
      sdkPackage: {name: pkg.metadata.name, version: pkg.metadata.version},
      chainExportSha256: sha256(moduleBytes), chainDeclarationSha256: sha256(declarations)}};
}

async function boundedBody(response) {
  const reader = response.body?.getReader(); if (!reader) throw new RpcCheckError('EMPTY_RPC_RESPONSE');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.length;
      if (length > 65536) throw new RpcCheckError('RPC_RESPONSE_SIZE_BOUND_EXCEEDED');
      chunks.push(value);
    }
  } finally {reader.cancel().catch(() => {});}
  let text;
  try {text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));}
  catch {throw new RpcCheckError('INVALID_RPC_UTF8');}
  try {return JSON.parse(text);} catch {throw new RpcCheckError('MALFORMED_RPC_JSON');}
}

export async function checkRpc({root = repositoryRoot, workspace = path.join(root, 'tests/snippets'),
  request = globalThis.fetch, env = process.env, timeoutMs = 10000} = {}) {
  const report = {version: 1, checkedAt: new Date().toISOString(), kind: 'network_diagnostic',
    executionMode: request === globalThis.fetch ? 'rpc_readonly' : 'synthetic_transport', result: 'SKIPPED',
    head: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    sdk: null, chain: {name: 'tiramisu', id: 7738577}, scope: 'Anonymous network identity and head only; no skill, live-write or health-layer coverage.',
    readonly: true, signing: false, submission: false, requests: [], cases: []};
  let activeCase = 'network-identity';
  const call = async (method, id) => {
    if (!['eth_chainId', 'eth_blockNumber'].includes(method)) throw new RpcCheckError('READONLY_METHOD_NOT_ALLOWED');
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => {
          const trace = {method, id, httpStatus: null}; report.requests.push(trace);
          let response;
          try {response = await request(report.endpoint, {method: 'POST', redirect: 'error', signal: controller.signal,
            headers: {'Content-Type': 'application/json', Accept: 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', id, method, params: []})});}
          catch {throw new RpcCheckError('RPC_TRANSPORT_UNAVAILABLE', {operational: true});}
          trace.httpStatus = response.status;
          if (!response.ok) {
            response.body?.cancel().catch(() => {});
            const retry = response.headers.get('retry-after');
            throw new RpcCheckError(response.status === 429 ? 'RPC_QUOTA_LIMITED' : 'RPC_HTTP_UNAVAILABLE',
              {operational: true, httpStatus: response.status,
                ...(/^\d{1,5}$/.test(retry ?? '') ? {retryAfterSeconds: Number(retry)} : {})});
          }
          const value = await boundedBody(response);
          if (!object(value) || value.jsonrpc !== '2.0' || value.id !== id || ('result' in value) === ('error' in value)) throw new RpcCheckError('INVALID_RPC_ENVELOPE');
          if ('error' in value) {
            if (!object(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string') throw new RpcCheckError('INVALID_RPC_ERROR');
            throw new RpcCheckError([-32600, -32601, -32602].includes(value.error.code) ? 'READONLY_RPC_METHOD_REJECTED' : 'RPC_READ_UNAVAILABLE',
              {operational: ![-32600, -32601, -32602].includes(value.error.code)});
          }
          if (!quantity(value.result)) throw new RpcCheckError('INVALID_RPC_QUANTITY');
          return value.result;
        })(),
        new Promise((_, reject) => {timer = setTimeout(() => {
          reject(new RpcCheckError('RPC_REQUEST_TIMEOUT', {operational: true})); controller.abort();
        }, timeoutMs);})
      ]);
    } finally {clearTimeout(timer); controller.abort();}
  };
  try {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new RpcCheckError('INVALID_REQUEST_TIME_BOUND');
    Object.assign(report, await reviewedTarget(root, workspace));
    const chainId = await call('eth_chainId', 1);
    if (BigInt(chainId) !== BigInt(report.chain.id)) throw new RpcCheckError('RPC_CHAIN_ID_MISMATCH');
    report.cases.push({id: activeCase, status: 'PASS', evidence: {chainId: report.chain.id}});
    activeCase = 'network-head';
    const block = await call('eth_blockNumber', 2);
    report.cases.push({id: activeCase, status: 'PASS', evidence: {blockNumber: BigInt(block).toString()}});
    report.result = 'PASS';
  } catch (error) {
    const known = error instanceof RpcCheckError;
    const status = known && !error.operational ? 'FAIL' : 'SKIPPED';
    report.result = status;
    report.reason = known ? error.code : 'RPC_DIAGNOSTIC_UNAVAILABLE';
    if (known && error.httpStatus !== undefined) report.httpStatus = error.httpStatus;
    if (known && error.retryAfterSeconds !== undefined) report.retryAfterSeconds = error.retryAfterSeconds;
    report.cases.push({id: activeCase, status, reason: report.reason});
    if (activeCase === 'network-identity') report.cases.push({id: 'network-head', status: 'SKIPPED', reason: 'Network identity did not pass; no head request sent.'});
  }
  report.checkedAt = new Date().toISOString();
  return report;
}

export async function runRpcCheck(args, {root = repositoryRoot, env = process.env} = {}) {
  const [output, option, selectedWorkspace] = args;
  if ((args.length !== 1 && args.length !== 3) || !output || !path.isAbsolute(output) || !output.endsWith('.json') ||
      (args.length === 3 && (option !== '--workspace' || !path.isAbsolute(selectedWorkspace)))) throw new Error('Usage: node scripts/check-rpc.mjs /external/network.json [--workspace /absolute/dependencies]');
  const relative = path.relative(root, output);
  if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Network evidence must be outside the repository');
  try {await stat(output); throw new Error('Network evidence path already exists');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const report = await checkRpc({root, env, workspace: selectedWorkspace ?? path.join(root, 'tests/snippets')});
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await runRpcCheck(process.argv.slice(2));
    console.log(JSON.stringify({result: report.result, reason: report.reason, cases: report.cases}));
    if (report.result === 'FAIL') process.exitCode = 1;
  } catch {console.error('RPC diagnostic could not run or write a new external report'); process.exitCode = 1;}
}
