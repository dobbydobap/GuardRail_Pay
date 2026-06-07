// Real on-chain setup for GuardRail Pay demo (Monad testnet).
// - Provisions a dedicated agent wallet (funded for gas), registers it.
// - Allowlists the API-provider recipient + verifier.
// - Raises the registry freeze threshold so repeated demo runs (which emit
//   blocked payments) don't permanently freeze the agent.
// - Deposits funds into the vault on the agent's behalf.
import { JsonRpcProvider, Wallet, Contract, formatEther, parseEther } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "fs";

const ROOT = "/Users/praneethbudati/Desktop/hackathon/GuardRail_Pay";
function readEnv(p) {
  return Object.fromEntries(readFileSync(p, "utf8").split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}
const env = readEnv(`${ROOT}/.env`);
const registryAbi = JSON.parse(readFileSync(`${ROOT}/abi/AgentRegistry.json`, "utf8"));
const vaultAbi = JSON.parse(readFileSync(`${ROOT}/abi/AgentVault.json`, "utf8"));

const provider = new JsonRpcProvider(env.RPC_URL, 10143);
const owner = new Wallet(env.PRIVATE_KEY_DEPLOYER, provider); // registry/vault owner
const verifier = owner.address;                                // verifier = owner (signs approve/release)
const registryAddr = env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS;
const vaultAddr = env.NEXT_PUBLIC_AGENT_VAULT_ADDRESS;

// Dedicated agent wallet — persisted (gitignored) so re-runs reuse it.
const keyFile = `${ROOT}/scripts/.agent.key`;
const agentWallet = existsSync(keyFile)
  ? new Wallet(readFileSync(keyFile, "utf8").trim(), provider)
  : Wallet.createRandom(provider);
if (!existsSync(keyFile)) writeFileSync(keyFile, agentWallet.privateKey);
const agent = agentWallet.address;

// Deterministic API-provider recipient (receives funds, never signs).
const apiProvider = new Wallet("0x" + "a1".repeat(32)).address;

const registry = new Contract(registryAddr, registryAbi, owner);
const vault = new Contract(vaultAddr, vaultAbi, owner);

console.log("owner/verifier", verifier);
console.log("agent         ", agent);
console.log("apiProvider   ", apiProvider);
console.log("maxPerPayment", formatEther(await vault.maxPerPayment()), "dailyLimit", formatEther(await vault.dailyLimit()));

async function send(label, txPromise) {
  const tx = await txPromise; await tx.wait();
  console.log(`  ${label} ✓ ${tx.hash}`);
}

// Fund the agent for gas (~6 txs/run).
const agentBal = await provider.getBalance(agent);
console.log("  agent gas balance", formatEther(agentBal), "MON");
if (agentBal < parseEther("0.2")) {
  const tx = await owner.sendTransaction({ to: agent, value: parseEther("0.3") - agentBal });
  await tx.wait();
  console.log(`  funded agent gas -> ${formatEther(await provider.getBalance(agent))} MON ✓`);
}

// Raise freeze threshold so demo's blocked payments don't freeze the agent.
const threshold = await registry.freezeThreshold();
if (threshold < 1_000_000n) {
  await send("setFreezeThreshold(1e9)", registry.setFreezeThreshold(1_000_000_000n));
} else console.log("  freezeThreshold already high:", threshold.toString());

if (!(await registry.isRegisteredAgent(agent))) {
  await send("registerAgent", registry.registerAgent(agent, "Atlas Treasury Agent"));
} else console.log("  agent already registered");
if (await registry.isFrozen(agent)) console.log("  ⚠️  agent is FROZEN (regenerate by deleting scripts/.agent.key)");

if (!(await registry.isAllowedRecipient(apiProvider)))
  await send("allowlist apiProvider", registry.registerRecipient(apiProvider, "API_PROVIDER"));
else console.log("  apiProvider already allowlisted");
if (!(await registry.isAllowedRecipient(verifier)))
  await send("allowlist verifier", registry.registerRecipient(verifier, "VERIFIER"));
else console.log("  verifier already allowlisted");

// Deposit into the vault as the agent (deposit requires a registered agent).
const vaultAsAgent = vault.connect(agentWallet);
const bal = await vault.balances(agent);
console.log("  agent vault balance", formatEther(bal), "MON");
const target = parseEther("0.04");
if (bal < target) await send(`deposit ${formatEther(target - bal)} MON`, vaultAsAgent.deposit({ value: target - bal }));
console.log("  final agent vault balance", formatEther(await vault.balances(agent)), "MON");

writeFileSync(`${ROOT}/scripts/.onchain.json`, JSON.stringify({
  registryAddr, vaultAddr, agent, verifier, apiProvider,
  maxPerPayment: formatEther(await vault.maxPerPayment()),
  dailyLimit: formatEther(await vault.dailyLimit()),
}, null, 2));
console.log("Wrote scripts/.onchain.json + scripts/.agent.key");
