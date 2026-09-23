const LandRegistry = artifacts.require("LandRegistry");
const Properties = artifacts.require("Property");

contract("LandRegistry (RBAC, Jurisdiction & Document Anchoring)", (accounts) => {
  const [admin, officerDept1, officerDept2, citizen1, citizen2] = accounts;
  let landRegistry;
  let propertyId1;

  // Mock document Keccak256 hash (anchored on-chain)
  const docHashOriginal = web3.utils.sha3("VALID_PDF_DOCUMENT_BYTES_CONTENT_12345");
  const docHashTampered = web3.utils.sha3("TAMPERED_PDF_DOCUMENT_CONTENT_67890");

  before(async () => {
    landRegistry = await LandRegistry.new({ from: admin });

    // Assign Officer 1 to Revenue Department 101
    await landRegistry.mapRevenueDeptIdToEmployee(101, officerDept1, { from: admin });

    // Assign Officer 2 to Revenue Department 202
    await landRegistry.mapRevenueDeptIdToEmployee(202, officerDept2, { from: admin });
  });

  it("should allow a citizen to add land with document hash anchored", async () => {
    const tx = await landRegistry.addLand(
      1, // Location ID
      101, // Revenue Dept ID 101
      555, // Survey Number
      "North District",
      "Revenue Zone A",
      "Survey-555",
      1200, // Area (sq ft)
      docHashOriginal,
      { from: citizen1 }
    );

    assert.equal(tx.logs[0].event, "LandAdded", "LandAdded event should be emitted");
    propertyId1 = tx.logs[0].args.propertyId.toNumber();
    assert.isAbove(propertyId1, 0, "Property ID should be valid");
    assert.equal(tx.logs[0].args.documentHash, docHashOriginal, "Document hash should be anchored");

    const property = await landRegistry.getPropertyDetails(propertyId1);
    assert.equal(property.owner, citizen1, "Citizen1 should be owner");
    assert.equal(property.state.toString(), "0", "State should be 0 (Created / Under Verification)");
    assert.equal(property.documentHash, docHashOriginal, "On-chain document hash should match");
  });

  it("should verify that on-chain document hash detects tampering", async () => {
    const property = await landRegistry.getPropertyDetails(propertyId1);
    
    // Exact match verification
    assert.equal(property.documentHash, docHashOriginal, "Original document hash should match");
    // Tampered mismatch verification
    assert.notEqual(property.documentHash, docHashTampered, "Tampered document hash must not match");
  });

  it("should reject verification attempt by an unauthorized citizen", async () => {
    try {
      await landRegistry.verifyProperty(propertyId1, { from: citizen2 });
      assert.fail("Should have reverted on unauthorized caller");
    } catch (err) {
      assert.include(err.message, "Caller is not an authorized officer");
    }
  });

  it("should reject verification attempt by an officer outside their jurisdiction", async () => {
    try {
      // Property 1 is under Revenue Dept 101. Officer 2 belongs to Dept 202.
      await landRegistry.verifyProperty(propertyId1, { from: officerDept2 });
      assert.fail("Should have reverted on jurisdiction mismatch");
    } catch (err) {
      assert.include(err.message, "Officer jurisdiction mismatch");
    }
  });

  it("should allow the authorized jurisdiction officer to verify property", async () => {
    const tx = await landRegistry.verifyProperty(propertyId1, { from: officerDept1 });
    assert.equal(tx.logs[0].event, "PropertyVerified", "PropertyVerified event should be emitted");

    const property = await landRegistry.getPropertyDetails(propertyId1);
    assert.equal(property.state.toString(), "2", "State should be 2 (Verified)");
    assert.equal(property.employeeId, officerDept1, "Verifying employee address should be recorded");
  });

  it("should enforce emergency circuit breaker (Pausable)", async () => {
    // Admin pauses contract
    await landRegistry.pause({ from: admin });

    // Adding land while paused should fail
    try {
      await landRegistry.addLand(
        1, 101, 777, "North District", "Revenue Zone A", "Survey-777", 1500, docHashOriginal,
        { from: citizen1 }
      );
      assert.fail("Should have reverted while paused");
    } catch (err) {
      assert.include(err.message, "Pausable: paused");
    }

    // Admin unpauses contract
    await landRegistry.unpause({ from: admin });

    // Adding land should now succeed
    const tx = await landRegistry.addLand(
      1, 101, 777, "North District", "Revenue Zone A", "Survey-777", 1500, docHashOriginal,
      { from: citizen1 }
    );
    assert.equal(tx.logs[0].event, "LandAdded", "LandAdded should succeed after unpause");
  });
});
