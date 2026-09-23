async function connectToBlockchain() {
  const notifyUser = document.getElementById("notifyUser");
  const loadingDiv = document.getElementById("loadingDiv");
  const loadingTitle = document.getElementById("loadingTitle");
  const loadingDesc = document.getElementById("loadingDesc");

  if (notifyUser) notifyUser.style.display = "none";

  if (!window.ethereum) {
    if (notifyUser) {
      notifyUser.className = "alert alert-danger py-2 px-3 small";
      notifyUser.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i> MetaMask extension not detected! Please install MetaMask to continue.';
      notifyUser.style.display = "block";
    }
    return;
  }

  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) connectBtn.classList.add("btn-connecting-pulse");

  try {
    if (loadingDiv) loadingDiv.style.display = "block";
    if (loadingTitle) loadingTitle.innerText = "Connecting Wallet...";
    if (loadingDesc) loadingDesc.innerText = "Please accept the connection request in MetaMask.";

    window.web3 = new Web3(ethereum);

    // Request account access
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const account = accounts[0];
    window.localStorage.setItem("userAddress", account);
    window.userAddress = account;

    console.log("Connected account:", account);

    if (connectBtn && typeof window.triggerParticleBurst === 'function') {
      window.triggerParticleBurst(connectBtn);
    }

    if (loadingTitle) loadingTitle.innerText = "Checking Registration...";
    if (loadingDesc) loadingDesc.innerText = `Wallet: ${account.slice(0, 6)}...${account.slice(-4)}`;

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

    const contractABI = JSON.parse(window.localStorage.Users_ContractABI);
    const contractAddress = window.localStorage.Users_ContractAddress;
    const usersContract = new window.web3.eth.Contract(contractABI, contractAddress);

    // Ensure connected to Sepolia network (Chain ID 11155111 / 0xaa36a7)
    const targetChainId = "0xaa36a7";
    try {
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentChainId !== targetChainId) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainId }]
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: targetChainId,
                chainName: 'Sepolia Testnet',
                nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia'],
                blockExplorerUrls: ['https://sepolia.etherscan.io']
              }]
            });
          }
        }
      }
    } catch (chainErr) {
      console.warn("Chain switch check warning:", chainErr);
    }

    // Query on-chain user details with public RPC fallback if MetaMask RPC rate-limits
    let userDetails = null;
    try {
      userDetails = await usersContract.methods.users(account).call();
    } catch (rpcErr) {
      console.warn("MetaMask RPC read failed, using public Sepolia RPC fallback:", rpcErr);
      const fallbackWeb3 = new Web3("https://ethereum-sepolia-rpc.publicnode.com");
      const fallbackContract = new fallbackWeb3.eth.Contract(contractABI, contractAddress);
      userDetails = await fallbackContract.methods.users(account).call();
    }

    if (userDetails && userDetails["userID"] && userDetails["userID"].toLowerCase() === account.toLowerCase()) {
      if (loadingTitle) loadingTitle.innerText = "Login Successful!";
      if (loadingDesc) loadingDesc.innerText = `Welcome back, ${userDetails["firstName"]}! Redirecting...`;
      
      if (typeof window.triggerLoginSuccess3D === 'function') {
        window.triggerLoginSuccess3D(() => {
          window.location.href = "/dashboard";
        });
      } else {
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 700);
      }
    } else {
      if (loadingTitle) loadingTitle.innerText = "New Citizen Detected";
      if (loadingDesc) loadingDesc.innerText = "Redirecting to initial registration...";
      
      if (typeof window.triggerLoginSuccess3D === 'function') {
        window.triggerLoginSuccess3D(() => {
          window.location.href = "/register";
        });
      } else {
        setTimeout(() => {
          window.location.href = "/register";
        }, 700);
      }
    }
  } catch (error) {
    console.error(error);
    if (loadingDiv) loadingDiv.style.display = "none";
    if (connectBtn) connectBtn.classList.remove("btn-connecting-pulse");
    if (notifyUser) {
      notifyUser.className = "alert alert-danger py-2 px-3 small";
      notifyUser.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-1"></i> Connection failed: ${error.message || error}`;
      notifyUser.style.display = "block";
    }
  }
}