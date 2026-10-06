import path from 'node:path';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {repositoryRoot} from './build-plugin.mjs';
import {readSnippets, sha256} from './extract-snippets.mjs';
import {frontmatter} from './check-static.mjs';

const protocols = ['2025-03-26', '2025-06-18', '2025-11-25'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class CheckError extends Error {
  constructor(code, {operational = false, httpStatus, retryAfter} = {}) {super(code); Object.assign(this, {code, operational, httpStatus, retryAfter});}
}
async function boundedText(response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks = []; let length = 0;
  try {
    while (true) {const item = await reader.read(); if (item.done) break; length += item.value.length;
      if (length > 1048576) throw new CheckError('RESPONSE_SIZE_BOUND_EXCEEDED'); chunks.push(item.value);}
  } finally {await reader.cancel().catch(() => {});}
  try {return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));}
  catch {throw new CheckError('INVALID_UTF8_RESPONSE');}
}
function parseResponse(text, contentType, id) {
  let messages;
  try {
    if (contentType.includes('text/event-stream')) messages = text.replaceAll('\r\n', '\n').split('\n\n')
      .map(event => event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
      .filter(Boolean).flatMap(data => {const item = JSON.parse(data); return Array.isArray(item) ? item : [item];});
    else if (contentType.includes('application/json')) {const item = JSON.parse(text); messages = Array.isArray(item) ? item : [item];}
    else throw new Error();
  } catch {throw new CheckError('MALFORMED_PROTOCOL_RESPONSE');}
  const matches = messages.filter(item => item?.id === id);
  if (matches.length !== 1 || matches[0].jsonrpc !== '2.0' ||
      ('result' in matches[0]) === ('error' in matches[0])) throw new CheckError('INVALID_JSON_RPC_ENVELOPE');
  if (matches[0].error) throw new CheckError('READONLY_PROTOCOL_CALL_FAILED');
  return matches[0].result;
}
function toolData(value) {
  if (!object(value) || value.isError || !Array.isArray(value.content)) throw new CheckError('INVALID_READONLY_TOOL_RESULT');
  if (object(value.structuredContent) || Array.isArray(value.structuredContent)) return value.structuredContent;
  const blocks = value.content.filter(block => block.type === 'text');
  if (blocks.length !== 1 || typeof blocks[0].text !== 'string') throw new CheckError('INVALID_READONLY_TOOL_CONTENT');
  try {return JSON.parse(blocks[0].text);} catch {throw new CheckError('INVALID_READONLY_TOOL_JSON');}
}
function sourceURL(source, file, repositories) {
  if (!/^[a-f0-9]{40}$/.test(source?.version ?? '')) return null;
  let url; try {url = new URL(source.url);} catch {return null;}
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.username || url.password || url.search || url.hash) return null;
  const parts = url.pathname.split('/').filter(Boolean), repository = parts.slice(0, 2).join('/');
  if (!repositories.has(repository) || parts[2] !== source.version || parts.slice(3).join('/') !== file) return null;
  return url;
}

