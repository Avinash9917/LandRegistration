async function connectToBlockchain() {
  if (window.ethereum) {
    window.web3 = new Web3(ethereum);

    try {
      alertUser('', 'alert-info', 'none');
      showTransactionLoading('Connecting Admin Wallet...');

      const connectBtn = document.querySelector("#connectToBlockchainDiv button");
      if (connectBtn) connectBtn.classList.add("btn-connecting-pulse");

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      window.localStorage.setItem("adminAddress", accounts[0]);
      window.employeeId = accounts[0];

      if (connectBtn && typeof window.triggerParticleBurst === 'function') {
        window.triggerParticleBurst(connectBtn);
      }

      // Ensure fresh contract details are loaded
      try {
        const response = await fetch('/fetchContractDetails');
        const data = await response.json();
        if (data.LandRegistry) {
          window.localStorage.setItem("LandRegistry_ContractABI", JSON.stringify(data.LandRegistry.abi));
          window.localStorage.setItem("LandRegistry_ContractAddress", data.LandRegistry.address);
        }
      } catch (e) {
        console.error("Error fetching contract details:", e);
      }

      document.getElementById("connectToBlockchainDiv").style.display = "none";
      document.getElementById("passwordDiv").style.display = "block";

      closeTransactionLoading();
      alertUser('<i class="fa-solid fa-circle-check me-1"></i> Admin Wallet connected! Enter your Security Key (12345678) to proceed.', 'alert-success', 'block');
    } catch (error) {
      console.error(error);
      closeTransactionLoading();
      alertUser(showError(error), 'alert-danger', 'block');
    }
  } else {
    alertUser('Please Add MetaMask extension for your browser!', 'alert-danger', 'block');
  }
}

async function login() {
  let adminAddress = window.localStorage["adminAddress"];

  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        adminAddress = accounts[0];
        window.localStorage.setItem("adminAddress", adminAddress);
      }
    } catch (e) {}
  }

  if (!adminAddress) {
    adminAddress = "0x8B6E223052b17033BBC5D4a019f0A48565629e47";
    window.localStorage.setItem("adminAddress", adminAddress);
  }

  let password = document.getElementById("password").value.trim();
  if (!password) password = "12345678";

  const formData = new FormData();
  formData.append('adminAddress', adminAddress);
  formData.append('password', password);

  try {
    const response = await fetch('/adminLogin', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (data.status == 1) {
      alertUser('', 'alert-info', 'none');
      document.getElementById('connectToBlockchainDiv').style.display = "none";
      document.getElementById('passwordDiv').style.display = "none";
      document.getElementById('dashboardDiv').style.display = "block";
      alertUser('<i class="fa-solid fa-shield-check me-1"></i> Super Admin Authenticated Successfully!', 'alert-success', 'block');
    } else {
      alertUser(data.msg || 'Invalid Admin Credentials', 'alert-danger', 'block');
    }
  } catch (error) {
    console.error(error);
    alertUser('Error connecting to authentication server', 'alert-danger', 'block');
  }
}

// Auto-check connection on load
window.addEventListener('DOMContentLoaded', async () => {
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        window.localStorage.setItem("adminAddress", accounts[0]);
        window.employeeId = accounts[0];
      }
    } catch (e) {}
  }
});

async function addEmployee(event) {
  event.preventDefault();

  let employeeWallet = document.getElementById("employeeWallet").value.trim();
  let password = document.getElementById("empPassword").value;
  let firstname = document.getElementById("firstname").value;
  let lastName = document.getElementById("lastName").value;
  let revenueDeptId = document.getElementById("revenueDeptId").value;

  if (!web3.utils.isAddress(employeeWallet)) {
    alertUser("Invalid Ethereum wallet address format!", "alert-danger", "block");
    return;
  }

  try {
    showTransactionLoading("Granting on-chain OFFICER_ROLE & mapping jurisdiction ID...");

    let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
    let contractAddress = window.localStorage.LandRegistry_ContractAddress;
    let contract = new window.web3.eth.Contract(contractABI, contractAddress);
    let adminAddress = window.localStorage["adminAddress"];

    // Execute on-chain officer mapping (uint256 revenueDeptId, address employeeAddress)
    await contract.methods.mapRevenueDeptIdToEmployee(parseInt(revenueDeptId), employeeWallet).send({ from: adminAddress });

    showTransactionLoading("Storing officer credentials in MongoDB...");

    const formData = new FormData();
    formData.append('employeeWallet', employeeWallet);
    formData.append('password', password);
    formData.append('firstname', firstname);
    formData.append('lastName', lastName);
    formData.append('revenueDeptId', revenueDeptId);

    const response = await fetch('/addEmployee', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    closeTransactionLoading();

    if (data.status == 1) {
      alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Officer <strong>${firstname} ${lastName}</strong> successfully authorized on-chain for Revenue Dept #${revenueDeptId}!`, 'alert-success', 'block');
      document.getElementById("employeeWallet").value = "";
      document.getElementById("firstname").value = "";
      document.getElementById("lastName").value = "";
      document.getElementById("revenueDeptId").value = "";
    } else {
      alertUser(data.msg || "Error storing officer in database", 'alert-danger', 'block');
    }
  } catch (error) {
    console.error(error);
    closeTransactionLoading();
    alertUser(showError(error), 'alert-danger', 'block');
  }
}

async function pauseRegistry() {
  if (!confirm("EMERGENCY: Are you sure you want to PAUSE the Land Registry contract? All new land registrations and transfers will be suspended.")) return;

  try {
    showTransactionLoading("Broadcasting Pause command to smart contract...");
    let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
    let contractAddress = window.localStorage.LandRegistry_ContractAddress;
    let contract = new window.web3.eth.Contract(contractABI, contractAddress);
    let adminAddress = window.localStorage["adminAddress"];

    const pauseMethod = contract.methods.pauseRegistry ? contract.methods.pauseRegistry : contract.methods.pause;
    await pauseMethod().send({ from: adminAddress });
    closeTransactionLoading();
    alertUser('<i class="fa-solid fa-circle-check me-2"></i> LandRegistry has been PAUSED (Emergency breaker activated).', 'alert-warning', 'block');
  } catch (error) {
    console.error(error);
    closeTransactionLoading();
    alertUser(showError(error), 'alert-danger', 'block');
  }
}

async function unpauseRegistry() {
  if (!confirm("Are you sure you want to UNPAUSE the Land Registry contract and resume normal operations?")) return;

  try {
    showTransactionLoading("Broadcasting Unpause command to smart contract...");
    let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
    let contractAddress = window.localStorage.LandRegistry_ContractAddress;
    let contract = new window.web3.eth.Contract(contractABI, contractAddress);
    let adminAddress = window.localStorage["adminAddress"];

    const unpauseMethod = contract.methods.unpauseRegistry ? contract.methods.unpauseRegistry : contract.methods.unpause;
    await unpauseMethod().send({ from: adminAddress });
    closeTransactionLoading();
    alertUser('<i class="fa-solid fa-circle-check me-2"></i> LandRegistry has been UNPAUSED (Normal operations restored).', 'alert-success', 'block');
  } catch (error) {
    console.error(error);
    closeTransactionLoading();
    alertUser(showError(error), 'alert-danger', 'block');
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
  if (!errorOnTransaction) return "Transaction failed";
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
