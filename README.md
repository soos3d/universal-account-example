# Universal Account Example

Runnable TypeScript examples for the [@particle-network/universal-account-sdk](https://developers.particle.network/) (v1.1.1+). Universal Account abstracts cross-chain complexity into a single unified balance and address — you can buy, sell, transfer, and swap tokens across EVM chains and Solana without managing bridges or per-chain gas tokens.

## Prerequisites

- Node.js >= 18
- yarn (or npm — `tsx` is included as a dev dependency)
- A [Particle Network](https://dashboard.particle.network/) project with a `projectId`, `projectClientKey`, and `projectAppUuid`

## Quick Start

1. `yarn`
2. Copy `.env.example` to `.env` and fill in your credentials (see [Environment Variables](#environment-variables))
3. Run any example:

```bash
npx tsx examples/buy-solana.ts
```

After sending a transaction, examples print a link to `https://universalx.app/activity/details?id=<transactionId>` where you can track its status.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PRIVATE_KEY` | Yes | EVM private key used by `ethers.Wallet` |
| `PROJECT_ID` | Yes | Particle Network project ID |
| `PROJECT_CLIENT_KEY` | Yes | Particle Network project client key |
| `PROJECT_APP_UUID` | Yes | Particle Network project app UUID |
| `EVM_RPC_<chainId>` | Situational | RPC URL for a specific chain (e.g. `EVM_RPC_56` for BSC, `EVM_RPC_137` for Polygon). Required by EIP-7702 examples. |
| `UNIVERSAL_ACCOUNT_VERSION` | No | Override the SDK smart account version (defaults to the SDK constant) |
| `UNIVERSALX_WSS_URL` | No | Override the WebSocket endpoint (defaults to `wss://universal-app-ws-proxy.particle.network`) |

Get your project credentials from the [Particle Network Dashboard](https://dashboard.particle.network/).

## Examples

### Buy / Sell

| Example | Description |
| --- | --- |
| [buy-evm.ts](examples/buy-evm.ts) | Buy EVM tokens |
| [buy-solana.ts](examples/buy-solana.ts) | Buy Solana tokens |
| [sell-evm.ts](examples/sell-evm.ts) | Sell EVM tokens |
| [sell-solana.ts](examples/sell-solana.ts) | Sell Solana tokens |

### Transfer

| Example | Description |
| --- | --- |
| [transfer-evm.ts](examples/transfer-evm.ts) | Transfer EVM tokens |
| [transfer-solana.ts](examples/transfer-solana.ts) | Transfer Solana tokens |

### Convert

| Example | Description |
| --- | --- |
| [convert-evm.ts](examples/convert-evm.ts) | Convert tokens on EVM |
| [convert-solana.ts](examples/convert-solana.ts) | Convert tokens on Solana |

### Custom Transaction

| Example | Description |
| --- | --- |
| [custom-transaction-evm-with-money.ts](examples/custom-transaction-evm-with-money.ts) | EVM contract call with fund bridging |
| [custom-transaction-evm-no-money.ts](examples/custom-transaction-evm-no-money.ts) | EVM transaction without funding |
| [custom-transaction-solana-with-money.ts](examples/custom-transaction-solana-with-money.ts) | Solana instruction with USDC transfer |
| [custom-transaction-solana-no-money.ts](examples/custom-transaction-solana-no-money.ts) | Solana instruction without funding |

### EIP-7702

| Example | Description |
| --- | --- |
| [7702-create-delegated.ts](examples/7702-create-delegated.ts) | Create delegated account with EIP-7702 |
| [7702-convert-evm.ts](examples/7702-convert-evm.ts) | Convert tokens using EIP-7702 mode |

### Query

| Example | Description |
| --- | --- |
| [get-primary-asset.ts](examples/get-primary-asset.ts) | Get primary assets and USD values |
| [get-transactions.ts](examples/get-transactions.ts) | Query transaction history |

### WebSocket

Universal Account provides a WebSocket endpoint for real-time push notifications. The default URL is `wss://universal-app-ws-proxy.particle.network` (configurable via `UNIVERSALX_WSS_URL`). All channels share the same connection and heartbeat mechanism (ping/pong every 5s).

| Example | Description |
| --- | --- |
| [transaction-status-wss.ts](examples/transaction-status-wss.ts) | Track transaction status via `address-update` channel |
| [user-assets-wss.ts](examples/user-assets-wss.ts) | Subscribe to real-time balance updates via `user-assets` channel |

#### `address-update` — Transaction Status

Subscribe with your UA addresses to receive real-time transaction status updates.

```jsonc
// Subscribe
{ "type": "subscribe", "channel": "address-update", "params": { "addresses": ["0x...", "solana_address"] } }

// Incoming message
{ "type": "transaction_update", "channel": "address-update", "data": { "transactionId": "...", "status": 7, "sender": "..." } }
// status: 7 = success, 11 = failure
```

See [transaction-status-wss.ts](examples/transaction-status-wss.ts) for a complete example that sends a transaction and waits for confirmation via WebSocket.

#### `user-assets` — Real-time Balance Updates

Subscribe with your smart account options to receive asset balance changes across all chains.

```jsonc
// Subscribe
{
  "type": "subscribe",
  "channel": "user-assets",
  "params": {
    "ownerAddress": "0x...",
    "name": "UNIVERSAL",
    "version": "1.0.3",
    "useEIP7702": false,
    "solanaAccountIndex": "SOLANA_ACCOUNT_INDEX.CLASSIC"  // optional, use with EIP-7702 mode
  }
}

// Incoming message
{
  "channel": "user-assets",
  "data": {
    "assets": [
      { "chainId": 56, "address": "0x...", "amountOnChain": "10000000000000000000", "isToken2022": false, "accountExists": true }
    ]
  }
}
```

The `solanaAccountIndex` param is optional and only relevant when using EIP-7702 mode. It controls which Solana address is used for asset tracking:

| Constant | Description |
| --- | --- |
| `SOLANA_ACCOUNT_INDEX.CLASSIC` | Use the classic Solana smart account address |
| `SOLANA_ACCOUNT_INDEX.EIP7702` | Use the EIP-7702 derived Solana address |

See [user-assets-wss.ts](examples/user-assets-wss.ts) for a complete example that listens for balance updates in real time.

### Other

| Example | Description |
| --- | --- |
| [warmup.ts](examples/warmup.ts) | Initialize the SDK, resolve smart account addresses, and pre-fetch a token pair without sending a transaction |
| [polymarket.ts](examples/polymarket.ts) | Place a Polymarket prediction market trade via Universal Account |
| [test-svm-balance.ts](examples/test-svm-balance.ts) | Solana token balance helpers used for integration testing |

## Benchmark

For transaction speed benchmarking, see [universal-account-benchmark](https://github.com/Particle-Network/universal-account-benchmark/).
