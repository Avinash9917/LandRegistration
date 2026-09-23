async function connectToBlockchain() {
  if (window.ethereum) {
    window.web3 = new Web3(ethereum);

    try {
      alertUser('', 'alert-info', 'none');
      showTransactionLoading('Connecting Officer Wallet...');

      const connectBtn = document.querySelector("#connectToBlockchainDiv button");
      if (connectBtn) connectBtn.classList.add("btn-connecting-pulse");

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const officerAccount = accounts[0];
      window.localStorage.setItem("employeeId", officerAccount);
      window.employeeId = officerAccount;

      if (connectBtn && typeof window.triggerParticleBurst === 'function') {
        window.triggerParticleBurst(connectBtn);
      }

      // Cache contract details
      if (!window.localStorage.LandRegistry_ContractABI) {
        const response = await fetch('/fetchContractDetails');
        const data = await response.json();
        window.localStorage.setItem("LandRegistry_ContractABI", JSON.stringify(data.LandRegistry.abi));
        window.localStorage.setItem("LandRegistry_ContractAddress", data.LandRegistry.address);
      }

      document.getElementById("connectToBlockchainDiv").style.display = "none";
      document.getElementById("passwordDiv").style.display = "block";

      closeTransactionLoading();
      alertUser(`<i class="fa-solid fa-circle-check me-1"></i> Connected with ${officerAccount.slice(0, 6)}...${officerAccount.slice(-4)}. Enter PIN to login.`, 'alert-success', 'block');
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
  let employeeId = window.localStorage["employeeId"];
  
  // If window.ethereum is active, get current selected account
  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await web3.eth.getAccounts();
      if (accounts && accounts.length > 0) {
        employeeId = accounts[0];
        window.localStorage.setItem("employeeId", employeeId);
      }
    } catch (e) {}
  }

  let password = document.getElementById("password").value;

  if (!employeeId) {
    alertUser("Please click Connect Officer Wallet first!", "alert-danger", "block");
    return;
  }

  showTransactionLoading("Authenticating credentials...");

  const formData = new FormData();
  formData.append('employeeId', employeeId);
  formData.append('password', password);

  fetch('/login', {
    method: 'POST',
    body: formData
  })
    .then(response => response.json())
    .then(data => {
      closeTransactionLoading();
      let status = data['status'];
      let msg = data['msg'];

      if (status == 1) {
        let revenueDepartmentId = data["revenueDepartmentId"];
        window.localStorage.revenueDepartmentId = revenueDepartmentId;
        window.localStorage.empName = data['empName'];
        window.location.href = "/dashboard";
      } else {
        alertUser(msg || "Invalid Wallet or password", 'alert-danger', 'block');
      }
    })
    .catch(error => {
      closeTransactionLoading();
      console.error(error);
      alertUser('Authentication service error: ' + error.message, 'alert-danger', 'block');
    });
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
  if (!errorOnTransaction) return "Transaction error";
  if (errorOnTransaction.code === 4001) return "Connection rejected in MetaMask.";
  return errorOnTransaction.message || "Connection error";
}

function alertUser(msg, msgType, display) {
  const notifyUser = document.getElementById("notifyUser");
  if (notifyUser) {
    notifyUser.className = `alert ${msgType}`;
    notifyUser.innerHTML = msg;
    notifyUser.style.display = display;
  }
}
