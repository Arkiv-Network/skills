import {open, readFile} from 'node:fs/promises';
import http from 'node:http';
import {createHash} from 'node:crypto';

export const NATIVE_ADDRESS = '0x4400000000000000000000000000000000000044';
export const TIRAMISU_RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';
export const MAX_SPEND = 10n ** 18n;
const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'eth_fillTransaction', 'arkiv_query', 'arkiv_getBlockTiming']);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';

export class LiveError extends Error {
  constructor(code, {operational = false, httpStatus, retryAfter, data, rpcCode} = {}) {
    super(code); this.name = 'LiveError'; this.code = code;
    Object.assign(this, {operational, httpStatus, retryAfter, data, rpcCode});
  }
}
export function validateEnvironment(env, {root, output, account}) {
  if (env.ARKIV_ENABLE_LIVE !== 'true') throw new LiveError('LIVE_NOT_OPTED_IN', {operational: true});
  if (account !== undefined) {
    if (account?.type !== 'local' || !/^0x[0-9a-fA-F]{40}$/.test(account.address ?? '') ||
        /^0x0{40}$/i.test(account.address) || typeof account.signTransaction !== 'function') throw new LiveError('DEDICATED_LOCAL_ACCOUNT_REQUIRED', {operational: true});
    if (env.ARKIV_PRIVATE_KEY) throw new LiveError('AMBIGUOUS_SIGNER_CONFIGURATION', {operational: true});
  } else if (!/^0x[0-9a-fA-F]{64}$/.test(env.ARKIV_PRIVATE_KEY ?? '')) throw new LiveError('SIGNER_NOT_CONFIGURED', {operational: true});
  if (env.ARKIV_CHAIN_ID !== '7738577' || env.ARKIV_RPC_URL !== TIRAMISU_RPC) throw new LiveError('TIRAMISU_COORDINATES_REQUIRED', {operational: true});
  if (!/^[1-9]\d*$/.test(env.ARKIV_MAX_SPEND_WEI ?? '') || BigInt(env.ARKIV_MAX_SPEND_WEI) > MAX_SPEND) throw new LiveError('BUDGET_MUST_BE_POSITIVE_AT_MOST_ONE_GLM', {operational: true});
  if (env.ARKIV_ACCESS_KEY && (env.ARKIV_ACCESS_KEY.length > 4096 || /[\r\n]/.test(env.ARKIV_ACCESS_KEY))) throw new LiveError('INVALID_ACCESS_HEADER', {operational: true});
  if (!output || !root || !output.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(output)) throw new LiveError('ABSOLUTE_EXTERNAL_OUTPUT_REQUIRED', {operational: true});
  return {maxSpend: BigInt(env.ARKIV_MAX_SPEND_WEI)};
}

