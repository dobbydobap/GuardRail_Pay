const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  await hre.run("compile");

  const abiDir = path.join(__dirname, "..", "abi");
  fs.mkdirSync(abiDir, { recursive: true });

  for (const name of ["AgentRegistry", "AgentVault"]) {
    const artifact = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
    console.log(`Wrote abi/${name}.json`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
