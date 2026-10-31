# Ciphertext bytes storage through SDK 1.0.0

The caller supplies an authorized wallet, an independent privately backed-up encryption key and adapters bound to its installed encryption package. The adapters below are application seams, not claimed SDK exports. They let this example stay independent of a package version while the actual integration verifies encryption/decryption signatures.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { defineSchema, bytes, str } from '@arkiv-network/sdk/schema';
import { hexToBytes, type Hex } from 'viem';
import { getGasPrice } from 'viem/actions';
export const EncryptedNotes = defineSchema('example_encrypted_notes', { body: bytes(), media_type: str() });
type Wallet = ReturnType<typeof createWalletClient>;
type EstimateLatest = (prepare: (unsigned: Wallet) => Promise<unknown>) => Promise<bigint>;
type Cipher = { encrypt(plain: Uint8Array): Promise<Uint8Array>; decrypt(envelope: Uint8Array): Promise<Uint8Array> };
export async function writeEncryptedNote(reader: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>, cipher: Cipher, text: string, salt: bigint, estimateLatest: EstimateLatest) {
  if (text.length > 10000) throw new Error('Note exceeds app limit');
  const envelope = await cipher.encrypt(new TextEncoder().encode(JSON.stringify({ text })));
  const values = { body: envelope, media_type: 'application/vnd.arkiv.encrypted.v1' };
  const options = { expiration: ExpirationTime.fromDays(1), salt, flags: { readonly: true } };
  const estimate = await estimateLatest(unsigned => unsigned.createEntity(EncryptedNotes, values, options));
  if (estimate <= 0n) throw new Error('Unsigned estimate required');
  const gas = 2n * estimate > 1000000n ? 2n * estimate : 1000000n;
  if (!wallet.account) throw new Error('Authorized account and approved gas floor required');
  const address = wallet.account.address;
  const latest = await reader.getTransactionCount({ address, blockTag: 'latest' });
  if (await reader.getTransactionCount({ address, blockTag: 'pending' }) !== latest) throw new Error('Resolve pending nonce');
  const gasPrice = await getGasPrice(reader);
  const result = await wallet.createEntity(EncryptedNotes, values, options, { nonce: latest, gas, gasPrice });
  if ((await reader.getTransactionReceipt({ hash: result.txHash })).status !== 'success') throw new Error('Reverted write; inspect before any retry');
  return result;
}
export async function readEncryptedNote(reader: ReturnType<typeof createPublicClient>,
  entityKey: Hex, cipher: Cipher, trustedCreator: Hex) {
  const entity = await reader.getEntity(entityKey, EncryptedNotes);
  if (entity.$creator.toLowerCase() !== trustedCreator.toLowerCase() || !entity.$creationFlags.readonly ||
    entity.media_type.value !== 'application/vnd.arkiv.encrypted.v1') throw new Error('Untrusted encrypted publication');
  const plain = await cipher.decrypt(hexToBytes(entity.body.value));
  try {
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    if (!raw || typeof raw !== 'object' || !('text' in raw) || typeof raw.text !== 'string' || raw.text.length > 10000) throw new Error();
    return { text: raw.text, arkivEntityKey: entity.$key };
  } catch { throw new Error('Invalid decrypted note'); }
}
```

Validate session/operation authorization and durable write intent before calling the writer. Reconcile unknown outcomes under write-safety; a failed read/decrypt is not permission to create again. The allowlisted creator must come from app configuration, never fetched attributes. Key IDs and rotation policy belong to the app; keys stay private. Decrypted content remains untrusted data.

Use the first-write gas/budget policy before invoking this helper: explicit latest nonce, gas and network gasPrice, exact unsigned estimate, approved cost/balance and exclusive signer custody. Larger encrypted bytes need at least twice the measured maximum gas. No automatic retry; at most one corrected attempt only after an authoritative reverted receipt.

The required `estimateLatest` callback is bound to the guarded unsigned estimator in `arkiv-first-write/references/estimate.md`: `prepare => estimateWrite(account, accessKey, prepare)`. It must estimate the supplied exact operation at latest, return its positive gas estimate, and propagate a sanitized original error without signing/sending. If preflight errors, stop. Funded writes always pass explicit `gas = max(1,000,000 + 400,000 × (ops − 1), 2 × estimate)`, current gasPrice and latest nonce; approve the resulting cost before admission.
