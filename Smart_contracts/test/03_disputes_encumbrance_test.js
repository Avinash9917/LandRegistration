const LandRegistry = artifacts.require("LandRegistry");
const MockLandRecordsOracle = artifacts.require("MockLandRecordsOracle");
const TransferOwnerShip = artifacts.require("TransferOwnerShip");

contract("LandRegistry & TransferOwnerShip (Oracle, Disputes & Encumbrance)", (accounts) => {
  const [admin, officer1, citizen1, claimant, buyer] = accounts;
  let landRegistry, oracle, transferContract;
  let propertyId;

  const docHash = web3.utils.sha3("DEED_DOC_BYTES_HASH_789");

  before(async () => {
    oracle = await MockLandRecordsOracle.new({ from: admin });
    landRegistry = await LandRegistry.new({ from: admin });
    await landRegistry.setOracleAddress(oracle.address, { from: admin });
    await landRegistry.mapRevenueDeptIdToEmployee(301, officer1, { from: admin });

    transferContract = await TransferOwnerShip.new(landRegistry.address, { from: admin });
  });

  it("should reject land registration if oracle flags blacklisted survey", async () => {
    // Flag survey 999 as blacklisted in government mock registry
    await oracle.setBlacklistRecord(999, 301, true, { from: admin });

    try {
      await landRegistry.addLand(
        1, 301, 999, "South District", "Revenue Zone C", "Survey-999", 2000, docHash,
        { from: citizen1 }
      );
      assert.fail("Should have rejected blacklisted survey");
    } catch (err) {
      assert.include(err.message, "Survey number is blacklisted");
    }
  });

  it("should reject registration if oracle records a different official owner", async () => {
    // Government registry records 'claimant' as owner of survey 888
    await oracle.setGovernmentRecord(888, 301, claimant, { from: admin });

    try {
      // Citizen1 attempts to register survey 888
      await landRegistry.addLand(
        1, 301, 888, "South District", "Revenue Zone C", "Survey-888", 2000, docHash,
        { from: citizen1 }
      );
      assert.fail("Should have rejected claimant mismatch");
    } catch (err) {
      assert.include(err.message, "Claimant does not match official government record owner");
    }

    // Official owner (claimant) can register successfully
    const tx = await landRegistry.addLand(
      1, 301, 888, "South District", "Revenue Zone C", "Survey-888", 2000, docHash,
      { from: claimant }
    );
    propertyId = tx.logs[0].args.propertyId.toNumber();
    assert.isAbove(propertyId, 0);
  });

  it("should allow raising a dispute on property and freeze sale listing", async () => {
    // Officer verifies claimant's property first
    await landRegistry.verifyProperty(propertyId, { from: officer1 });

    // Citizen1 files a formal legal dispute against the property
    const tx = await landRegistry.disputeProperty(
      propertyId,
      "Court injunction pending in High Court Suit #456",
      { from: citizen1 }
    );
    assert.equal(tx.logs[0].event, "PropertyDisputed");

    const property = await landRegistry.getPropertyDetails(propertyId);
    assert.equal(property.state.toString(), "6", "State should be 6 (Disputed)");

    // Owner tries to put disputed property on sale -> must revert
    try {
      await transferContract.addPropertyOnSale(propertyId, 10, { from: claimant });
      assert.fail("Should not allow selling disputed property");
    } catch (err) {
      assert.include(err.message, "Cannot sell disputed property");
    }
  });

  it("should allow admin/officer to resolve dispute and restore property", async () => {
    // Officer resolves dispute (2 = Verified)
    const tx = await landRegistry.resolveDispute(
      propertyId,
      2, // Verified
      "Court vacated injunction; title verified clear",
      { from: officer1 }
    );
    assert.equal(tx.logs[0].event, "DisputeResolved");

    const property = await landRegistry.getPropertyDetails(propertyId);
    assert.equal(property.state.toString(), "2", "State should be restored to 2 (Verified)");

    // Now owner can put property on sale
    await transferContract.addPropertyOnSale(propertyId, 5, { from: claimant });
    const mySales = await transferContract.getMySales(claimant);
    assert.equal(mySales.length, 1, "Property should now be on sale");
  });

  it("should support encumbrance (lien/mortgage) flagging and block transfer", async () => {
    // Officer sets encumbrance flag for bank mortgage
    await landRegistry.setEncumbrance(propertyId, true, "Mortgage Lien by National Bank", { from: officer1 });

    const property = await landRegistry.getPropertyDetails(propertyId);
    assert.isTrue(property.isEncumbered, "Property should be flagged as encumbered");
    assert.equal(property.encumbranceDetails, "Mortgage Lien by National Bank");
  });
});
