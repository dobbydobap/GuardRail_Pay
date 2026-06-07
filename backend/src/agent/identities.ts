/**
 * On-chain identities for the demo — agents, API providers, verifiers, and a
 * known-bad actor. Addresses are real checksummed EVM addresses (valid on
 * Monad) so the API output looks like a genuine blockchain system rather than
 * `0x1111…` placeholders.
 *
 * AgentRegistry seeds policies from {@link AGENTS}; the scenario engine resolves
 * counterparties from {@link API_PROVIDERS} / {@link VERIFIERS}.
 */

/** A named on-chain entity. */
export interface Identity {
  /** Stable machine handle (used as the `agent` field / lookups). */
  handle: string;
  /** Human-readable display name (surfaced in `reason` strings). */
  name: string;
  /** Checksummed Monad address. */
  address: string;
}

// --- Agents ---------------------------------------------------------------

export const AGENTS = {
  treasury: {
    handle: "atlas-treasury-agent",
    name: "Atlas Treasury Agent",
    address: "0x5240Af5Fc90Ed31F17e23d7ac13A4aFD6A4Aa121",
  },
  ops: {
    handle: "nova-ops-agent",
    name: "Nova Ops Agent",
    address: "0x6956E7CBBd37d4013aC6fe44C6a9aB2a56DdD44b",
  },
} as const satisfies Record<string, Identity>;

/** The agent that drives the scenario engine. */
export const PRIMARY_AGENT: Identity = AGENTS.treasury;

// --- Approved API providers (allowlisted payees) --------------------------

export const API_PROVIDERS: Identity[] = [
  { handle: "pyth-network", name: "Pyth Network", address: "0xed4Fb5Dc5693D68980Eb612a5875f40c960EF5cd" },
  { handle: "helius-api", name: "Helius API", address: "0x52424452DB1edAF11B5dcFEaa741b092A34e8AE4" },
  { handle: "alchemy-rpc", name: "Alchemy RPC", address: "0xdCF9305Bdd20EBFEEa4FDd8A5b8745b529a436B8" },
  { handle: "chainlink-data-feeds", name: "Chainlink Data Feeds", address: "0x9dF25ABFc6220D98c7F08e630c153921e95DA0c7" },
  { handle: "anthropic-api", name: "Anthropic API", address: "0x54C19982b37202fA27571f92b6e0e48c4551eb92" },
  { handle: "the-graph", name: "The Graph", address: "0x3253c3A7384e2bDb7F93F92D149778DC17b8736F" },
];

// --- Escrow verifiers (allowlisted) ---------------------------------------

export const VERIFIERS: Identity[] = [
  { handle: "monad-guardian-verifier", name: "Monad Guardian Verifier", address: "0x3BC1933705571297c4Cd0ec81132e585fa976AA9" },
  { handle: "sentinel-multisig", name: "Sentinel Multisig", address: "0x1650f805C0Ed0c92b1CBdB8A17999C5884d7BF4f" },
];

// --- Known-bad actor (NOT allowlisted) ------------------------------------

export const ATTACKER: Identity = {
  handle: "unknown-wallet",
  name: "Unverified External Wallet",
  address: "0x3a338e66A7C5C244Ac5379651ed3Ad9e94d0F807",
};

/** Every address the primary agent is permitted to pay. */
export const ALLOWLIST: string[] = [
  ...API_PROVIDERS.map((p) => p.address),
  ...VERIFIERS.map((v) => v.address),
];

const BY_ADDRESS = new Map<string, Identity>(
  [...Object.values(AGENTS), ...API_PROVIDERS, ...VERIFIERS, ATTACKER].map((e) => [
    e.address.toLowerCase(),
    e,
  ]),
);

/** Resolve a display name for an address, or `undefined` if unknown. */
export function nameForAddress(address: string): string | undefined {
  return BY_ADDRESS.get(address.toLowerCase())?.name;
}