export class LiveOperator {
  constructor({account, namespace, maxSpend, journalPath, sdk, viem, request = fetch, accessKey = '', clock = Date.now}) {
    if (!account?.address || !/^arkiv_live_[a-f0-9]{32}$/.test(namespace) || maxSpend <= 0n || maxSpend > MAX_SPEND) throw new LiveError('INVALID_OPERATOR_SCOPE');
    Object.assign(this, {account, namespace, maxSpend, journalPath, sdk, viem, requestFetch: request, accessKey, clock});
    this.transactions = new Map(); this.owned = new Map(); this.rpcTrace = []; this.id = 0; this.caseId = 'preflight';
    this.writeQueue = Promise.resolve(); this.stopped = false; this.entries = 0; this.previousHash = '0'.repeat(64);
    this.journalQueue = Promise.resolve();
    this.executeAbi = viem.parseAbi(['function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)']);
    this.nonceAbi = viem.parseAbi(['function entityNonce(address owner) external view returns (uint64)']);
    const cell = '(bytes32 name,uint8 typeId,bytes value)[]';
    this.parameters = {1: viem.parseAbiParameters(`(uint128 salt,uint64 expiresAt,uint64 minLifetime,uint8 creationFlags,${cell} attributes)`),
      2: viem.parseAbiParameters(`(bytes32 entityKey,${cell} mutations)`),
      3: viem.parseAbiParameters('(bytes32 entityKey,uint64 expiresAt,uint64 minLifetime)'),
      4: viem.parseAbiParameters('(bytes32 entityKey,address newOwner)'), 5: viem.parseAbiParameters('(bytes32 entityKey)')};
    this.errorAbi = viem.parseAbi(['error ReadOnlyEntity(bytes32 entityKey)', 'error TransferToSelf(bytes32 entityKey)',
      'error TransferToZeroAddress(bytes32 entityKey)', 'error EntityExpired(bytes32 entityKey,uint64 expiresAt)', 'error EntityNotFound(bytes32 entityKey)']);
    this.transport = viem.custom({request: ({method, params}) => this.request(method, params ?? [])}, {retryCount: 0});
    this.reader = sdk.createPublicClient({chain: sdk.tiramisu, transport: this.transport, pollingInterval: 1000, cacheTime: 0});
    this.wallet = sdk.createWalletClient({chain: sdk.tiramisu, account, transport: this.transport, pollingInterval: 1000, cacheTime: 0});
  }
  async initialize() {
    try {this.journal = await open(this.journalPath, 'wx', 0o600);}
    catch {throw new LiveError('JOURNAL_UNAVAILABLE', {operational: true});}
    await this.record({state: 'started', namespace: this.namespace, chainId: 7738577, sender: this.account.address, maxSpendWei: this.maxSpend.toString()});
  }
  async record(entry) {
    const committed = this.journalQueue.then(async () => {
      const record = {sequence: ++this.entries, checkedAt: new Date(this.clock()).toISOString(), previousHash: this.previousHash, ...entry};
      const digest = hash(json(record));
      try {await this.journal.writeFile(json({...record, sha256: digest}) + '\n'); await this.journal.sync();}
      catch {throw new LiveError('JOURNAL_UNAVAILABLE', {operational: true});}
      this.previousHash = digest;
    });
    this.journalQueue = committed.catch(() => {}); return committed;
  }
  async rawRpc(method, params) {
    try {return await this.rpcOnce(method, params);}
    catch (error) {
      if (error instanceof LiveError && error.operational) {this.failure = error; this.stopped = true;}
      throw error;
    }
  }
  async rpcOnce(method, params) {
    if (!reads.has(method) && method !== 'eth_sendRawTransaction') throw new LiveError('RPC_METHOD_DENIED');
    if (this.stopped) throw new LiveError('OPERATOR_STOPPED', {operational: true});
    const unresolved = [...this.transactions.values()].find(tx => ['prepared', 'broadcast', 'ambiguous'].includes(tx.state));
    if (unresolved && this.clock() - unresolved.preparedAtMs > 60000) { this.stopped = true; throw new LiveError('RECEIPT_DEADLINE_EXCEEDED', {operational: true}); }
    const timeout = unresolved ? Math.max(1, Math.min(15000, 60000 - (this.clock() - unresolved.preparedAtMs))) : 15000;
    let response; const id = ++this.id;
    try { response = await this.requestFetch(TIRAMISU_RPC, {method: 'POST', headers: {'Content-Type': 'application/json', ...(this.accessKey ? {'X-API-KEY': this.accessKey} : {})},
      body: json({jsonrpc: '2.0', id, method, params}), signal: AbortSignal.timeout(timeout)}); }
    catch { throw new LiveError('RPC_TRANSPORT_UNAVAILABLE', {operational: true}); }
    const trace = {method, httpStatus: response.status}; this.rpcTrace.push(trace);
    if (response.status === 429) {
      this.stopped = true;
      const header = response.headers.get('retry-after'); const seconds = Number(header);
      const retryAfter = header && /^\d+$/.test(header) && Number.isFinite(seconds) ? `${seconds} seconds` : 'Provider quota window';
      await this.record({state: 'quota_stopped', httpStatus: 429, retryAfter});
      throw new LiveError('RPC_QUOTA_LIMITED', {operational: true, httpStatus: 429, retryAfter});
    }
    let body;
    try { const bytes = await response.arrayBuffer(); if (bytes.byteLength > 2 * 1024 * 1024) throw new Error(); body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw new LiveError('RPC_RESPONSE_INVALID', {operational: true}); }
    if (!response.ok) throw new LiveError('RPC_HTTP_UNAVAILABLE', {operational: true, httpStatus: response.status});
    if (body.error) {
      const data = typeof body.error.data === 'string' && /^0x[a-fA-F0-9]{8,8192}$/.test(body.error.data) ? body.error.data : undefined;
      if (data) try { trace.nativeError = this.viem.decodeErrorResult({abi: this.errorAbi, data}).errorName; } catch { /* Unknown error is not a permission verdict. */ }
      throw new LiveError('RPC_REJECTED', {data, rpcCode: body.error.code});
    }
    if (body.id !== id || body.jsonrpc !== '2.0' || !('result' in body)) throw new LiveError('RPC_RESPONSE_IDENTITY_INVALID');
    return body.result;
  }
  decodeOperations(data, {broadcast = false} = {}) {
    if (!/^0x[a-fA-F0-9]+$/.test(data ?? '') || data.length > 65538) throw new LiveError('NATIVE_CALL_SIZE_DENIED');
    const decoded = this.viem.decodeFunctionData({abi: this.executeAbi, data});
    if (decoded.functionName !== 'execute' || !decoded.args[0].length || decoded.args[0].length > 6) throw new LiveError('NATIVE_BATCH_DENIED');
    const operations = decoded.args[0].map(operation => {
      if (!this.parameters[operation.operation]) throw new LiveError('NATIVE_OPERATION_DENIED');
      const fields = this.viem.decodeAbiParameters(this.parameters[operation.operation], operation.operationData)[0];
      if (this.viem.encodeAbiParameters(this.parameters[operation.operation], [fields]).toLowerCase() !== operation.operationData.toLowerCase()) throw new LiveError('NONCANONICAL_OPERATION_DENIED');
      if (operation.operation === 1) {
        const attributes = Object.fromEntries(fields.attributes.map(cell => [new TextDecoder().decode(this.viem.hexToBytes(cell.name)).replace(/\0+$/, ''), cell]));
        const project = attributes.project && new TextDecoder().decode(this.viem.hexToBytes(attributes.project.value));
        if (project !== this.namespace && !(this.caseId === 'first-write-exact' && project === 'first_note')) throw new LiveError('CREATE_NAMESPACE_DENIED');
        if (fields.attributes.length > 10 || fields.creationFlags > 3 || this.viem.hexToBytes(attributes.$payload?.value ?? '0x').length > 1024) throw new LiveError('CREATE_INPUT_DENIED');
        const string = name => attributes[name] && new TextDecoder().decode(this.viem.hexToBytes(attributes[name].value));
        if (string('$contentType') !== 'application/json' || attributes.project?.typeId !== 8) throw new LiveError('CREATE_INPUT_DENIED');
        let payload; try {payload = JSON.parse(string('$payload'));} catch {throw new LiveError('CREATE_INPUT_DENIED');}
        if (project === this.namespace && (payload.synthetic !== true || payload.run !== this.namespace)) throw new LiveError('CREATE_NAMESPACE_DENIED');
        if (project === 'first_note' && (string('entity_type') !== 'note' || string('seed_id') !== 'welcome_v1' ||
          fields.creationFlags !== 1 || fields.minLifetime !== 43200n || json(payload) !== json({text: 'Hello, Arkiv'}))) throw new LiveError('EXACT_FIRST_NOTE_INPUT_REQUIRED');
        return {operation: 1, inputHash: this.viem.keccak256(operation.operationData), salt: fields.salt.toString(),
          flags: fields.creationFlags, expiresAt: fields.expiresAt.toString(), minLifetime: fields.minLifetime.toString()};
      }
      const owned = this.owned.get(lower(fields.entityKey));
      if (!owned || owned.deleted || owned.expired) throw new LiveError('FOREIGN_OR_RETIRED_ENTITY_DENIED');
      if (broadcast && operation.operation === 4) throw new LiveError('OWNERSHIP_BROADCAST_DENIED');
      if (broadcast && operation.operation === 2 && owned.flags & 1) throw new LiveError('READONLY_PATCH_BROADCAST_DENIED');
      return {operation: operation.operation, entityKey: lower(fields.entityKey), inputHash: this.viem.keccak256(operation.operationData),
        ...(operation.operation === 3 ? {expiresAt: fields.expiresAt.toString(), minLifetime: fields.minLifetime.toString()} : {})};
    });
    return operations;
  }
  async inspect(serialized) {
    const tx = this.viem.parseTransaction(serialized);
    const sender = lower(await this.viem.recoverTransactionAddress({serializedTransaction: serialized}));
    if (sender !== lower(this.account.address) || tx.chainId !== 7738577 || lower(tx.to) !== NATIVE_ADDRESS || (tx.value ?? 0n) !== 0n) throw new LiveError('SIGNED_TRANSACTION_SCOPE_DENIED');
    const operations = this.decodeOperations(tx.data, {broadcast: true});
    const feeCap = tx.maxFeePerGas ?? tx.gasPrice;
    if (!tx.gas || tx.gas <= 0n || feeCap === undefined || feeCap <= 0n || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) throw new LiveError('UNBOUNDED_TRANSACTION_DENIED');
    const committed = [...this.transactions.values()].reduce((sum, tx) => sum + BigInt(tx.actualCostWei ?? tx.reservedCostWei), 0n);
    if (committed + tx.gas * feeCap > this.maxSpend || this.transactions.size >= 10) throw new LiveError('SPEND_BUDGET_EXHAUSTED', {operational: true});
    if ([...this.transactions.values()].some(prior => prior.nonce === tx.nonce || !['confirmed_success', 'confirmed_revert'].includes(prior.state))) throw new LiveError('UNRESOLVED_OR_REUSED_NONCE_DENIED');
    if (BigInt(await this.rawRpc('eth_getBalance', [this.account.address, 'latest'])) < tx.gas * feeCap) throw new LiveError('SIGNER_INSUFFICIENT_FEE_BALANCE', {operational: true});
    const latest = BigInt(await this.rawRpc('eth_getTransactionCount', [this.account.address, 'latest']));
    const pending = BigInt(await this.rawRpc('eth_getTransactionCount', [this.account.address, 'pending']));
    if (latest !== pending || pending !== BigInt(tx.nonce)) throw new LiveError('EXCLUSIVE_WRITER_NONCE_REQUIRED', {operational: true});
    if (operations.some(operation => operation.operation === 1)) {
      const data = this.viem.encodeFunctionData({abi: this.nonceAbi, functionName: 'entityNonce', args: [this.account.address]});
      const raw = await this.rawRpc('eth_call', [{to: NATIVE_ADDRESS, data}, 'latest']);
      let mint = this.viem.decodeAbiParameters(this.viem.parseAbiParameters('uint64'), raw)[0];
      for (const operation of operations) if (operation.operation === 1) operation.expectedKey = lower(this.sdk.predictEntityKey({owner: this.account.address, nonce: mint++, salt: BigInt(operation.salt), chainId: 7738577}));
    }
    return {hash: this.viem.keccak256(serialized), sender, to: NATIVE_ADDRESS, chainId: 7738577, nonce: tx.nonce,
      gasLimit: tx.gas.toString(), feeCapWei: feeCap.toString(), reservedCostWei: (tx.gas * feeCap).toString(),
      calldataHash: this.viem.keccak256(tx.data), operations, caseId: this.caseId, preparedAtMs: this.clock(), state: 'prepared'};
  }
  async request(method, params) {
    try {return await this.requestOnce(method, params);}
    catch (error) {
      if (error instanceof LiveError && error.operational) {this.failure = error; this.stopped = true;}
      throw error;
    }
  }
  async requestOnce(method, params) {
    if (method !== 'eth_sendRawTransaction' && !reads.has(method)) throw new LiveError('RPC_METHOD_DENIED');
    if (method === 'eth_estimateGas') {
      if (lower(params[0]?.to) !== NATIVE_ADDRESS || lower(params[0]?.from) !== lower(this.account.address) || BigInt(params[0]?.value ?? '0x0') !== 0n) throw new LiveError('ESTIMATE_SCOPE_DENIED');
      this.decodeOperations(params[0]?.data);
    }
    if (method === 'eth_call') {
      if (lower(params[0]?.to) !== NATIVE_ADDRESS) throw new LiveError('READ_CONTRACT_SCOPE_DENIED');
      const call = this.viem.decodeFunctionData({abi: this.nonceAbi, data: params[0]?.data});
      if (call.functionName !== 'entityNonce' || lower(call.args[0]) !== lower(this.account.address)) throw new LiveError('READ_CONTRACT_SCOPE_DENIED');
    }
    if (method === 'eth_sendRawTransaction') {
      const previous = this.writeQueue;
      let release; this.writeQueue = new Promise(resolve => {release = resolve;});
      await previous;
      try {
        const candidate = await this.inspect(params[0]);
        this.transactions.set(candidate.hash, candidate); await this.record(candidate);
        let result;
        try { result = await this.rawRpc(method, params); }
        catch (error) { candidate.state = 'ambiguous'; this.stopped = true; await this.record({hash: candidate.hash, nonce: candidate.nonce, state: 'ambiguous'}); throw error; }
        if (lower(result) !== candidate.hash) { candidate.state = 'ambiguous'; this.stopped = true; await this.record({hash: candidate.hash, state: 'ambiguous_hash_mismatch'}); throw new LiveError('BROADCAST_HASH_MISMATCH'); }
        candidate.state = 'broadcast'; await this.record({hash: candidate.hash, nonce: candidate.nonce, state: 'broadcast'});
        return result;
      } finally { release(); }
    }
    const result = await this.rawRpc(method, params);
    if (method === 'eth_getTransactionReceipt' && result) {
      try { await this.observeReceipt(result, params[0]); }
      catch (error) {
        this.stopped = true;
        await this.record({hash: lower(params[0]), state: 'receipt_verification_stopped', code: error instanceof LiveError ? error.code : 'INVALID_RECEIPT'});
        throw error;
      }
    }
    return result;
  }
  async observeReceipt(receipt, requestedHash) {
    const attempt = this.transactions.get(lower(requestedHash));
    if (!attempt) throw new LiveError('FOREIGN_RECEIPT_DENIED');
    if (!/^0x[a-fA-F0-9]{64}$/.test(receipt.blockHash ?? '') ||
      !['blockNumber', 'gasUsed', 'effectiveGasPrice'].every(field => /^0x[a-fA-F0-9]+$/.test(receipt[field] ?? '')) ||
      BigInt(receipt.gasUsed) <= 0n || !Array.isArray(receipt.logs)) throw new LiveError('RECEIPT_SHAPE_INVALID');
    if (lower(receipt.transactionHash) !== attempt.hash || lower(receipt.from) !== attempt.sender || lower(receipt.to) !== NATIVE_ADDRESS || !['0x0', '0x1'].includes(receipt.status)) throw new LiveError('RECEIPT_PROVENANCE_MISMATCH');
    if (BigInt(receipt.gasUsed) > BigInt(attempt.gasLimit) || BigInt(receipt.effectiveGasPrice) > BigInt(attempt.feeCapWei)) throw new LiveError('RECEIPT_FEE_BOUNDS_MISMATCH');
    if (['confirmed_success', 'confirmed_revert'].includes(attempt.state)) return;
    const canonical = await this.rawRpc('eth_getTransactionByHash', [attempt.hash]);
    if (lower(canonical?.hash) !== attempt.hash || lower(canonical.from) !== attempt.sender || lower(canonical.to) !== NATIVE_ADDRESS ||
      BigInt(canonical.nonce) !== BigInt(attempt.nonce) || this.viem.keccak256(canonical.input) !== attempt.calldataHash ||
      lower(canonical.blockHash) !== lower(receipt.blockHash) || BigInt(canonical.blockNumber) !== BigInt(receipt.blockNumber)) throw new LiveError('CANONICAL_TRANSACTION_MISMATCH');
    const events = [];
    if (receipt.status === '0x1') for (const log of receipt.logs) {
      if (lower(log.address) !== NATIVE_ADDRESS) continue;
      if (lower(log.transactionHash) !== attempt.hash || lower(log.blockHash) !== lower(receipt.blockHash) || BigInt(log.blockNumber) !== BigInt(receipt.blockNumber) || log.removed) throw new LiveError('LOG_PROVENANCE_MISMATCH');
      try { events.push(this.viem.decodeEventLog({abi: this.sdk.ENTITY_EVENTS_ABI, topics: log.topics, data: log.data, strict: true})); }
      catch { throw new LiveError('UNKNOWN_NATIVE_RECEIPT_EVENT'); }
    }
    const names = {1: 'EntityCreated', 2: 'EntityPatched', 3: 'ExpiryExtended', 4: 'OwnershipTransferred', 5: 'EntityDeleted'};
    if (receipt.status === '0x1' && events.length !== attempt.operations.length) throw new LiveError('INCOMPLETE_NATIVE_RECEIPT');
    for (let index = 0; index < events.length; index++) {
      const event = events[index], operation = attempt.operations[index];
      if (event.eventName !== names[operation.operation] || lower(event.args.owner) !== attempt.sender ||
        lower(event.args.entityKey) !== (operation.expectedKey ?? operation.entityKey)) throw new LiveError('NATIVE_EVENT_OPERATION_MISMATCH');
      if ([1, 3].includes(operation.operation) && (event.args.expiresAt < BigInt(operation.expiresAt) || event.args.expiresAt < BigInt(receipt.blockNumber) + BigInt(operation.minLifetime))) throw new LiveError('NATIVE_EXPIRATION_MISMATCH');
      if (operation.operation === 1 && event.args.creationFlags !== operation.flags) throw new LiveError('NATIVE_FLAGS_MISMATCH');
    }
    const proof = {hash: attempt.hash, state: receipt.status === '0x1' ? 'confirmed_success' : 'confirmed_revert',
      blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash,
      gasUsed: BigInt(receipt.gasUsed).toString(), effectiveGasPriceWei: BigInt(receipt.effectiveGasPrice).toString(),
      actualCostWei: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(),
      events: events.map(event => ({name: event.eventName, entityKey: lower(event.args.entityKey),
        ...(event.args.expiresAt !== undefined ? {expiresAt: event.args.expiresAt.toString()} : {})}))};
    await this.record(proof); Object.assign(attempt, proof);
    for (let index = 0; index < events.length; index++) {
      const operation = attempt.operations[index], event = events[index];
      if (operation.operation === 1) this.owned.set(operation.expectedKey, {flags: operation.flags, expiresAt: event.args.expiresAt, deleted: false, expired: false});
      if (operation.operation === 3) this.owned.get(operation.entityKey).expiresAt = event.args.expiresAt;
      if (operation.operation === 5) this.owned.get(operation.entityKey).deleted = true;
    }
    if (proof.state === 'confirmed_revert') { this.stopped = true; throw new LiveError('TRANSACTION_REVERTED'); }
  }
  async openProxy() {
    this.proxy = http.createServer(async (request, response) => {
      try {
        if (request.method !== 'POST') throw new Error();
        let body = ''; for await (const chunk of request) {body += chunk; if (body.length > 131072) throw new Error();}
        const input = JSON.parse(body); if (Array.isArray(input) || typeof input.method !== 'string') throw new Error();
        try { const result = await this.request(input.method, input.params ?? []); response.writeHead(200, {'Content-Type': 'application/json'}).end(json({jsonrpc: '2.0', id: input.id, result})); }
        catch (error) { response.writeHead(200, {'Content-Type': 'application/json'}).end(json({jsonrpc: '2.0', id: input.id, error: {code: error.rpcCode ?? -32000, message: error instanceof LiveError ? error.code : 'OPERATOR_REJECTED', ...(error.data ? {data: error.data} : {})}})); }
      } catch { response.writeHead(400).end(); }
    });
    await new Promise(resolve => this.proxy.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${this.proxy.address().port}`;
  }
  proof() { return {transactions: [...this.transactions.values()], ownedEntityKeys: [...this.owned.keys()], rpcTrace: this.rpcTrace}; }
  async close() {
    this.stopped = true;
    if (this.proxy) {this.proxy.closeAllConnections(); await new Promise(resolve => this.proxy.close(resolve));}
    if (!this.journal) return {};
    await this.journalQueue;
    await this.journal.sync(); await this.journal.close();
    return {journalHash: hash(await readFile(this.journalPath))};
  }
}
