let allRequestedSales = [];

async function checkConnection() {
  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await web3.eth.getAccounts();
      const accountConnectedToMetaMask = accounts[0];

      if (!accountConnectedToMetaMask) {
        alert("Please connect MetaMask.");
        window.location.href = "/";
        return;
      }

      if (!window.localStorage["userAddress"] || accountConnectedToMetaMask.toLowerCase() !== window.localStorage["userAddress"].toLowerCase()) {
        window.localStorage.setItem("userAddress", accountConnectedToMetaMask);
      }

      const connectedEl = document.getElementById("connectedAccount");
      if (connectedEl) {
        connectedEl.innerText = `${accountConnectedToMetaMask.slice(0, 6)}...${accountConnectedToMetaMask.slice(-4)}`;
      }

      // Always ensure fresh contract details are loaded
      try {
        const response = await fetch('/fetchContractDetails');
        const data = await response.json();
        window.localStorage.setItem("Users_ContractABI", JSON.stringify(data.Users.abi));
        window.localStorage.setItem("Users_ContractAddress", data.Users.address);
        window.localStorage.setItem("LandRegistry_ContractABI", JSON.stringify(data.LandRegistry.abi));
        window.localStorage.setItem("LandRegistry_ContractAddress", data.LandRegistry.address);
        window.localStorage.setItem("TransferOwnership_ContractABI", JSON.stringify(data.TransferOwnership.abi));
        window.localStorage.setItem("TransferOwnership_ContractAddress", data.TransferOwnership.address);
      } catch (e) {
        console.error("Error fetching contract details:", e);
      }

      await fetchUserDetails();
      await fetchMyRequestedSales();
    } catch (error) {
      console.error(error);
      alert(error);
    }
  } else {
    alert("Please Add Metamask extension for your browser !!");
  }
}

async function fetchUserDetails() {
  let contractABI = JSON.parse(window.localStorage.Users_ContractABI);
  let contractAddress = window.localStorage.Users_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  try {
    const userDetails = await contract.methods.users(accountUsedToLogin).call();
    if (userDetails && userDetails["userID"] && userDetails["userID"].toLowerCase() === accountUsedToLogin.toLowerCase()) {
      const nameEl = document.getElementById("nameOfUser");
      if (nameEl) nameEl.innerText = `${userDetails["firstName"]} ${userDetails["lastName"]}`;
    }
  } catch (e) {}
}

async function fetchMyRequestedSales() {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  try {
    const sales = await contract.methods.getRequestedSales(accountUsedToLogin).call();
    allRequestedSales = sales || [];
    const tableBody = document.getElementById("salesTableBody");
    let tableCode = "";

    if (!sales || sales.length === 0) {
      tableBody.innerHTML = `<tr><td colspan='7' class='text-center py-5 text-muted'>
        <i class="fa-solid fa-handshake-slash fs-2 mb-2 d-block text-muted"></i>
        You have not submitted any purchase offers yet. Visit the <a href="/availableToBuy">Marketplace</a> to browse properties.
      </td></tr>`;
      return;
    }

    for (let i = 0; i < sales.length; i++) {
      let sale = sales[i];
      let salePriceEth = web3.utils.fromWei(sale.price.toString(), "ether");
      
      // Query specific status for this buyer
      let reqUser = await contract.methods.getStatusOfPurchaseRequest(sale.saleId).call({ from: accountUsedToLogin });
      let offeredPriceEth = web3.utils.fromWei(reqUser.priceOffered.toString(), "ether");
      let uState = parseInt(reqUser.state);
      let sState = parseInt(sale.state);

      let isAcceptedBuyer = (sale.acceptedFor && sale.acceptedFor.toLowerCase() === accountUsedToLogin.toLowerCase());

      let row = "<tr>";
      row += `<td class="fw-semibold text-muted">${i + 1}</td>`;
      row += `<td><span class="badge bg-primary-subtle text-primary border fw-bold px-2 py-1">Sale #${sale.saleId}</span></td>`;
      row += `<td><span class="badge bg-light text-dark border">Prop #${sale.propertyId}</span></td>`;
      row += `<td><strong class="text-muted">${salePriceEth} ETH</strong></td>`;
      row += `<td><strong class="text-success fs-6">${offeredPriceEth} ETH</strong></td>`;
      row += `<td>${handleEscrowState(uState, sState, isAcceptedBuyer)}</td>`;
      row += `<td>${handleBuyerAction(sale.saleId, uState, sState, offeredPriceEth, isAcceptedBuyer)}</td>`;
      row += "</tr>";
      tableCode += row;
    }

    tableBody.innerHTML = tableCode;
  } catch (error) {
    console.error("fetchMyRequestedSales error:", error);
  }
}

