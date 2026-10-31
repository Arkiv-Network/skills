# Readonly publication gate

Configure trusted creator addresses independently of fetched data. Read the selected row from the intended Rabdi client; a caller-supplied metadata object alone is not evidence. The following schema bounds public title/content by app validation after decoding bytes.

```typescript
import { createPublicClient } from '@arkiv-network/sdk';
import { defineSchema, bytes, str, addr } from '@arkiv-network/sdk/schema';
import { eq, or } from '@arkiv-network/sdk/query';
import { hexToBytes, type Address, type Hex } from 'viem';
export const Posts = defineSchema('example_posts', { media_type: str(), body: bytes() });
type Publication = { $key: Hex; $creator: Hex; $creationFlags: { readonly: boolean };
  media_type: { value: string }; body: { value: Hex } };
export function trustedReadonlyPost(entity: Publication, trustedCreators: ReadonlySet<string>) {
  if (!trustedCreators.has(entity.$creator.toLowerCase())) throw new Error('Untrusted creator');
  if (!entity.$creationFlags.readonly) throw new Error('Mutable publication');
  if (entity.media_type.value !== 'application/json') throw new Error('Unsupported format');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(entity.body.value))); }
  catch { throw new Error('Invalid publication data'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    !('title' in raw) || typeof raw.title !== 'string' || raw.title.length < 1 || raw.title.length > 200 ||
    !('content' in raw) || typeof raw.content !== 'string' || raw.content.length > 10000) throw new Error('Invalid publication data');
  return { title: raw.title, content: raw.content, arkivEntityKey: entity.$key };
}
export async function readPublicationPage(client: ReturnType<typeof createPublicClient>, creators: readonly Address[]) {
  if (!creators.length || creators.length > 20) throw new Error('Invalid creator budget');
  return client.select({ $key: true, $creator: true, $creationFlags: true, media_type: true, body: true })
    .from(Posts, { onMismatch: 'throw' }).where(or(...creators.map(a => eq('$creator', addr(a)))))
    .limit(20).fetch();
}
export function renderPost(element: HTMLElement, post: ReturnType<typeof trustedReadonlyPost>) {
  element.textContent = `${post.title}\n${post.content}`;
}
```

This reader returns one bounded page, not a whole feed. Use the query skill's keyset/mismatch rules when complete traversal is required. A returned schema row still needs the creator/readonly gate before use. Namespace/tag scoping is not authorization. Current ownership may separately affect availability but does not authenticate mutable values.

Keep agent system policy constant and place serialized publications in a data message. Delimiters and roles do not enforce tool safety; external effects require independent authorization outside model-generated arguments. A signed version needs trusted signer/context binding, canonical values and a freshness policy. Missing mutation history leaves mutable authorship unresolved.
