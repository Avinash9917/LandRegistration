// Users contract : for holding user data and methods
const Users = artifacts.require("Users");

// LandRegistry : holds owner-land mapping, RBAC access control, and oracle validation
const LandRegistry = artifacts.require("LandRegistry");

// MockLandRecordsOracle : government land records mock oracle
const MockLandRecordsOracle = artifacts.require("MockLandRecordsOracle");

// TransferOwnerShip : holds ownership transfer, escrow, and sales
const TransferOwnerShip = artifacts.require("TransferOwnerShip");

module.exports = async function(deployer, network, accounts) {
  // 1. Deploy Users contract
  await deployer.deploy(Users);

  // 2. Deploy MockLandRecordsOracle
  await deployer.deploy(MockLandRecordsOracle);

  // 3. Deploy LandRegistry
  await deployer.deploy(LandRegistry);
  const landRegistryInstance = await LandRegistry.deployed();

  // 4. Wire Oracle to LandRegistry
  await landRegistryInstance.setOracleAddress(MockLandRecordsOracle.address);

  // 5. Deploy TransferOwnerShip with LandRegistry address
  await deployer.deploy(TransferOwnerShip, LandRegistry.address);
};
