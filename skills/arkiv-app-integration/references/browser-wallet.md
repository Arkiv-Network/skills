# Injected wallet connection on Rabdi

Run this in a user-triggered interaction. The user supplies their own free RPC key from [Hub access keys](https://hub.arkiv.network/access-keys); never give a browser the operator's server key. The chain definition embeds that key in its URL. Do not log the provider, chain object or raw errors.

```typescript
import { createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { custom, isAddress, type EIP1193Provider } from 'viem';

export async function connectArkivWallet(provider: EIP1193Provider, userAccessKey: string) {
  const chain = rabdi({ accessKey: userAccessKey });
  const addresses = await provider.request({ method: 'eth_requestAccounts' });
  const account = addresses[0];
  if (!account || !isAddress(account)) throw new Error('Connect a valid account');
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x76edaf' }] });
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x76edaf',
      chainName: 'Rabdi', nativeCurrency: chain.nativeCurrency,
      rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: [chain.blockExplorers.default.url] }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x76edaf' }] });
  }
  const actualChain = await provider.request({ method: 'eth_chainId' });
  if (BigInt(actualChain) !== 7794095n) throw new Error('Wallet is not on Rabdi');
  const current = await provider.request({ method: 'eth_accounts' });
  if (current[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('Account changed during connection');
  return createWalletClient({ chain, account, transport: custom(provider) });
}
```

Address-format validation does not prove EOA or account-abstraction compatibility. This helper requests connection/network configuration; it sends no entity transaction. Respect user rejection. Recheck account, chain, entity authorization and budget before signing.

Handle accountsChanged, chainChanged and disconnect by changing cache scope, clearing pending UI state and guarding late responses. Remove only your own listeners. Reconstruct a wallet client after address changes. App login and faucet sign-in are separate from wallet/RPC access.

Verify the intended wallet's unsigned request, nonce, selected RPC and approved transaction on Rabdi before claiming wallet-specific behavior. A local SDK signer test does not establish injected-wallet compatibility. Do not diagnose nonce problems from a generic RPC execution message alone.

Source: [SDK chain](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/chains/rabdi.ts), [wallet client](https://unpkg.com/@arkiv-network/sdk@1.0.0/src/clients/createWalletClient.ts).
