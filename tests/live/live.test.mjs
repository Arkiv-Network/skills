import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { seedRabdi } from '../../scripts/seed-rabdi.mjs';

test('Rabdi real SDK seed, flat reads, filtered counts, ordering, optional values and zero-send repeat', async () => {
  const metrics = { queries: 0, signatures: 0, broadcasts: 0 };
  try {
  const first = await seedRabdi(metrics);
  const { reader, Seed, sdk, query } = first;
  const filtered = await reader.select({ $key: true, rank: true, body: true }).from(Seed)
    .createdBy(first.summary.signer).where(query.gte('rank', sdk.u64(2n)))
    .orderBy(query.desc('rank')).withCount().limit(1).offset(1).fetch();
  assert.equal(filtered.count, 2n);
  assert.equal(filtered.entities.length, 1);
  assert.equal(filtered.entities[0].rank.value, 2n);
  const direct = await reader.getEntity(filtered.entities[0].$key, Seed);
  assert.equal(direct.body.value, filtered.entities[0].body.value);
  assert.equal(direct.$creator.toLowerCase(), first.summary.signer.toLowerCase());
  assert.equal(direct.active.value, true);
  assert.equal(direct.note, undefined);
  await assert.rejects(reader.select({ $key: true }).from(Seed).where(query.eq('media_type', 'application/json')).fetch(), query.InvalidPredicateError);
  const second = await seedRabdi(metrics);
  assert.equal(second.summary.signatures, 0);
  assert.equal(second.summary.broadcasts, 0);
  assert.deepEqual(second.summary.entityKeys, first.summary.entityKeys);
  assert.deepEqual(second.summary.transactionHashes, first.summary.transactionHashes);
  const summary = { passed: true, first: first.summary, repeat: second.summary,
    queries: metrics.queries, metrics, keyBQueries: 0,
    assertions: 'real write/readback, indexed filter, server sort/offset/count, schema/default/optional, nonindexed rejection, repeat zero signatures/broadcasts' };
  console.log(JSON.stringify(summary));
  if (process.env.ARKIV_EVIDENCE_DIR) {
    await fs.mkdir(process.env.ARKIV_EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.ARKIV_EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
  }
  } catch (error) {
    const causes = [];
    let cause = error;
    while (cause && typeof cause === 'object' && causes.length < 12) {
      causes.push({ name: typeof cause.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(cause.name) ? cause.name : 'Unknown',
        code: typeof cause.code === 'number' || cause.code === 'ERR_ASSERTION' ? cause.code : undefined,
        status: typeof cause.status === 'number' ? cause.status : undefined,
        txHash: typeof cause.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(cause.txHash) ? cause.txHash : undefined,
        assertion: cause.code === 'ERR_ASSERTION' ? cause.message : undefined,
        frames: typeof cause.stack === 'string' ? cause.stack.split('\n').filter(line => /^\s+at /.test(line) && /(?:scripts\/seed-rabdi|tests\/live\/live.test)\.mjs:\d+/.test(line)) : undefined });
      cause = cause.cause;
    }
    if (process.env.ARKIV_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.ARKIV_EVIDENCE_DIR, 'live-failure.json'), JSON.stringify({ causes, metrics }, null, 2));
    throw new Error('Live Rabdi check failed; sanitized cause classes: ' + causes.map(c => c.name).join(' → '));
  }
});
