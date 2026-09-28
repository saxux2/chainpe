/**
 * Deploys the vendored ERC-8004 registries behind ERC-1967 proxies using the
 * reference project's bootstrap pattern:
 *
 *   1. Deploy HardhatMinimalUUPS impl (its initialize sets msg.sender as owner).
 *   2. Deploy ERC1967Proxy(minimalImpl, minimalInit) -> owner = deployer.
 *   3. Deploy the real registry implementation.
 *   4. proxy.upgradeToAndCall(realImpl, realInitialize) -> reinitializer(2).
 *
 * Shared by `scripts/deploy-erc8004.ts` and `test/ERC8004.test.ts`.
 */
import { ethers } from "hardhat";

export interface Erc8004Deployment {
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
}

async function bootstrapRegistry(
  realContractName: string,
  minimalInitArg: string,
  realInitData: string
): Promise<string> {
  const Minimal = await ethers.getContractFactory("HardhatMinimalUUPS");
  // Fully-qualified name: "ERC1967Proxy" is ambiguous (OZ ships one too).
  const Proxy = await ethers.getContractFactory("contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy");

  const minimalImpl = await Minimal.deploy();
  await minimalImpl.waitForDeployment();

  const minimalInit = Minimal.interface.encodeFunctionData("initialize", [minimalInitArg]);
  const proxy = await Proxy.deploy(await minimalImpl.getAddress(), minimalInit);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();

  const Real = await ethers.getContractFactory(realContractName);
  const realImpl = await Real.deploy();
  await realImpl.waitForDeployment();

  const minimalProxy = await ethers.getContractAt("HardhatMinimalUUPS", proxyAddr);
  const tx = await minimalProxy.upgradeToAndCall(await realImpl.getAddress(), realInitData);
  await tx.wait();

  return proxyAddr;
}

export async function deployErc8004(): Promise<Erc8004Deployment> {
  // --- Identity Registry: initialize() (no args) ---
  const Identity = await ethers.getContractFactory("IdentityRegistryUpgradeable");
  const identityInit = Identity.interface.encodeFunctionData("initialize", []);
  const identityRegistry = await bootstrapRegistry(
    "IdentityRegistryUpgradeable",
    ethers.ZeroAddress,
    identityInit
  );

  // --- Reputation Registry: initialize(identityRegistry) ---
  const Reputation = await ethers.getContractFactory("ReputationRegistryUpgradeable");
  const reputationInit = Reputation.interface.encodeFunctionData("initialize", [identityRegistry]);
  const reputationRegistry = await bootstrapRegistry(
    "ReputationRegistryUpgradeable",
    identityRegistry,
    reputationInit
  );

  // --- Validation Registry: initialize(identityRegistry) ---
  const Validation = await ethers.getContractFactory("ValidationRegistryUpgradeable");
  const validationInit = Validation.interface.encodeFunctionData("initialize", [identityRegistry]);
  const validationRegistry = await bootstrapRegistry(
    "ValidationRegistryUpgradeable",
    identityRegistry,
    validationInit
  );

  return { identityRegistry, reputationRegistry, validationRegistry };
}