function handleEscrowState(userState, saleState, isAcceptedBuyer) {
  if (saleState === 3 || userState === 7) {
    return "<span class='badge-status badge-verified'><i class='fa-solid fa-check-double me-1'></i> Ownership Transferred</span>";
  }
  // State 2 in RequestedUserToASaleState is SellerAcceptedPurchaseRequest
  if (userState === 2 || isAcceptedBuyer || (saleState === 1 && isAcceptedBuyer)) {
    return "<span class='badge-status badge-onsale'><i class='fa-solid fa-star me-1'></i> Offer Accepted! Ready to Pay</span>";
  }
  if (userState === 0 && saleState === 0) {
    return "<span class='badge-status badge-pending'><i class='fa-solid fa-clock me-1'></i> Awaiting Seller Decision</span>";
  }
  if (userState === 1) {
    return "<span class='badge-status badge-disputed'>Cancelled by You</span>";
  }
  if (userState === 3) {
    return "<span class='badge-status badge-disputed'>Offer Rejected</span>";
  }
  if (saleState === 4) {
    return "<span class='badge-status badge-disputed'>Payment Deadline Passed</span>";
  }
  if (saleState === 2) {
    return "<span class='badge-status badge-disputed'>Listing Cancelled</span>";
  }
  return "<span class='badge-status badge-pending'>Pending</span>";
}

function handleBuyerAction(saleId, userState, saleState, priceEth, isAcceptedBuyer) {
  if (saleState === 3 || userState === 7) {
    return "<span class='badge bg-success-subtle text-success border px-2 py-1'><i class='fa-solid fa-check me-1'></i> You Own This Land</span>";
  }
  // If offer is accepted by seller, buyer can pay via escrow transfer
  if (userState === 2 || isAcceptedBuyer || (saleState === 1 && isAcceptedBuyer)) {
    return `<button class='btn btn-sm btn-dapp-success' onclick='executePurchase(${saleId}, ${priceEth})'>
      <i class="fa-solid fa-coins me-1"></i> Pay ${priceEth} ETH & Complete
    </button>`;
  }
  if (userState === 0 && saleState === 0) {
    return `
      <div class="btn-group btn-group-sm">
        <button class='btn btn-outline-secondary' onclick='updateOffer(${saleId}, ${priceEth})'>Update Offer</button>
        <button class='btn btn-outline-danger' onclick='cancelRequest(${saleId})'>Cancel</button>
      </div>
    `;
  }
  return "<span class='text-muted small'>—</span>";
}

async function executePurchase(saleId, priceInEth) {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  if (!confirm(`Are you ready to transfer ${priceInEth} ETH and finalize land ownership on the blockchain?`)) {
    return;
  }

  try {
    const valueWei = web3.utils.toWei(priceInEth.toString(), "ether");
    showTransactionLoading(`Executing atomic Escrow settlement for Sale #${saleId} (${priceInEth} ETH)...`);

    await contract.methods.transferOwnerShip(saleId).send({
      from: accountUsedToLogin,
      value: valueWei
    });

    closeTransactionLoading();

    // Trigger Phase 9 Real-Time SMS notification for transfer completion
    try {
      const currentSale = (allRequestedSales || []).find(s => s.saleId == saleId);
      if (currentSale) {
        await fetch('/api/notifications/notify_transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellerWallet: currentSale.owner,
            buyerWallet: accountUsedToLogin,
            propertyId: currentSale.propertyId,
            priceEth: priceInEth
          })
        });
      }
    } catch (e) {}

    if (typeof window.triggerCelebrationModal === 'function') {
      const currentSale = (allRequestedSales || []).find(s => s.saleId == saleId);
      const propId = currentSale ? currentSale.propertyId : saleId;
      window.triggerCelebrationModal(propId, saleId, accountUsedToLogin);
    }
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> CONGRATULATIONS! Property deed ownership has been successfully transferred to your wallet on the Ethereum blockchain!`, "alert-success", "block");
    fetchMyRequestedSales();
  } catch (error) {
    console.error(error);
    const reason = showError(error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Settlement failed: ${reason}`, "alert-danger", "block");
  }
}

