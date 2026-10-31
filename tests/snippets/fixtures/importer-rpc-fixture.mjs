// In-memory create-only RPC fixture. SDK/viem modules come from the caller's
// existing test workspace; this module creates no HTTP transport or funded send.
export function makeFixture(owner, { sdk, viem, chains, attr }) {
  const { createPublicClient, predictEntityKey, ENTITY_EVENTS_ABI } = sdk;
  const chain = chains.rabdi({ accessKey: "synthetic-offline-key" });
  const { decFromUnits } = attr;
  const {
    custom, decodeFunctionData, decodeAbiParameters, encodeAbiParameters,
    encodeEventTopics, parseAbi, parseAbiParameters, hexToBytes,
    parseTransaction, keccak256, recoverTransactionAddress,
  } = viem;
  const execute = parseAbi(['function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)']);
  const nonceAbi = parseAbi(['function entityNonce(address owner) external view returns(uint64)']);
  const createParams = parseAbiParameters('(uint128 salt,uint64 expiresAt,uint64 minLifetime,uint8 creationFlags,(bytes32 name,uint8 typeId,bytes value)[] attributes)');
  const names = { 1: 'bool', 2: 'i32', 3: 'u64', 4: 'u256', 5: 'dec', 7: 'bytes', 8: 'str', 9: 'addr', 10: 'key' };
  const text = hex => new TextDecoder().decode(hexToBytes(hex)).replace(/\0+$/, '');
  const hex = value => '0x' + BigInt(value).toString(16);
  const native = '0x4400000000000000000000000000000000000044';
  const blockHash = '0x' + 'aa'.repeat(32);
  const fixture = {
    head: 4096n, owner, balance: 10n ** 18n, entities: new Map(), nonces: new Map(),
    sends: [], methods: [], queries: [], receipts: new Map(), transactions: new Map(),
  };
  function decodeAttribute(cell) {
    const tag = cell.typeId & 0x7f;
    const type = names[tag];
    const value = [7, 8].includes(tag) ? (tag === 7 ? cell.value : text(cell.value))
      : tag === 1 ? BigInt(cell.value) !== 0n
        : tag === 2 ? Number(BigInt.asIntN(32, BigInt(cell.value)))
          : tag === 5 ? decFromUnits(BigInt.asIntN(256, BigInt(cell.value))).value
            : tag === 9 ? '0x' + cell.value.slice(-40) : cell.value;
    return { name: text(cell.name), type, value, indexed: Boolean(cell.typeId & 0x80) };
  }
  async function request({ method, params = [] }) {
    fixture.methods.push(method);
    if (method === 'eth_chainId') return '0x76edaf';
    if (method === 'eth_blockNumber') return hex(fixture.head);
    if (method === 'eth_getBalance') return hex(fixture.balance);
    if (method === 'eth_getTransactionCount') return hex((params[1] === 'pending' ? fixture.pendingNonce : fixture.latestNonce) ?? fixture.sends.length);
    if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x1';
    if (method === 'eth_fillTransaction') throw { code: -32601, message: 'Optional method unavailable in local fixture' };
    if (method === 'eth_estimateGas') return hex(fixture.estimatedGas ?? 100000n);
    if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'latest' ? fixture.head : BigInt(params[0]);
      return {
        number: hex(number), hash: number === 0n ? '0x' + 'ab'.repeat(32) : blockHash,
        baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x1', timestamp: '0x6553f100',
        transactions: [...fixture.transactions.values()].filter(tx => BigInt(tx.blockNumber) === number).map(tx => tx.hash),
      };
    }
    if (method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: nonceAbi, data: params[0].data });
      return encodeAbiParameters(parseAbiParameters('uint64'), [fixture.nonces.get(decoded.args[0].toLowerCase()) ?? 0n]);
    }
    if (method === 'eth_getTransactionReceipt') return fixture.hideReceipts ? null : fixture.receipts.get(params[0]);
    if (method === 'eth_getTransactionByHash') return fixture.transactions.get(params[0]);
    if (method === 'arkiv_query') {
      const [query, options] = params;
      fixture.queries.push(params);
      let entities = fixture.hideEntities ? [] : [...fixture.entities.values()];
      const wantedKey = /\$key = key\((0x[0-9a-fA-F]+)\)/.exec(query)?.[1];
      if (wantedKey) entities = entities.filter(entity => entity.key === wantedKey);
      const start = options.offset ? Number(BigInt(options.offset)) : 0;
      const count = Math.min(2, options.limit ? Number(BigInt(options.limit)) : 2);
      const selected = entities.slice(start, start + count).map(entity => Object.fromEntries(Object.entries(entity)
        .filter(([name]) => options.select[name]).map(([name, value]) => [name,
          name === 'attributes' && typeof options.select.attributes === 'object'
            ? value.filter(cell => options.select.attributes[cell.name]) : value])));
      return { blockNumber: hex(fixture.head), data: selected, ...(options.select.count ? { count: hex(entities.length) } : {}) };
    }
    if (method === 'eth_sendRawTransaction') {
      if (fixture.beforeSend) await fixture.beforeSend({ method, params });
      const tx = { ...parseTransaction(params[0]), from: await recoverTransactionAddress({ serializedTransaction: params[0] }) };
      const actor = tx.from.toLowerCase();
      const operations = decodeFunctionData({ abi: execute, data: tx.data }).args[0];
      const txHash = keccak256(params[0]), logs = [], decodedOps = [];
      for (const operation of operations) {
        if (operation.operation !== 1) throw new Error('Create-only fixture refuses another operation');
        const value = decodeAbiParameters(createParams, operation.operationData)[0];
        decodedOps.push({ operation: operation.operation, value });
        const mint = fixture.nonces.get(actor) ?? 0n;
        const key = predictEntityKey({ owner: tx.from, nonce: mint, salt: value.salt, chainId: chain.id });
        fixture.nonces.set(actor, mint + 1n);
        const cells = value.attributes.map(decodeAttribute);
        const expiresAt = BigInt(value.expiresAt) > fixture.head + value.minLifetime ? BigInt(value.expiresAt) : fixture.head + value.minLifetime;
        fixture.entities.set(key, {
          key, owner: tx.from, creator: tx.from, createdAt: hex(fixture.head), updatedAt: hex(fixture.head),
          expiresAt: hex(expiresAt), creationFlags: value.creationFlags,
          attributes: cells.map(({ indexed, ...attribute }) => attribute),
          attributeSchema: cells.map(({ name, type, indexed }) => ({ name, type, indexed })),
        });
        logs.push({
          address: native,
          topics: encodeEventTopics({ abi: ENTITY_EVENTS_ABI, eventName: 'EntityCreated', args: { entityKey: key, owner: tx.from } }),
          data: encodeAbiParameters(parseAbiParameters('uint64,uint8'), [expiresAt, value.creationFlags]),
        });
      }
      fixture.sends.push({ txHash, operationTags: operations.map(operation => operation.operation), decodedOps });
      fixture.transactions.set(txHash, {
        hash: txHash, from: tx.from, to: tx.to, input: tx.data, value: hex(tx.value ?? 0),
        nonce: hex(tx.nonce ?? fixture.sends.length - 1), gas: hex(tx.gas ?? 100000),
        chainId: hex(tx.chainId ?? chain.id), gasPrice: hex(tx.gasPrice ?? tx.maxFeePerGas ?? 1),
        ...(tx.maxFeePerGas === undefined ? {} : { maxFeePerGas: hex(tx.maxFeePerGas), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas) }),
        blockHash, blockNumber: hex(fixture.head), transactionIndex: '0x0',
        type: tx.type === 'eip1559' ? '0x2' : '0x0', v: hex(tx.v ?? 27),
        r: tx.r ?? '0x' + '00'.repeat(32), s: tx.s ?? '0x' + '00'.repeat(32),
      });
      fixture.receipts.set(txHash, {
        status: '0x1', transactionHash: txHash, blockHash, blockNumber: hex(fixture.head), transactionIndex: '0x0',
        gasUsed: '0x1', cumulativeGasUsed: '0x1', effectiveGasPrice: '0x1', from: tx.from, to: native, contractAddress: null,
        logs: logs.map((log, index) => ({ ...log, blockNumber: hex(fixture.head), blockHash, transactionHash: txHash, transactionIndex: '0x0', logIndex: hex(index), removed: false })),
        logsBloom: '0x' + '00'.repeat(256), type: '0x0',
      });
      if (fixture.broadcastResponseLost) throw new Error('Synthetic response lost after acceptance');
      return txHash;
    }
    throw new Error('Unexpected offline fixture RPC method ' + method);
  }
  fixture.request = request;
  fixture.reader = createPublicClient({ chain, transport: custom({ request }, { retryCount: 0 }), cacheTime: 0 });
  return fixture;
}
