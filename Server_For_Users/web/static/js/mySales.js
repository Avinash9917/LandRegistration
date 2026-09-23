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
      await fetchMySales();
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

async function fetchMySales() {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  try {
    const sales = await contract.methods.getMySales(accountUsedToLogin).call();
    const tableBody = document.getElementById("salesTableBody");
    let tableCode = "";

    if (!sales || sales.length === 0) {
      tableBody.innerHTML = `<tr><td colspan='8' class='text-center py-5 text-muted'>
        <i class="fa-solid fa-tags fs-2 mb-2 d-block text-muted"></i>
        You have no active sales listings created yet. Go to <a href="/dashboard">My Properties</a> to list a verified property.
      </td></tr>`;
      return;
    }

    for (let i = 0; i < sales.length; i++) {
      let sale = sales[i];
      let priceEth = web3.utils.fromWei(sale.price.toString(), "ether");
      let acceptedBuyer = sale.acceptedFor;
      let hasAccepted = acceptedBuyer && acceptedBuyer !== "0x0000000000000000000000000000000000000000";

      let row = "<tr>";
      row += `<td class="fw-semibold text-muted">${i + 1}</td>`;
      row += `<td><span class="badge bg-primary-subtle text-primary border fw-bold px-2 py-1">Sale #${sale.saleId}</span></td>`;
      row += `<td><span class="badge bg-light text-dark border">Prop #${sale.propertyId}</span></td>`;
      row += `<td><strong class="text-success fs-6">${priceEth} ETH</strong></td>`;
      row += `<td>${hasAccepted ? `<code>${acceptedBuyer.slice(0, 6)}...${acceptedBuyer.slice(-4)}</code>` : '<span class="text-muted small">None</span>'}</td>`;
      row += `<td>${handleSaleState(sale.state)}</td>`;
      row += `<td>
        <button class='btn btn-sm btn-outline-primary' onclick='getRequestedUsers(${sale.saleId}, ${sale.propertyId})'>
          <i class="fa-solid fa-users me-1"></i> View Offers
        </button>
      </td>`;
      row += `<td>
        ${parseInt(sale.state) === 0 ? `
          <button class='btn btn-sm btn-outline-danger' onclick='cancelSale(${sale.saleId})'>
            <i class="fa-solid fa-ban me-1"></i> Delist
          </button>
        ` : (parseInt(sale.state) === 3 ? '<span class="badge bg-success-subtle text-success border">Sold</span>' : '<span class="text-muted small">—</span>')}
      </td>`;
      row += "</tr>";
      tableCode += row;
    }

    tableBody.innerHTML = tableCode;
  } catch (error) {
    console.error("fetchMySales error:", error);
  }
}

function handleSaleState(state) {
  state = parseInt(state);
  if (state === 0) return "<span class='badge-status badge-onsale'><i class='fa-solid fa-tag me-1'></i> Active Listing</span>";
  if (state === 1) return "<span class='badge-status badge-pending'><i class='fa-solid fa-handshake me-1'></i> Offer Accepted</span>";
  if (state === 2) return "<span class='badge-status badge-disputed'>Cancelled by You</span>";
  if (state === 3) return "<span class='badge-status badge-verified'><i class='fa-solid fa-check-double me-1'></i> Completed & Transferred</span>";
  if (state === 4) return "<span class='badge-status badge-disputed'>Deadline Expired</span>";
  return "<span class='badge-status badge-pending'>Pending</span>";
}

async function getRequestedUsers(saleId, propertyId) {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);

  const propBadge = document.getElementById("propertyId");
  if (propBadge) propBadge.innerText = `#${propertyId} (Sale #${saleId})`;

  const requestedTableBody = document.getElementById("requestedUsersOfaSaleTableBody");
  requestedTableBody.innerHTML = "<tr><td colspan='5' class='text-center py-4 text-muted'>Loading bidders...</td></tr>";

  toggleSalesAndRequestedUsersTables();

  try {
    const users = await contract.methods.getRequestedUsers(saleId).call();
    let tableCode = "";

    if (!users || users.length === 0) {
      requestedTableBody.innerHTML = "<tr><td colspan='5' class='text-center py-4 text-muted'>No purchase offers received for this sale yet.</td></tr>";
      return;
    }

    for (let i = 0; i < users.length; i++) {
      let u = users[i];
      let offerEth = web3.utils.fromWei(u.priceOffered.toString(), "ether");

      let row = "<tr>";
      row += `<td class="fw-semibold text-muted">${i + 1}</td>`;
      row += `<td><code>${u.user}</code></td>`;
      row += `<td><strong class="text-success fs-6">${offerEth} ETH</strong></td>`;
      row += `<td>${handleUserState(u.state)}</td>`;
      row += `<td>
        ${parseInt(u.state) === 0 ? `
          <button class='btn btn-sm btn-dapp-success' onclick='acceptBuyerOffer(${saleId}, "${u.user}", ${offerEth})'>
            <i class="fa-solid fa-check me-1"></i> Accept Offer
          </button>
        ` : '<span class="text-muted small">—</span>'}
      </td>`;
      row += "</tr>";
      tableCode += row;
    }

    requestedTableBody.innerHTML = tableCode;
  } catch (error) {
    console.error("getRequestedUsers error:", error);
  }
}

function handleUserState(state) {
  state = parseInt(state);
  if (state === 0) return "<span class='badge-status badge-pending'>Offer Sent</span>";
  if (state === 1) return "<span class='badge-status badge-disputed'>Cancelled by Buyer</span>";
  if (state === 2) return "<span class='badge-status badge-verified'><i class='fa-solid fa-check me-1'></i> Offer Accepted</span>";
  if (state === 3) return "<span class='badge-status badge-disputed'>Rejected</span>";
  if (state === 4) return "<span class='badge-status badge-disputed'>Revoked</span>";
  if (state === 7) return "<span class='badge-status badge-verified'>Transferred</span>";
  return "<span class='badge-status badge-pending'>Pending</span>";
}

async function acceptBuyerOffer(saleId, buyer, priceEth) {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  if (!confirm(`Are you sure you want to accept ${buyer}'s offer for ${priceEth} ETH? This will lock the escrow for payment settlement.`)) {
    return;
  }

  try {
    const priceEthInt = Math.floor(parseFloat(priceEth));
    showTransactionLoading(`Accepting offer from ${buyer.slice(0, 6)}... on blockchain...`);
    await contract.methods.acceptBuyerRequest(saleId, buyer, priceEthInt).send({ from: accountUsedToLogin });
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Offer accepted! Buyer has been designated to complete the payment settlement in Escrow.`, "alert-success", "block");
    toggleSalesAndRequestedUsersTables();
    fetchMySales();
  } catch (error) {
    console.error(error);
    const reason = showError(error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
  }
}

async function cancelSale(saleId) {
  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  if (!confirm("Are you sure you want to cancel and delist this property?")) return;

  try {
    showTransactionLoading(`Cancelling Sale #${saleId} on-chain...`);
    await contract.methods.cancelSaleBySeller(saleId).send({ from: accountUsedToLogin });
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Sale #${saleId} cancelled successfully.`, "alert-success", "block");
    fetchMySales();
  } catch (error) {
    console.error(error);
    const reason = showError(error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
  }
}

function toggleSalesAndRequestedUsersTables() {
  const sales = document.getElementById("salesTable");
  const req = document.getElementById("requestedUsersOfaSale");

  if (sales.style.display === "none") {
    sales.style.display = "block";
    req.style.display = "none";
  } else {
    sales.style.display = "none";
    req.style.display = "block";
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