export async function checkMcp({root = repositoryRoot, request = fetch, env = process.env, timeoutMs = 15000} = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'plugin.config.json'), 'utf8'));
  const {files} = await readSnippets(root);
  const skillFiles = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.file));
  const metadata = await Promise.all(skillFiles.map(async file => ({...file, metadata: frontmatter(await readFile(path.join(root, file.file), 'utf8'))})));
  const names = metadata.map(file => file.metadata.name);
  const report = {version: 1, checkedAt: new Date().toISOString(),
    head: /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
    sdk: config.sdkVersion, chain: {name: config.network, id: config.chainId}, kind: 'mcp',
    executionMode: request === globalThis.fetch ? 'mcp_readonly' : 'synthetic_transport', result: 'SKIPPED',
    endpoint: config.mcpUrl, sourceFiles: [], cases: [], readonly: true, signing: false, submission: false,
    scope: 'Gateway protocol and published pinned skill/reference byte identity; no SDK or chain execution.', rpcTrace: []};
  const verificationToken = env.VERIFICATION_TOKEN;
  let sequence = 0, session, version = protocols[0], protocolPassed = false;
  const trace = report.rpcTrace;
  const http = async (url, init, label) => {
    let response;
    try {response = await request(url, {...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});}
    catch {throw new CheckError('READONLY_SOURCE_OR_GATEWAY_UNAVAILABLE', {operational: true});}
    trace.push({method: label, httpStatus: response.status});
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const retry = response.headers.get('retry-after');
      throw new CheckError(response.status === 429 ? 'READONLY_QUOTA_LIMITED' : 'READONLY_HTTP_UNAVAILABLE',
        {operational: true, httpStatus: response.status, ...( /^\d{1,8}$/.test(retry ?? '') ? {retryAfter: retry + ' seconds'} : {})});
    }
    return response;
  };
  const call = async (method, params, notification = false) => {
    const id = ++sequence;
    const response = await http(config.mcpUrl, {method: 'POST', headers: {'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version,
      'x-arkiv-verification': verificationToken, ...(session ? {'Mcp-Session-Id': session} : {})},
      body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, ...(params === undefined ? {} : {params})})}, method);
    const text = await boundedText(response);
    if (text.includes(verificationToken)) throw new CheckError('VERIFICATION_CREDENTIAL_REFLECTED', {operational: true});
    if (notification) {if (response.status !== 202 || text.length) throw new CheckError('INVALID_INITIALIZED_NOTIFICATION_ACK'); return;}
    if (method === 'initialize') {
      session = response.headers.get('mcp-session-id');
      if (session && !/^[\x21-\x7e]{1,4096}$/.test(session)) throw new CheckError('INVALID_SESSION_ID');
    }
    return parseResponse(text, response.headers.get('content-type') ?? '', id);
  };
  const list = async (method, key) => {
    const entries = [], cursors = new Set(); let cursor;
    for (let page = 0; page < 8; page++) {
      const value = await call(method, cursor ? {cursor} : {});
      if (!Array.isArray(value?.[key]) || value[key].some(item => !object(item) || typeof item.name !== 'string' || !item.name) || entries.length + value[key].length > 2000) throw new CheckError('INVALID_DISCOVERY_LIST');
      entries.push(...value[key]);
      if (value.nextCursor === undefined) {
        if (new Set(entries.map(item => item.name)).size !== entries.length) throw new CheckError('DUPLICATE_DISCOVERY_ENTRY');
        return entries;
      }
      if (typeof value.nextCursor !== 'string' || !value.nextCursor || cursors.has(value.nextCursor)) throw new CheckError('INVALID_DISCOVERY_CURSOR');
      cursor = value.nextCursor; cursors.add(cursor);
    }
    throw new CheckError('DISCOVERY_PAGE_BUDGET_EXCEEDED', {operational: true});
  };
  try {
    if (typeof verificationToken !== 'string' || verificationToken.length < 32 || verificationToken.length > 256 || /[\r\n]/.test(verificationToken)) {
      throw new CheckError('OPERATOR_VERIFICATION_TOKEN_REQUIRED', {operational: true});
    }
    if (config.mcpUrl !== 'https://mcp.arkiv.network/') throw new CheckError('REVIEWED_CANONICAL_ENDPOINT_REQUIRED', {operational: true});
    const init = await call('initialize', {protocolVersion: version, capabilities: {}, clientInfo: {name: 'arkiv-skill-health', version: config.version}});
    if (!object(init) || typeof init.protocolVersion !== 'string' || !object(init.capabilities) ||
        typeof init.serverInfo?.name !== 'string' || !init.serverInfo.name || typeof init.serverInfo.version !== 'string' || !init.serverInfo.version) throw new CheckError('INVALID_INITIALIZE_RESULT');
    if (!protocols.includes(init.protocolVersion)) throw new CheckError('UNSUPPORTED_NEGOTIATED_PROTOCOL', {operational: true});
    version = init.protocolVersion; report.serverInfo = init.serverInfo; report.protocolVersion = version;
    await call('notifications/initialized', undefined, true);
    const data = {server_status: toolData(await call('tools/call', {name: 'server_status', arguments: {}}))};
    if (!object(data.server_status) || data.server_status.trafficClass !== 'verification') {
      throw new CheckError('OPERATOR_VERIFICATION_NOT_CONFIRMED', {operational: true});
    }
    report.trafficClass = 'verification';
    if (!object(init.capabilities.tools) || !object(init.capabilities.prompts)) throw new CheckError('GATEWAY_DISCOVERY_CAPABILITY_MISSING');
    const tools = await list('tools/list', 'tools'), prompts = await list('prompts/list', 'prompts');
    report.discovery = {tools: tools.map(item => item.name), prompts: prompts.map(item => item.name)};
    for (const name of ['server_status', 'list_skills']) {
      const tool = tools.find(item => item.name === name);
      if (!tool || !object(tool.inputSchema) || tool.inputSchema.type !== 'object') throw new CheckError('READONLY_TOOL_SCHEMA_MISSING');
      if (tool.inputSchema.required !== undefined && (!Array.isArray(tool.inputSchema.required) || tool.inputSchema.required.length)) throw new CheckError('READONLY_TOOL_INPUT_REVIEW_REQUIRED', {operational: true});
      if (name !== 'server_status') data[name] = toolData(await call('tools/call', {name, arguments: {}}));
    }
    if (!object(data.server_status) || typeof data.server_status.serverVersion !== 'string') throw new CheckError('INVALID_SERVER_STATUS');
    const entries = Array.isArray(data.list_skills) ? data.list_skills : data.list_skills?.skills;
    if (!Array.isArray(entries) || entries.some(item => !object(item) || typeof item.id !== 'string') || new Set(entries.map(item => item.id)).size !== entries.length) throw new CheckError('INVALID_PUBLISHED_SKILL_CATALOG');
    if (!Array.isArray(data.list_skills) && data.list_skills.nextCursor != null) throw new CheckError('PUBLISHED_CATALOG_PAGINATION_REVIEW_REQUIRED', {operational: true});
    report.publishedSkills = entries.map(entry => ({id: entry.id, sdk: entry.sdk, network: entry.network,
      source: entry.source, recommended: entry.recommended, executionCompatible: entry.executionCompatible}));
    protocolPassed = true;
    report.cases.push({id: 'gateway-protocol', skills: names, status: 'PASS', evidence: {scope: 'transport_protocol',
      serverInfo: report.serverInfo, protocolVersion: version, discoveryHash: sha256(JSON.stringify(report.discovery))}});
    const repositories = new Set([new URL(config.repository).pathname.slice(1).replace(/\.git$/, ''), 'SantiagoDevRel/skills']);
    for (const skill of metadata) {
      const name = skill.metadata.name, entry = entries.find(item => item.id === `skills/${name}/skill` || item.id === name);
      const definition = {id: 'published-skill-source', skill: name};
      const skip = reason => report.cases.push({...definition, status: 'SKIPPED', reason});
      if (!entry) {skip('Current skill is absent from the published catalog'); continue;}
      if (!Array.isArray(entry.sdk) || !entry.sdk.includes(config.sdkVersion) ||
          typeof entry.network !== 'string' || entry.network.toLowerCase() !== config.network) {skip('Published SDK or network differs from the verified target'); continue;}
      if (skill.metadata.metadata.deprecated !== 'true' && (entry.recommended === false || entry.executionCompatible === false)) {skip('Published entry is historical or incompatible'); continue;}
      const url = sourceURL(entry.source, skill.file, repositories);
      if (!url || entry.source.digest !== skill.sha256) {skip('Published immutable source or digest differs from current skill'); continue;}
      const candidates = files.filter(file => file.file.startsWith(`skills/${name}/`)), verified = [];
      let mismatch;
      for (const file of candidates) {
        const source = new URL(url); source.pathname = url.pathname.slice(0, url.pathname.length - skill.file.length) + file.file;
        const body = await boundedText(await http(source.href, {method: 'GET'}, 'published-source-read'));
        const digest = sha256(body);
        if (digest !== file.sha256) {mismatch = file.file; break;}
        verified.push({file: file.file, sha256: digest});
      }
      if (mismatch) {skip('Published skill or reference bytes differ from current source'); continue;}
      report.sourceFiles.push(...verified);
      const evidence = {sourceUrl: url.href, sourceVersion: entry.source.version, sdk: config.sdkVersion,
        network: config.network, verifiedFiles: verified};
      report.cases.push({...definition, status: 'PASS', evidence, evidenceHash: sha256(JSON.stringify(evidence))});
    }
    report.result = report.cases.some(test => test.status === 'SKIPPED') ? 'SKIPPED' : 'PASS';
    if (report.result === 'SKIPPED') report.reason = 'Current skill catalog is not fully published and byte-verified';
  } catch (error) {
    const failure = error instanceof CheckError ? error : new CheckError('READONLY_CHECK_UNAVAILABLE', {operational: true});
    report.result = failure.operational || protocolPassed ? 'SKIPPED' : 'FAIL';
    Object.assign(report, {reason: failure.code, ...(failure.operational ? {operational: true} : {}),
      ...(failure.httpStatus ? {httpStatus: failure.httpStatus} : {}), ...(failure.retryAfter ? {retryAfter: failure.retryAfter} : {})});
    if (!protocolPassed) report.cases.push({id: 'gateway-protocol', skills: names, status: report.result,
      reason: failure.code, evidence: {scope: 'transport_protocol'}});
    for (const name of names.filter(name => !report.cases.some(test => test.skill === name))) report.cases.push({id: 'published-skill-source', skill: name, status: 'SKIPPED', reason: 'Published bytes were not verified'});
  }
  report.checkedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const output = process.argv[2]; if (!output) throw new Error('Usage: node scripts/check-mcp.mjs /output/mcp.json');
    const report = await checkMcp(); await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({result: report.result, reason: report.reason, serverInfo: report.serverInfo,
      publishedEntries: report.publishedSkills?.length ?? 0, verifiedSkills: report.cases.filter(test => test.id === 'published-skill-source' && test.status === 'PASS').length}));
    if (report.result === 'FAIL') process.exitCode = 1;
  } catch {console.error('Readonly MCP evidence could not be produced'); process.exitCode = 1;}
}
