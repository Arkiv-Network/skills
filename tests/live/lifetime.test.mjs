import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { probeRabdiLifetime } from '../../scripts/probe-rabdi-lifetime.mjs';
test('one durable Rabdi maximum-lifetime negative create, reconciled without retry', async () => {
  try {
    const summary = await probeRabdiLifetime();
    if (process.env.ARKIV_EVIDENCE_DIR) await fs.writeFile(path.join(process.env.ARKIV_EVIDENCE_DIR, 'lifetime-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } catch (error) {
    // Assertion messages are local; do not echo raw RPC errors/keyed URLs.
    console.error(JSON.stringify({ probe: 'maximum-lifetime', errorName: error.name,
      assertion: error.code === 'ERR_ASSERTION' ? error.message : undefined }));
    throw new Error('Lifetime probe stopped; reconcile its private journal before any new write');
  }
});
