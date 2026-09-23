const LandRegistry = artifacts.require("LandRegistry");
const TransferOwnerShip = artifacts.require("TransferOwnerShip");

contract("Explicit Input Validation Checks & Reverts", (accounts) => {
  const [admin, citizen, officer] = accounts;
  let landRegistry, transferContract;
  const validDocHash = web3.utils.sha3("VALID_DOC_HASH_ABC");
  const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  before(async () => {
    landRegistry = await LandRegistry.new({ from: admin });
    await landRegistry.mapRevenueDeptIdToEmployee(10, officer, { from: admin });
    transferContract = await TransferOwnerShip.new(landRegistry.address, { from: admin });
  });

  it("should revert if survey number is zero", async () => {
    try {
      await landRegistry.addLand(
        1, 10, 0, "North Zone", "Revenue Dept 10", "Survey-0", 1000, validDocHash,
        { from: citizen }
      );
      assert.fail("Should revert on zero survey number");
    } catch (err) {
      assert.include(err.message, "Invalid survey number: must be non-zero");
    }
  });

  it("should revert if location ID is zero", async () => {
    try {
      await landRegistry.addLand(
        0, 10, 101, "North Zone", "Revenue Dept 10", "Survey-101", 1000, validDocHash,
        { from: citizen }
      );
      assert.fail("Should revert on zero location ID");
    } catch (err) {
      assert.include(err.message, "Invalid location ID: must be non-zero");
    }
  });

  it("should revert if revenue department ID is zero", async () => {
    try {
      await landRegistry.addLand(
        1, 0, 101, "North Zone", "Revenue Dept 0", "Survey-101", 1000, validDocHash,
        { from: citizen }
      );
      assert.fail("Should revert on zero revenue department ID");
    } catch (err) {
      assert.include(err.message, "Invalid revenue department ID: must be non-zero");
    }
  });

  it("should revert if area is zero", async () => {
    try {
      await landRegistry.addLand(
        1, 10, 101, "North Zone", "Revenue Dept 10", "Survey-101", 0, validDocHash,
        { from: citizen }
      );
      assert.fail("Should revert on zero area");
    } catch (err) {
      assert.include(err.message, "Area must be greater than zero");
    }
  });

  it("should revert if location name is empty", async () => {
    try {
      await landRegistry.addLand(
        1, 10, 101, "", "Revenue Dept 10", "Survey-101", 1000, validDocHash,
        { from: citizen }
      );
      assert.fail("Should revert on empty location name");
    } catch (err) {
      assert.include(err.message, "Location name cannot be empty");
    }
  });

  it("should revert if document hash is zero", async () => {
    try {
      await landRegistry.addLand(
        1, 10, 101, "North Zone", "Revenue Dept 10", "Survey-101", 1000, zeroBytes32,
        { from: citizen }
      );
      assert.fail("Should revert on empty document hash");
    } catch (err) {
      assert.include(err.message, "Document hash cannot be empty");
    }
  });

  it("should revert if price is zero when putting property on sale", async () => {
    // 1. Add valid land
    const tx = await landRegistry.addLand(
      1, 10, 101, "North Zone", "Revenue Dept 10", "Survey-101", 1000, validDocHash,
      { from: citizen }
    );
    const propId = tx.logs[0].args.propertyId.toNumber();

    // 2. Officer verifies
    await landRegistry.verifyProperty(propId, { from: officer });

    // 3. Put on sale with 0 price
    try {
      await transferContract.addPropertyOnSale(propId, 0, { from: citizen });
      assert.fail("Should revert on zero price");
    } catch (err) {
      assert.include(err.message, "Price must be greater than zero");
    }
  });

  it("should revert if offered price is zero when sending purchase request", async () => {
    // 1. Put on sale with valid price (5 ETH)
    const tx = await transferContract.addPropertyOnSale(1, 5, { from: citizen });
    const saleId = tx.logs[0].args.saleId.toNumber();

    // 2. Buyer sends purchase request with 0 price
    try {
      await transferContract.sendPurchaseRequest(saleId, 0, { from: accounts[4] });
      assert.fail("Should revert on zero offered price");
    } catch (err) {
      assert.include(err.message, "Price offered must be positive");
    }
  });
});
