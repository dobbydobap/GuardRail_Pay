# GuardRail Pay / AgentVault

Runtime payment firewall for AI agents on Monad Testnet.

AI agents can request payments, but funds only move after `AgentVault` enforces on-chain policy. Unsafe requests are blocked on-chain and still emit receipts for the demo.

## Why This Exists

Autonomous agents can be tricked by tool output, prompt injection, or bad routing. A normal wallet lets the agent sign whatever it decides. GuardRail Pay puts a smart contract policy layer between the agent and the funds:

- safe API/tool payments can go through
- verifier work can be paid through escrow
- prompt-injection payment attempts are blocked
- overspend or unapproved-recipient attempts are blocked
- every decision emits an event the backend/frontend can show

This is the core hackathon idea: **the AI can be fooled, but the wallet policy cannot be bypassed by the prompt.**

## Contracts

### `AgentRegistry.sol`

Owns setup and policy metadata:

- register agent addresses
- register recipient/tool/verifier addresses
- allow or block recipients
- track suspicious count per agent
- freeze agents after repeated blocked attempts
- expose read functions for `AgentVault`

### `AgentVault.sol`

Owns funds and enforcement:

- accepts native MON deposits
- lets registered agents request payments
- checks policy before transfer
- emits `PaymentApproved` for safe payments
- emits `PaymentBlocked` for unsafe payments
- creates verifier escrow
- lets verifier approve and release escrow

## Policy Rules

`AgentVault` blocks a payment when:

- agent is not registered
- agent is frozen
- recipient is not allowlisted
- amount is zero
- amount exceeds `maxPerPayment`
- daily spend exceeds `dailyLimit`
- deposited vault balance is insufficient
- reason contains one of:
  - `ignore previous`
  - `transfer all`
  - `override policy`
  - `send everything`
  - `bypass`

Blocked payments do not transfer funds. They emit `PaymentBlocked` and increment the agent's suspicious count in `AgentRegistry`.

## Deployed on Monad Testnet

```env
CONTRACT_ADDRESS_AGENT_REGISTRY=0x3b49D866741aDF970bF8E41AB359662C66432C09
CONTRACT_ADDRESS_AGENT_VAULT=0x49b66b94828878c5c5bFc1a497956D2A80Fc11E4
```

Demo wallet used:

```txt
0x3a6F06de4355530c8F7b25e5EaA37fB6D3561804
```

Sample transactions:

```txt
Register agent:
0xa9306d822323ad40c49bee0a4e8236da2c00b4361c6767d5faf4662cd94a49bd

Register allowlisted recipient:
0x314146e8ca70c7371dd287886ad964c33a8ba222e0d78f921a394b26144df852

Deposit MON into AgentVault:
0x3092221cfa15f2fa2b853b8457007da41c767821b2b04e78780be28ee3301f5d

Approved payment:
0xc6379767983e39e8aae62569ba0e3b46d5f7c8cb43ba9f065ae75e9d43da17da

Blocked prompt-injection payment:
0x92f1cce24939c99bd14128eacc55038e407815ca526b5280a46e72b0f3e9ae84

Escrow created:
0xa57a529130927078ae58e8862bbdaa84bbb31491b5f0acda54a8e9b6503dfaac

Escrow approved:
0xcb8a5a69a8bfebcf7fa76f8b4ea72d9f8cd86a2600e8c2182e6bbe462b2181f6

Escrow released:
0xa2b25e42b43900fd4ea3f374c7b5727757c0b54609bbb10a94a411c418dc7859
```

View transactions on MonadVision:

```txt
https://testnet.monadvision.com/tx/<TX_HASH>
```

## Local Setup

```bash
npm install
npm test
npm run compile
npm run abi
```

Expected test result:

```txt
4 passing
```

## Environment

Create `.env` from `.env.example`.

Required for deploy:

```env
RPC_URL=https://testnet-rpc.monad.xyz
PRIVATE_KEY_DEPLOYER=0x...
```

Do not commit `.env`. Do not share private keys.

After deployment:

```env
NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_AGENT_VAULT_ADDRESS=0x...
```

Optional demo setup:

```env
DEMO_AGENT_ADDRESS=0x...
DEMO_API_PROVIDER_ADDRESS=0x...
DEMO_VERIFIER_ADDRESS=0x...
```

## Commands

Compile:

```bash
npm run compile
```

Test:

```bash
npm test
```

Export ABI files into `abi/`:

```bash
npm run abi
```

Deploy to Monad Testnet:

```bash
npm run deploy:monad
```

Register demo agent, API provider, and verifier:

```bash
npm run setup:monad
```

Run deployed demo transactions:

```bash
npm run demo:monad
```

## Backend Integration Notes

The backend can use the ABI files in `abi/` and call:

- `deposit()` with native MON value from the agent wallet
- `requestPayment(bytes32 taskId, address agent, address payable to, uint256 amount, string actionType, string reason)`
- `createEscrow(bytes32 taskId, address agent, address payable verifier, uint256 amount, string reason)`
- `approveEscrow(bytes32 taskId)` from verifier
- `releaseEscrow(bytes32 taskId)` from verifier or agent

Important events for the dashboard:

- `PaymentApproved`
- `PaymentBlocked`
- `EscrowCreated`
- `EscrowReleased`
- `AgentFrozen`
