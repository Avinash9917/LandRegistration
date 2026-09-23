const LandRegistry = artifacts.require("LandRegistry");
const TransferOwnerShip = artifacts.require("TransferOwnerShip");
const ReentrancyAttacker = artifacts.require("ReentrancyAttacker");

contract("TransferOwnerShip (Escrow Lifecycle, Reentrancy Defense & Funds Settlement)", (accounts) => {
  const [admin, officer, seller, buyer, attackerEOA] = accounts;
  let landRegistry, transferContract, attackerContract;
  let propertyId, saleId;
  const docHash = web3.utils.sha3("DEED_ESCROW_DOC_111");

  before(async () => {
    landRegistry = await LandRegistry.new({ from: admin });
    await landRegistry.mapRevenueDeptIdToEmployee(501, officer, { from: admin });

    transferContract = await TransferOwnerShip.new(landRegistry.address, { from: admin });
    attackerContract = await ReentrancyAttacker.new(transferContract.address, { from: attackerEOA });

    // 1. Seller registers land
    const txLand = await landRegistry.addLand(
      1, 501, 1001, "Downtown", "Central Zone", "Survey-1001", 3500, docHash,
      { from: seller }
    );
    propertyId = txLand.logs[0].args.propertyId.toNumber();

    // 2. Officer verifies land
    await landRegistry.verifyProperty(propertyId, { from: officer });
  });

  it("should list property for sale", async () => {
    const tx = await transferContract.addPropertyOnSale(propertyId, 2, { from: seller }); // 2 ETH
    assert.equal(tx.logs[0].event, "PropertyOnSale");
    saleId = tx.logs[0].args.saleId.toNumber();

    const sale = await transferContract.getSale(saleId);
    assert.equal(sale.owner, seller);
    assert.equal(sale.price.toString(), web3.utils.toWei("2", "ether"));
    assert.equal(sale.state.toString(), "0", "State should be Active (0)");
  });

  it("should allow a buyer to send purchase request", async () => {
    const tx = await transferContract.sendPurchaseRequest(saleId, 2, { from: buyer });
    assert.equal(tx.logs[0].event, "PurchaseRequestSent");

    const requestedUsers = await transferContract.getRequestedUsers(saleId);
    assert.equal(requestedUsers.length, 1);
    assert.equal(requestedUsers[0].user, buyer);
  });

  it("should allow the seller to accept buyer's offer", async () => {
    const tx = await transferContract.acceptBuyerRequest(saleId, buyer, 2, { from: seller });
    assert.equal(tx.logs[0].event, "SaleAccepted");

    const sale = await transferContract.getSale(saleId);
    assert.equal(sale.acceptedFor, buyer);
    assert.equal(sale.state.toString(), "1", "State should be AcceptedToABuyer (1)");
  });

  it("should execute transferOwnerShip safely with checks-effects-interactions and ETH transfer", async () => {
    const sellerInitialBalance = web3.utils.toBN(await web3.eth.getBalance(seller));
    const priceWei = web3.utils.toWei("2", "ether");

    const tx = await transferContract.transferOwnerShip(saleId, { from: buyer, value: priceWei });
    assert.equal(tx.logs[0].event, "SaleCompleted");

    // Verify state updated
    const sale = await transferContract.getSale(saleId);
    assert.equal(sale.state.toString(), "3", "Sale state should be Success (3)");
    assert.isTrue(sale.paymentDone, "Payment should be marked as done");

    // Verify property ownership transferred in LandRegistry
    const property = await landRegistry.getPropertyDetails(propertyId);
    assert.equal(property.owner, buyer, "Owner should now be the buyer");
    assert.equal(property.state.toString(), "5", "Property state should be Bought (5)");

    // Verify seller received funds
    const sellerFinalBalance = web3.utils.toBN(await web3.eth.getBalance(seller));
    const balanceDiff = sellerFinalBalance.sub(sellerInitialBalance);
    assert.equal(balanceDiff.toString(), priceWei, "Seller should have received exact 2 ETH");
  });

  it("should defend against reentrancy attacks via ReentrancyGuard", async () => {
    // Register and verify a second property for reentrancy test
    const txLand = await landRegistry.addLand(
      1, 501, 1002, "Downtown", "Central Zone", "Survey-1002", 3500, docHash,
      { from: seller }
    );
    const propId2 = txLand.logs[0].args.propertyId.toNumber();
    await landRegistry.verifyProperty(propId2, { from: officer });

    // List property on sale
    const txSale = await transferContract.addPropertyOnSale(propId2, 1, { from: seller });
    const saleId2 = txSale.logs[0].args.saleId.toNumber();

    // Attacker contract sends purchase request via attacker contract helper
    await attackerContract.sendPurchaseRequest(saleId2, 1, { from: attackerEOA });
    await transferContract.acceptBuyerRequest(saleId2, attackerContract.address, 1, { from: seller });

    // Attacker executes attack
    await attackerContract.attack(saleId2, { from: attackerEOA, value: web3.utils.toWei("1", "ether") });

    // Verification: state transitioned safely to Success without reentrancy recursion
    const sale = await transferContract.getSale(saleId2);
    assert.equal(sale.state.toString(), "3", "State should be Success (3)");
    assert.isTrue(sale.paymentDone);
  });
});
