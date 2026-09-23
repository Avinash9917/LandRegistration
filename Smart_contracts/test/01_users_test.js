const Users = artifacts.require("Users");

contract("Users Contract (Aadhaar Hashing & Privacy)", (accounts) => {
  const [admin, user1, user2, user3] = accounts;
  let usersInstance;

  // Salted Aadhaar Hashes (e.g. SHA-256 / Keccak256 of salt + Aadhaar)
  const aadharHash1 = web3.utils.soliditySha3("SALT_SECRET_1", "123456789012");
  const aadharHash2 = web3.utils.soliditySha3("SALT_SECRET_2", "987654321098");

  before(async () => {
    usersInstance = await Users.new();
  });

  it("should successfully register a user with a salted Aadhaar hash", async () => {
    const tx = await usersInstance.registerUser(
      "John",
      "Doe",
      "1990-01-01",
      aadharHash1,
      { from: user1 }
    );

    assert.equal(tx.logs[0].event, "UserRegistered", "UserRegistered event should be emitted");
    assert.equal(tx.logs[0].args.userID, user1, "User ID should match caller address");
    assert.equal(tx.logs[0].args.aadharHash, aadharHash1, "Aadhaar hash should match in event");

    const isReg = await usersInstance.isUserRegistered(user1);
    assert.isTrue(isReg, "User should be marked as registered");

    const userDetails = await usersInstance.getUserDetails(user1);
    assert.equal(userDetails.firstName, "John", "First name should match");
    assert.equal(userDetails.lastName, "Doe", "Last name should match");
    assert.equal(userDetails.dateOfBirth, "1990-01-01", "DOB should match");
    assert.equal(userDetails.aadharHash, aadharHash1, "Aadhaar hash should match");
  });

  it("should reject duplicate registration from the same wallet address", async () => {
    try {
      await usersInstance.registerUser(
        "John",
        "Duplicate",
        "1990-01-01",
        aadharHash2,
        { from: user1 }
      );
      assert.fail("Should have thrown error on duplicate wallet");
    } catch (err) {
      assert.include(err.message, "User already registered");
    }
  });

  it("should reject registration with an already registered Aadhaar hash from a different wallet", async () => {
    try {
      await usersInstance.registerUser(
        "Fraudulent",
        "User",
        "1995-05-05",
        aadharHash1, // Re-using user1's Aadhaar hash
        { from: user2 }
      );
      assert.fail("Should have thrown error on duplicate Aadhaar hash");
    } catch (err) {
      assert.include(err.message, "Aadhar number already registered");
    }
  });

  it("should reject registration with empty names or empty hash", async () => {
    const emptyHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    try {
      await usersInstance.registerUser(
        "Alice",
        "Smith",
        "1992-02-02",
        emptyHash,
        { from: user3 }
      );
      assert.fail("Should have rejected zero Aadhaar hash");
    } catch (err) {
      assert.include(err.message, "Invalid Aadhaar hash");
    }

    try {
      await usersInstance.registerUser(
        "",
        "Smith",
        "1992-02-02",
        aadharHash2,
        { from: user3 }
      );
      assert.fail("Should have rejected empty first name");
    } catch (err) {
      assert.include(err.message, "First name cannot be empty");
    }
  });
});
