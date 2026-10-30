import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, dec } from '@arkiv-network/sdk/schema';
import { asc, eq } from '@arkiv-network/sdk/query';
const Model = defineSchema('compile_contract', {
  app_id: str().indexed(), amount: dec().indexed(), title: str(), body: bytes(), note: str().optional(),
});
declare const reader: ReturnType<typeof createPublicClient>;
declare const wallet: ReturnType<typeof createWalletClient>;
declare const entityKey: `0x${string}`;
reader.select({ $key: true, body: true }).from(Model).where(eq('amount', dec('1.5'))).orderBy(asc('title'));
// @ts-expect-error A stored unindexed column is not a filter.
reader.select({ $key: true }).from(Model).where(eq('title', 'x'));
// @ts-expect-error A binary column has no indexed refinement.
bytes().indexed();
// @ts-expect-error The predicate must preserve the column's declared dec type.
reader.select({ $key: true }).from(Model).where(eq('amount', 1));
// @ts-expect-error A bytes column cannot be sorted.
reader.select({ $key: true }).from(Model).orderBy(asc('body'));
// @ts-expect-error Required values must be present.
wallet.createEntity(Model, { app_id: 'x' }, { expiration: ExpirationTime.fromDays(1) });
// @ts-expect-error Only optional columns may be unset.
wallet.patchEntity(Model, entityKey, { unset: ['app_id'] });
wallet.patchEntity(Model, entityKey, { unset: ['note'] });
async function narrowProjection() {
  const page = await reader.select({ $key: true, title: true }).from(Model).fetch();
  const row = page.entities[0];
  if (!row) return;
  row.$key;
  row.title.value;
  // @ts-expect-error Unselected columns are unavailable.
  row.amount.value;
}
export { narrowProjection };
