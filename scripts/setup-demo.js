const hre = require("hardhat");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main() {
  const registryAddress = required("NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS");
  const agentAddress = required("DEMO_AGENT_ADDRESS");
  const apiProviderAddress = required("DEMO_API_PROVIDER_ADDRESS");
  const verifierAddress = required("DEMO_VERIFIER_ADDRESS");

  const registry = await hre.ethers.getContractAt("AgentRegistry", registryAddress);

  console.log(`Configuring registry ${registryAddress}`);

  await (await registry.registerAgent(agentAddress, "Demo Payment Agent")).wait();
  console.log(`Registered agent ${agentAddress}`);

  await (await registry.registerRecipient(apiProviderAddress, "API_PROVIDER")).wait();
  console.log(`Allowlisted API provider ${apiProviderAddress}`);

  await (await registry.registerRecipient(verifierAddress, "VERIFIER")).wait();
  console.log(`Allowlisted verifier ${verifierAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
