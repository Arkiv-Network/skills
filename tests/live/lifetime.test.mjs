import {safeProviderError,safeProviderDiagnostic} from '../../scripts/safe-rpc-error.mjs';
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
    console.error(JSON.stringify({ probe: 'maximum-lifetime', ...safeProviderDiagnostic(error, 'lifetime') }));
    throw safeProviderError(error, 'lifetime');
  }
});