async function updateOffer(saleId, currentPrice) {
  const promptInput = document.getElementById("prompt-input");
  if (promptInput) promptInput.value = currentPrice;

  const newPrice = await showPrompt();
  if (newPrice && parseFloat(newPrice) > 0) {
    const priceEthInt = Math.floor(parseFloat(newPrice));
    if (priceEthInt <= 0) {
      alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Price offered must be a positive whole number in ETH (at least 1 ETH).`, "alert-danger", "block");
      return;
    }
    let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
    let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
    let contract = new window.web3.eth.Contract(contractABI, contractAddress);
    let accountUsedToLogin = window.localStorage["userAddress"];

    try {
      showTransactionLoading(`Updating purchase offer to ${priceEthInt} ETH...`);
      await contract.methods.rerequestPurchaseRequest(saleId, priceEthInt).send({ from: accountUsedToLogin });
      closeTransactionLoading();
      alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Offer updated to ${priceEthInt} ETH!`, "alert-success", "block");
      fetchMyRequestedSales();
    } catch (error) {
      console.error(error);
      const reason = showError(error);
      closeTransactionLoading();
      alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
    }
  }
}

async function cancelRequest(saleId) {
  if (!confirm("Are you sure you want to withdraw your purchase offer?")) return;

  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  try {
    showTransactionLoading("Withdrawing offer on-chain...");
    await contract.methods.cancelPurchaseRequestSentToSeller(saleId).send({ from: accountUsedToLogin });
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Purchase offer cancelled.`, "alert-info", "block");
    fetchMyRequestedSales();
  } catch (error) {
    console.error(error);
    const reason = showError(error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
  }
}

function showTransactionLoading(msg) {
  const loadingDiv = document.getElementById("loadingDiv");
  if (loadingDiv) {
    const p = loadingDiv.querySelector("p");
    if (p) p.innerHTML = msg;
    loadingDiv.style.display = "block";
  }
}

function closeTransactionLoading() {
  const loadingDiv = document.getElementById("loadingDiv");
  if (loadingDiv) {
    loadingDiv.style.display = "none";
  }
}

function showError(errorOnTransaction) {
  if (!errorOnTransaction) return "Unknown transaction error";
  if (errorOnTransaction.code === 4001) return "Transaction rejected in MetaMask.";
  try {
    const start = errorOnTransaction.message.indexOf('{');
    if (start !== -1) {
      const errorObj = JSON.parse(errorOnTransaction.message.slice(start, -1));
      const txHash = Object.getOwnPropertyNames(errorObj.value.data.data)[0];
      return errorObj.value.data.data[txHash].reason || errorOnTransaction.message;
    }
  } catch (e) {}
  return errorOnTransaction.message || "Transaction error";
}

function alertUser(msg, msgType, display) {
  const notifyUser = document.getElementById("notifyUser");
  if (notifyUser) {
    notifyUser.className = `alert ${msgType}`;
    notifyUser.innerHTML = msg;
    notifyUser.style.display = display;
  }
}

function showPrompt() {
  const containerBackCover = document.getElementById('prompt-container-backcover');
  const input = document.getElementById('prompt-input');
  const okButton = document.getElementById('prompt-ok');
  const cancelButton = document.getElementById('prompt-cancel');

  containerBackCover.style.display = 'block';

  return new Promise((resolve) => {
    const onOk = () => {
      containerBackCover.style.display = 'none';
      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      resolve(input.value);
    };
    const onCancel = () => {
      containerBackCover.style.display = 'none';
      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      resolve(null);
    };
    okButton.addEventListener('click', onOk);
    cancelButton.addEventListener('click', onCancel);
  });
}
