import {makeFixture} from '../snippets/rpc-fixture.mjs';

// Test-only transport: it exercises the operator and current SDK helpers without a real RPC.
export function liveFixture(dependencies, account) {
  const fixture = makeFixture(account.address); const transactions = new Map();
  const {viem, sdk} = dependencies;
  const executeAbi = viem.parseAbi(['function execute((uint8 operation,bytes operationData)[] ops) external returns(bytes32[] keys)']);
  const patchAbi = viem.parseAbiParameters('(bytes32 entityKey,(bytes32 name,uint8 typeId,bytes value)[] mutations)');
  const native = '0x4400000000000000000000000000000000000044';
  const readOnlyAbi = viem.parseAbi(['error ReadOnlyEntity(bytes32 entityKey)']);
  let advanceUntil = 0n;
  fixture.actualTransportCalls = 0;
  fixture.request = async (_url, input) => {
    fixture.actualTransportCalls++;
    const body = JSON.parse(input.body);
    const respond = result => Response.json({jsonrpc: '2.0', id: body.id, result});
    if (fixture.quota) return new Response('', {status: 429, headers: {'retry-after': '1700'}});
    if (body.method === 'eth_getTransactionByHash') {
      const tx = transactions.get(body.params[0]);
      return respond(fixture.forgedCanonical && tx ? {...tx, from: '0x2222222222222222222222222222222222222222'} : tx ?? null);
    }
    if (body.method === 'eth_blockNumber' && fixture.head < advanceUntil) fixture.head++;
    if (body.method === 'arkiv_query') for (const [key, entity] of fixture.entities) if (BigInt(entity.expiresAt) <= fixture.head) fixture.entities.delete(key);
    if (body.method === 'eth_estimateGas') {
      const decoded = viem.decodeFunctionData({abi: executeAbi, data: body.params[0].data});
      for (const op of decoded.args[0]) if (op.operation === 2) {
        const fields = viem.decodeAbiParameters(patchAbi, op.operationData)[0];
        if (fixture.entities.get(fields.entityKey)?.creationFlags & 1) return Response.json({jsonrpc: '2.0', id: body.id,
          error: {code: 3, message: 'Native readonly rejection', data: viem.encodeErrorResult({abi: readOnlyAbi, errorName: 'ReadOnlyEntity', args: [fields.entityKey]})}});
      }
    }
    const response = await fixture.fetch(_url, input); const result = await response.json();
    if (body.method !== 'eth_sendRawTransaction' || result.error) return Response.json(result);
    const tx = viem.parseTransaction(body.params[0]), hash = viem.keccak256(body.params[0]);
    const receipt = fixture.receipts.get(result.result); fixture.receipts.delete(result.result);
    const send = fixture.sends.at(-1); send.txHash = hash;
    const originals = [...receipt.logs]; let originalIndex = 0;
    const logs = send.decodedOps.map(({operation, value}) => {
      if ([1, 3].includes(operation)) {
        if (operation === 1 && value.minLifetime === 3n) advanceUntil = fixture.head + 4n;
        return originals[originalIndex++];
      }
      const eventName = operation === 2 ? 'EntityPatched' : 'EntityDeleted';
      return {address: native, topics: viem.encodeEventTopics({abi: sdk.ENTITY_EVENTS_ABI, eventName, args: {entityKey: value.entityKey, owner: account.address}}), data: '0x'};
    });
    Object.assign(receipt, {transactionHash: hash, logs: logs.map((log, index) => ({...log, transactionHash: hash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber, transactionIndex: '0x0', logIndex: '0x' + index.toString(16), removed: false}))});
    if (fixture.forgedReceipt) receipt.from = '0x2222222222222222222222222222222222222222';
    if (fixture.missingEvent) receipt.logs = [];
    fixture.receipts.set(hash, receipt);
    transactions.set(hash, {hash, from: account.address, to: tx.to, nonce: '0x' + tx.nonce.toString(16), input: tx.data,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash});
    if (fixture.lostBroadcast) throw new Error('Synthetic accepted response lost');
    result.result = fixture.wrongHash ? '0x' + 'ff'.repeat(32) : hash;
    return Response.json(result);
  };
  return fixture;
}
