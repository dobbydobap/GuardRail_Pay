# GuardRail Pay (AgentVault) — Backend

> An **on-chain policy firewall for AI-agent payments.** An autonomous agent
> proposes a payment; the firewall checks it against the agent's policy and
> returns one of three verdicts — **ALLOW**, **ESCROW**, or **BLOCK** — before
> any money moves.

This README explains how the backend works for the two people building on top of
it:

- **Frontend devs** → start at [What it does](#what-it-does) and [For frontend developers](#for-frontend-developers). The full API contract is in [`FRONTEND_INTEGRATION.md`](../FRONTEND_INTEGRATION.md) and [`shared/api-types.ts`](../shared/api-types.ts).
- **Blockchain devs** → jump to [For blockchain developers](#for-blockchain-developers). Your job is to replace the in-memory mocks with real Monad contracts behind a seam that already exists.

---

## What it does

The product demonstrates a **firewall between an AI agent and its money**. Every
payment an agent wants to make is intercepted and judged:

| Verdict    | Meaning                                              | Example                          |
| ---------- | --------------------------------------------------- | -------------------------------- |
| **ALLOW**  | Safe — settle immediately                           | Small payment to an allowlisted API provider |
| **ESCROW** | Large-but-valid — park it for human approval        | Payment above the escrow threshold |
| **BLOCK**  | Reject outright                                     | Prompt-injection attack, over-budget spend, non-allowlisted recipient |

Two things produce these decisions:

1. **The agent (LLM)** turns a natural-language task into a structured payment
   proposal (`{ to, amount, actionType, reason }`).
2. **The policy firewall** runs that proposal through a set of rules
   (allowlist, per-tx cap, daily limit, escrow threshold, prompt-injection
   detection) and emits a verdict.

The demo tells a fixed five-act story so judges always see the same flow:

1. Safe API payment → **APPROVED**
2. Escrow creation → **ESCROW_CREATED**
3. Escrow release → **ESCROW_RELEASED**
4. Prompt-injection attack → **BLOCKED** (`ON_CHAIN_INJECTION_PATTERN`)
5. Overspend attack → **BLOCKED** (`DAILY_LIMIT_EXCEEDED`)

---

## Tech stack

- **Runtime:** [Bun](https://bun.sh) (TypeScript, no build step — Bun runs `.ts` directly)
- **HTTP:** `Bun.serve()` — a tiny dependency-free router ([`src/index.ts`](src/index.ts))
- **Chain:** [ethers v6](https://docs.ethers.org/v6/) (wired but dormant until contracts are deployed)
- **LLM:** [Ollama Cloud](https://ollama.com) via its OpenAI-compatible API
- **Storage:** in-memory singleton (no database)

---

## Quick start

```bash
cd backend
bun install
cp .env.example .env      # then fill in values (see below)
bun run dev               # watch mode on http://localhost:3000
# or: bun run start
```

Smoke test:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/demo/full-run
curl http://localhost:3000/events
```

### Environment (`.env`)

| Var                                        | Required for          | Notes                                            |
| ------------------------------------------ | --------------------- | ------------------------------------------------ |
| `PORT`                                     | server                | Default `3000`                                   |
| `OLLAMA_API_KEY` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | live LLM   | Model **must** be one your key can serve (`GET <base>/models`). Demo default: `gpt-oss:120b` |
| `OLLAMA_TIMEOUT_MS`                        | optional              | Per-request timeout, default 30000               |
| `RPC_URL`                                  | chain reads/sync      | e.g. Monad testnet RPC                            |
| `AGENT_VAULT_ADDRESS` / `AGENT_REGISTRY_ADDRESS` | chain mode      | Deployed contract addresses                       |
| `PRIVATE_KEY_AGENT` / `PRIVATE_KEY_VERIFIER` | on-chain writes    | Agent signs payments/escrows; verifier releases  |

**Mock-only mode is the default.** With no chain or LLM configured the app still
runs end-to-end: the firewall is deterministic, and LLM proposals fall back to
fixed values. Nothing breaks if Ollama or the chain is down.

> ⚠️ `.env` currently contains a real Ollama key — rotate it before making the
> repo public, and keep `.env` out of git.

---

## How it works (request flow)

```
            ┌──────────────────────── POST /demo/full-run ────────────────────────┐
            │                                                                      │
   ┌────────▼─────────┐     ┌──────────────────┐      ┌──────────────────────┐    │
   │   DemoRunner     │     │   AgentRunner    │      │  scenarios.ts        │    │
   │  (orchestrator)  │────▶│  (LLM → proposal)│      │  (deterministic acts)│    │
   └────────┬─────────┘     └────────┬─────────┘      └──────────┬───────────┘    │
            │                        │                           │                │
            │                 OllamaClient                checkPolicy()           │
            │                 (transport)              (the firewall, AgentVault) │
            │                        │                           │                │
            │                        ▼                           ▼                │
            │                 raw model JSON            ALLOW / ESCROW / BLOCK     │
            │                                                     │                │
            │                                          settle / createEscrow      │
            │                                                     │                │
            ▼                                                     ▼                │
     llmOutputs[]  ◀───── combined response ─────▶  events[]  (EventStore)        │
            └──────────────────────────────────────────────────────────────────┘
```

- **[`DemoRunner`](src/services/DemoRunner.ts)** orchestrates one demo run: it
  collects the agent's LLM proposals (best-effort, in parallel) and runs the
  deterministic scenarios, then returns both plus a summary.
- **[`AgentRunner`](src/agent/AgentRunner.ts)** prompts the LLM, strips
  `<think>` blocks / markdown fences, extracts and validates JSON, retries on
  bad output, and **forces the recipient to a deterministic address** so the
  critical field never depends on the model.
- **[`OllamaClient`](src/agent/OllamaClient.ts)** is pure transport (timeouts,
  retries, logging) — no business logic.
- **[`AgentVault`](src/contracts/AgentVault.ts)** is the firewall: `checkPolicy`
  → verdict, then `settle` / `createEscrow` / `approveEscrow`. **This is the
  mock that the blockchain dev replaces.**
- **[`AgentRegistry`](src/contracts/AgentRegistry.ts)** holds each agent's
  policy (caps, allowlist, escrow threshold). Also a mock to be replaced.
- **[`EventStore`](src/store/scenarios.ts)** is the append-only audit log that
  `/events` reads from.
- **[`constants.ts`](src/agent/constants.ts)** is the single source of truth for
  all demo addresses, amounts, and reasons — keeping the demo fully
  deterministic and consistent across LLM output, scenario, and event.

### The two key data shapes

- **`PaymentRequest`** — what the agent *proposes* (`{ to, amount, actionType, reason }`), produced by the LLM.
- **`ScenarioResult`** — what the firewall *decided* (the audit record stored and returned by the API). See [`shared/api-types.ts`](../shared/api-types.ts).

---

## Project layout

```
backend/src/
├── index.ts                 # Bun.serve entrypoint + router
├── routes/
│   ├── health.ts            # GET  /health
│   ├── events.ts            # GET  /events
│   └── demoFullRun.ts       # POST /demo/full-run
├── services/
│   ├── DemoRunner.ts        # orchestrates the full demo story
│   └── health.ts            # dependency connectivity probes
├── agent/
│   ├── AgentRunner.ts       # LLM → validated PaymentRequest
│   ├── OllamaClient.ts      # OpenAI-compatible transport
│   ├── prompts.ts           # prompt templates (amounts baked in)
│   ├── constants.ts         # ADDRESSES / AMOUNTS / REASONS (source of truth)
│   ├── scenarios.ts         # the 5 deterministic demo acts
│   └── identities.ts        # richer named on-chain identities (future use)
├── contracts/
│   ├── AgentVault.ts        # MOCK firewall (checkPolicy/settle/escrow)
│   ├── AgentRegistry.ts     # MOCK policy registry
│   ├── ContractService.ts   # REAL ethers v6 client (dormant until deployed)
│   ├── EventSyncService.ts  # REAL chain→EventStore sync (dormant)
│   ├── AgentVault.abi.json  # ABI the backend expects on-chain
│   └── AgentRegistry.abi.json
├── store/scenarios.ts       # in-memory EventStore singleton
├── lib/                     # http helpers, id/hash generators, logger
└── types/                   # scenario.ts (domain) + api.ts (REST shapes)
```

---

## For frontend developers

You only need three endpoints. **Full request/response examples, TypeScript
types, and a ready-made typed client are in
[`FRONTEND_INTEGRATION.md`](../FRONTEND_INTEGRATION.md).** Import the types from
[`shared/api-types.ts`](../shared/api-types.ts).

| Method | Path             | Use it for                                  |
| ------ | ---------------- | ------------------------------------------- |
| GET    | `/health`        | Status badge; is the LLM/chain live?        |
| GET    | `/events`        | History/feed (supports filters + `limit`)   |
| POST   | `/demo/full-run` | The demo button — runs all 5 acts at once   |

What you need to know:

- **CORS is open** (`*`), so you can call it straight from the browser.
- **`/demo/full-run` takes ~4–7s** (it makes live LLM calls) — show a loading
  state. It always returns `200`, even if the model is down (it falls back to
  identical deterministic values). It also **resets state** each call.
- The response gives you both `llmOutputs` (what the agent *proposed*) and
  `events` (what the firewall *decided*) — render them side by side to show the
  firewall catching the bad ones. A proposal matches its event by `scenario`
  order; `to`/`amount`/`actionType` line up.
- **`amount` is always a decimal string** (`"0.001"`), and timestamps are ms.
- Success bodies have `ok: true` (except `/health`, which has `status: "ok"`);
  errors are `{ ok: false, error }`.

---

## For blockchain developers

The backend is **already wired for ethers v6** — your job is to deploy the
contracts and flip it from mock mode to chain mode. There are two seams.

### 1. The contract surface the backend expects

The ABIs in [`src/contracts/`](src/contracts/) define the exact interface your
Solidity must implement (function signatures + event shapes). Match these names
and argument orders and the backend works unchanged.

**AgentVault** ([`AgentVault.abi.json`](src/contracts/AgentVault.abi.json)):

```solidity
// functions
function requestPayment(address to, uint256 amount, string memo) returns (bytes32 taskId);
function createEscrow(address to, uint256 amount, string memo) returns (bytes32 escrowId);
function releaseEscrow(bytes32 escrowId) returns (bool);

// events  (the backend decodes these into ScenarioResults)
event PaymentApproved(bytes32 indexed taskId,   address indexed agent, address indexed to, uint256 amount, string reason);
event PaymentBlocked (bytes32 indexed taskId,   address indexed agent, address to,         uint256 amount, string blockReason);
event EscrowCreated  (bytes32 indexed escrowId, address indexed agent, address to,         uint256 amount, string reason);
event EscrowReleased (bytes32 indexed escrowId, address indexed agent, address to,         uint256 amount, string reason);
event AgentFrozen    (address indexed agent, string reason);
```

**AgentRegistry** ([`AgentRegistry.abi.json`](src/contracts/AgentRegistry.abi.json)):

```solidity
function isRegistered(address agent) view returns (bool);
function getPolicy(address agent) view returns (uint256 maxPerTx, uint256 dailyLimit, uint256 requireEscrowAbove);
function isAllowed(address agent, address to) view returns (bool);

event AgentRegistered(address indexed agent);
event PolicyUpdated(address indexed agent, uint256 maxPerTx, uint256 dailyLimit, uint256 requireEscrowAbove);
```

Key conventions the backend relies on:

- **Amounts are `uint256` wei** on-chain. The backend uses `parseEther` on the
  way in and `formatEther` on the way out, so the API's decimal-string `amount`
  (e.g. `"0.001"`) maps to `1000000000000000` wei.
- **The firewall verdict is expressed by *which event* fires** —
  `PaymentApproved` vs `PaymentBlocked` vs `EscrowCreated`. The mapping lives in
  [`ContractService.ts`](src/contracts/ContractService.ts) and
  [`EventSyncService.ts`](src/contracts/EventSyncService.ts) (`EVENT_MAP`).
- `taskId` / `escrowId` are `bytes32` and become the `ScenarioResult.taskId`.

### 2. The two integration seams

**a) Writes — [`ContractService`](src/contracts/ContractService.ts)** (already
implemented). It signs and sends transactions and decodes the receipt's events
into `ScenarioResult`s:

- `requestPayment` / `createEscrow` are signed by `PRIVATE_KEY_AGENT`
- `releaseEscrow` is signed by `PRIVATE_KEY_VERIFIER`
- every write returns `{ txHash, receipt, status, results }`

**b) Reads/sync — [`EventSyncService`](src/contracts/EventSyncService.ts)**
(already implemented and auto-started). On boot, `startEventSyncIfConfigured()`
in [`index.ts`](src/index.ts) runs **only if `RPC_URL` + `AGENT_VAULT_ADDRESS`
are set**. It replays the last N blocks, then live-subscribes, decoding every
event into the same `EventStore` that `/events` serves — with `txHash:logIndex`
dedup so replay + live + reconnects never double-count.

### 3. Going from mock → chain

The mocks and the real chain produce the **identical `ScenarioResult` shape**, so
the API contract never changes. To switch on the chain:

1. Deploy `AgentVault` + `AgentRegistry` to Monad implementing the ABIs above.
2. Seed agent policies in the registry (the mock seeds the demo agent in
   [`AgentRegistry.ts`](src/contracts/AgentRegistry.ts) — mirror those values:
   allowlist, `maxPerTx`, `dailyLimit`, `requireEscrowAbove`).
3. Fill `RPC_URL`, `AGENT_VAULT_ADDRESS`, `AGENT_REGISTRY_ADDRESS`, and the
   signer keys in `.env`.
4. Restart. `EventSyncService` starts automatically and `/events` now reflects
   real on-chain activity. The currently mock-only demo path
   ([`scenarios.ts`](src/agent/scenarios.ts) → `AgentVault.ts`) can then be
   pointed at `ContractService` write methods to settle on-chain.

> The mock `AgentVault.ts` is intentionally written as the seam: its exported
> functions (`checkPolicy`, `settle`, `createEscrow`, `approveEscrow`) mirror the
> on-chain operations, so swapping internals for `ContractService` calls is a
> contained change.

---

## API reference (summary)

Full details: [`FRONTEND_INTEGRATION.md`](../FRONTEND_INTEGRATION.md).

| Method | Path             | Returns                                             |
| ------ | ---------------- | -------------------------------------------------- |
| GET    | `/`              | Service info + route map                            |
| GET    | `/health`        | `{ status, timestamp, rpcConnected, contractConnected, ollamaConnected }` |
| GET    | `/events`        | `{ ok, count, events[] }` (filters: `agent`, `status`, `actionType`, `since`, `limit`) |
| POST   | `/demo/full-run` | `{ ok, summary, llmOutputs[], events[] }`           |

Errors use `{ ok: false, error }` with status `404` (unknown route) or `500`
(unexpected fault). `/health` always returns `200`.

---

## Design notes

- **Deterministic by construction.** All demo addresses, amounts, and reasons
  come from [`constants.ts`](src/agent/constants.ts); the firewall is pure and
  re-seeded each run. The same demo produces the same verdicts every time.
- **Graceful degradation.** The LLM and the chain are both optional. If either is
  unavailable the app still serves a complete, correct demo from mocks/fallbacks.
- **One canonical record.** Mock scenarios and real on-chain events both produce
  `ScenarioResult`, so the frontend renders one shape regardless of backend mode.
- **No database.** State is an in-memory singleton; it resets on restart (and the
  demo resets per run). Swap [`EventStore`](src/store/scenarios.ts) for Redis/
  Postgres/an indexer behind its interface without touching call sites.
```
