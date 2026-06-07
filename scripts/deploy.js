const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function writeAbi(name, contract) {
  const artifact = await hre.artifacts.readArtifact(name);
  const abiDir = path.join(__dirname, "..", "abi");
  fs.mkdirSync(abiDir, { recursive: true });
  fs.writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
  return contract.getAddress();
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const maxPerPayment = hre.ethers.parseEther(process.env.MAX_PER_PAYMENT || "0.01");
  const dailyLimit = hre.ethers.parseEther(process.env.DAILY_LIMIT || "0.05");

  console.log(`Deploying with ${deployer.address}`);

  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();

  const AgentVault = await hre.ethers.getContractFactory("AgentVault");
  const vault = await AgentVault.deploy(await registry.getAddress(), maxPerPayment, dailyLimit);
  await vault.waitForDeployment();

  await (await registry.setVault(await vault.getAddress())).wait();

  const registryAddress = await writeAbi("AgentRegistry", registry);
  const vaultAddress = await writeAbi("AgentVault", vault);

  console.log(`CONTRACT_ADDRESS_AGENT_REGISTRY=${registryAddress}`);
  console.log(`CONTRACT_ADDRESS_AGENT_VAULT=${vaultAddress}`);
  console.log("ABI files written to abi/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
