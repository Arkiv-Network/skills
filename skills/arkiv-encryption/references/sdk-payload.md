# Ciphertext storage through SDK 1.0.0

The caller supplies an authorized wallet, an independent privately backed-up encryption key and adapters bound to its installed encryption package. The adapters below are application seams, not claimed SDK exports. They let this example stay independent of a package version while the actual integration verifies encryption/decryption signatures.

```typescript
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { defineSchema, bytes, str } from '@arkiv-network/sdk/schema';
import { hexToBytes, type Hex } from 'viem';
export const EncryptedNotes = defineSchema('example_encrypted_notes', { body: bytes(), media_type: str() });
type Cipher = { encrypt(plain: Uint8Array): Promise<Uint8Array>; decrypt(envelope: Uint8Array): Promise<Uint8Array> };
export async function writeEncryptedNote(wallet: ReturnType<typeof createWalletClient>, cipher: Cipher, text: string) {
  if (text.length > 10000) throw new Error('Note exceeds app limit');
  const envelope = await cipher.encrypt(new TextEncoder().encode(JSON.stringify({ text })));
  return wallet.createEntity(EncryptedNotes, { body: envelope, media_type: 'application/vnd.arkiv.encrypted.v1' },
    { expiration: ExpirationTime.fromDays(1), flags: { readonly: true } });
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
