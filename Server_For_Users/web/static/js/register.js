async function checkConnection() {
  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await web3.eth.getAccounts();
      const account = accounts[0];

      console.log("Connected To metamask:", account);
      console.log("Account Used to Login:", window.localStorage["userAddress"]);

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

      if (account) {
        window.localStorage.setItem("userAddress", account);
        window.userAddress = account;
        alertUser(
          `Wallet Connected : <strong class="text-white">${account.slice(0, 6)}...${account.slice(-4)}</strong> <span class="badge bg-success ms-2"><i class="fa-solid fa-circle-check"></i> Ready</span>`,
          'alert-success',
          'block'
        );
      }
    } catch (error) {
      alert(error);
    }
  } else {
    alert("Please Add Metamask extension for your browser !!");
  }
}

let isPhoneVerified = false;

async function requestPhoneOtp() {
  const phone = document.getElementById("phoneNumber").value.trim();
  const account = window.localStorage["userAddress"];

  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit mobile phone number.");
    return;
  }

  const sendBtn = document.getElementById("sendOtpBtn");
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
  }

  try {
    const res = await fetch('/api/auth/send_otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: account, phone: phone })
    });
    const data = await res.json();

    if (data.status === 'OK') {
      document.getElementById("otpSection").style.display = "block";
      const statusNotice = document.getElementById("otpStatusNotice");
      if (statusNotice) {
        statusNotice.innerHTML = `
          <div class="alert alert-info py-2 px-3 mb-0 small">
            <i class="fa-solid fa-paper-plane me-1"></i> SMS Verification Code sent to <strong>+91-${data.data.phone}</strong>.
            <div class="mt-1">Verification Code: <strong class="badge bg-dark fs-6">${data.data.otp}</strong></div>
          </div>
        `;
      }
      const otpInput = document.getElementById("otpCode");
      otpInput.value = "";
      otpInput.focus();
    } else {
      alert("Failed to dispatch OTP: " + (data.message || 'Error'));
    }
  } catch (err) {
    console.error("OTP send error:", err);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fa-solid fa-rotate-right me-1"></i> Resend OTP';
    }
  }
}

async function submitPhoneOtp() {
  const phone = document.getElementById("phoneNumber").value.trim();
  const email = document.getElementById("emailAddress") ? document.getElementById("emailAddress").value.trim() : "";
  const otp = document.getElementById("otpCode").value.trim();
  const account = window.localStorage["userAddress"];

  if (!otp || otp.length !== 6) {
    alert("Please enter the 6-digit verification code.");
    return;
  }

  const verifyBtn = document.getElementById("verifyOtpBtn");
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
  }

  try {
    const res = await fetch('/api/auth/verify_otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: account,
        otp: otp,
        phone: phone,
        email: email
      })
    });
    const data = await res.json();

    if (data.status === 'OK') {
      isPhoneVerified = true;
      const statusNotice = document.getElementById("otpStatusNotice");
      if (statusNotice) {
        statusNotice.innerHTML = `<span class="text-success fw-bold"><i class="fa-solid fa-shield-check me-1"></i> Mobile number +91-${phone} verified & encrypted at rest!</span>`;
      }
      document.getElementById("phoneNumber").readOnly = true;
      document.getElementById("sendOtpBtn").style.display = "none";
      verifyBtn.className = "btn btn-outline-success disabled";
      verifyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Verified';
    } else {
      alert("Invalid OTP: " + (data.message || 'Verification failed'));
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = '<i class="fa-solid fa-check me-1"></i> Verify OTP';
      }
    }
  } catch (err) {
    console.error("OTP verification error:", err);
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = '<i class="fa-solid fa-check me-1"></i> Verify OTP';
    }
  }
}

async function registerUser(event) {
  event.preventDefault();
  alertUser("", "alert-info", "none");

  let fname = document.getElementById("firstName").value.trim();
  let lname = document.getElementById("lastName").value.trim();
  let dob = document.getElementById("dob").value;
  let aadharNo = document.getElementById("aadharNo").value.trim();
  let phone = document.getElementById("phoneNumber").value.trim();
  let email = document.getElementById("emailAddress") ? document.getElementById("emailAddress").value.trim() : "";

  let contractABI = JSON.parse(window.localStorage.Users_ContractABI);
  let contractAddress = window.localStorage.Users_ContractAddress;
  let contract = window.contract = new window.web3.eth.Contract(contractABI, contractAddress);

  let accountUsedToLogin = window.localStorage["userAddress"];

  if (!isPhoneVerified) {
    alertUser("<i class='fa-solid fa-triangle-exclamation me-1'></i> Please verify your Mobile Phone Number using OTP before completing on-chain registration.", "alert-warning", "block");
    return;
  }

  try {
    const accounts = await web3.eth.getAccounts();
    const connectedAccountToMetaMask = accounts[0];

    if (connectedAccountToMetaMask.toLowerCase() !== accountUsedToLogin.toLowerCase()) {
      alertUser(
        `Account Mismatched. Please connect "${accountUsedToLogin.slice(0, 6)}...${accountUsedToLogin.slice(-4)}" in MetaMask`,
        "alert-warning",
        "block"
      );
      return;
    }

    showTransactionLoading("Processing Encrypted KYC & Salted Hash...");

    // Step 1: Encrypt Aadhaar off-chain and get privacy-preserving salted hash
    const kycResponse = await fetch('/api/kyc/prepare_registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: fname,
        lastName: lname,
        dob: dob,
        aadharNo: aadharNo,
        walletAddress: accountUsedToLogin
      })
    });

    const kycData = await kycResponse.json();
    if (kycData.status !== 'success' || !kycData.aadharHash) {
      closeTransactionLoading();
      alertUser(`KYC Verification Failed: ${kycData.message || 'Unknown error'}`, "alert-danger", "block");
      return;
    }

    const rawAadharHash = kycData.aadharHash;
    const aadharHash = (typeof rawAadharHash === 'string' && rawAadharHash.startsWith("0x")) ? rawAadharHash : ("0x" + rawAadharHash);
    console.log("Off-chain KYC complete. Submitting salted hash on-chain:", aadharHash);

    // Step 2: Submit on-chain registration with salted hash (no plaintext Aadhaar)
    showTransactionLoading("Submitting On-Chain Registration Transaction...");

    window.result = await contract.methods
      .registerUser(fname, lname, dob, aadharHash)
      .send({ from: accountUsedToLogin });

    const userDetails = await contract.methods.users(accountUsedToLogin).call();

    if (userDetails["userID"].toLowerCase() === accountUsedToLogin.toLowerCase()) {
      console.log("Registered Successfully");
      showTransactionLoading(`Registered Successfully with On-Chain Privacy Protection!<br> Redirecting to Dashboard...`);
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1500);
    } else {
      closeTransactionLoading();
      alertUser("Registration failed. Please try again.", "alert-danger", "block");
    }
  } catch (error) {
    console.error(error);
    const reason = showError(error);
    closeTransactionLoading();
    alertUser(reason, "alert-danger", "block");
  }
}

function showTransactionLoading(msg) {
  const loadingDiv = document.getElementById("loadingDiv");
  if (loadingDiv) {
    const p = loadingDiv.querySelector("p");
    if (p) p.innerHTML = msg;
    else if (loadingDiv.children.length > 0) loadingDiv.children[0].innerHTML = msg;
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
  if (errorOnTransaction.code === 4001) {
    return "Transaction rejected in MetaMask.";
  }
  try {
    const start = errorOnTransaction.message.indexOf('{');
    const end = -1;
    if (start !== -1) {
      const errorObj = JSON.parse(errorOnTransaction.message.slice(start, end));
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
