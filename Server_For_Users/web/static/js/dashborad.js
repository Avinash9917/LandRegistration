async function checkConnection() {
  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await web3.eth.getAccounts();
      const accountConnectedToMetaMask = accounts[0];

      if (!accountConnectedToMetaMask) {
        alert("No active MetaMask account found. Please connect.");
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
      await fetchPropertiesOfOwner();
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
    } else {
      console.warn("Account not registered on-chain yet.");
    }
  } catch (e) {
    console.error("fetchUserDetails error:", e);
  }
}

function toggleShowProperties() {
  document.getElementById("addProperty").style.display = "none";
  document.getElementById("propertiesTable").style.display = "block";

  const addPropertyButtonDiv = document.getElementById("addPropertyButtonDiv");
  if (addPropertyButtonDiv) {
    addPropertyButtonDiv.innerHTML = '<i class="fa-solid fa-plus-circle"></i> Add Property';
    addPropertyButtonDiv.onclick = toggleAddProperty;
  }

  const notify = document.getElementById("notifyUser");
  if (notify) notify.style.display = "none";
  fetchPropertiesOfOwner();
}

function toggleAddProperty() {
  document.getElementById("propertiesTable").style.display = "none";
  document.getElementById("addProperty").style.display = "block";

  const notify = document.getElementById("notifyUser");
  if (notify) notify.style.display = "none";

  const addPropertyButtonDiv = document.getElementById("addPropertyButtonDiv");
  if (addPropertyButtonDiv) {
    addPropertyButtonDiv.innerHTML = '<i class="fa-solid fa-layer-group"></i> My Properties';
    addPropertyButtonDiv.onclick = toggleShowProperties;
  }

  setTimeout(initRegistrationMap, 100);
}

/* =========================================================
   ADD PROPERTY WITH DOCUMENT HASH ANCHORING
   ========================================================= */

async function addProperty(event) {
  event.preventDefault();
  const notifyUser = document.getElementById("notifyUser");
  if (notifyUser) notifyUser.style.display = "none";

  let location = document.getElementById("location").value;
  let revenueDeptId = document.getElementById("revenueDeptId").value;
  let surveyNo = document.getElementById("suveyNumber").value;
  let area = document.getElementById("area").value;
  let locationName = document.getElementById("locationName").value;
  let revenueDepartmentName = document.getElementById("revenueDepartmentName").value;
  let surveyNumberName = document.getElementById("surveyNumberName").value;

  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  const propertyDocFile = document.getElementById("registrationDoc").files[0];
  if (!propertyDocFile) {
    alertUser("Please select a valid deed document PDF", "alert-danger", "block");
    return;
  }

  try {
    showTransactionLoading("1/3 Pre-Validating Survey with Government Oracle...");

    // Pre-check survey with Oracle endpoint
    try {
      const oracleRes = await fetch(`/api/oracle/verify_survey?surveyNumber=${surveyNo}&revenueDeptId=${revenueDeptId}&claimant=${accountUsedToLogin}`);
      const oracleData = await oracleRes.json();
      if (oracleData.status === 'success' && !oracleData.data.valid) {
        closeTransactionLoading();
        alertUser(`Government Oracle Rejection: ${oracleData.data.reason}`, "alert-danger", "block");
        return;
      }
    } catch (e) {
      console.warn("Oracle pre-check warning:", e);
    }

    showTransactionLoading("2/3 Computing Cryptographic Deed Hash...");

    // Read file bytes and compute Keccak256 hash
    const arrayBuffer = await propertyDocFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const hexBytes = "0x" + Array.from(uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    const documentHash = web3.utils.keccak256(hexBytes);

    showTransactionLoading("3/3 Submitting Land Registration to Blockchain...");

    const tx = await contract.methods.addLand(
      location,
      revenueDeptId,
      surveyNo,
      locationName,
      revenueDepartmentName,
      surveyNumberName,
      area,
      documentHash
    ).send({ from: accountUsedToLogin });

    const landAddedEvent = tx.events.LandAdded.returnValues;
    const propertyId = landAddedEvent["propertyId"];

    showTransactionLoading("Archiving Deed to Encrypted GridFS Storage...");

    const formData = new FormData();
    formData.append('propertyDocs', propertyDocFile);
    formData.append('owner', accountUsedToLogin);
    formData.append('propertyId', propertyId);

    const uploadRes = await fetch('/uploadPropertyDocs', {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();

    // Phase 7: Save user-confirmed map coordinates
    try {
      const lat = parseFloat(document.getElementById("propLatitude")?.value) || 12.9698;
      const lng = parseFloat(document.getElementById("propLongitude")?.value) || 77.7500;
      await fetch('/api/geo/save_coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: propertyId,
          latitude: lat,
          longitude: lng,
          formattedAddress: `${locationName}, Sy. No ${surveyNumberName}`,
          userConfirmed: true
        })
      });
    } catch (e) {
      console.warn("Error saving property coordinates:", e);
    }

    // Phase 6: Run initial OCR cross-verification
    try {
      await fetch(`/api/ocr/cross_verify/${propertyId}`, { method: 'POST' });
    } catch (e) {}

    closeTransactionLoading();

    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Property #${propertyId} registered, geo-coordinates pinned, and deed hash anchored on-chain!`, "alert-success", "block");
    toggleShowProperties();
  } catch (error) {
    console.error(error);
    closeTransactionLoading();
    const reason = showError(error);
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
  }
}

async function fetchPropertiesOfOwner() {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  try {
    const properties = await contract.methods.getPropertiesOfOwner(accountUsedToLogin).call();
    const tableBody = document.getElementById("propertiesTableBody");
    let tableBodyCode = "";

    let total = properties.length;
    let verified = 0;
    let pending = 0;
    let onSale = 0;

    for (let i = 0; i < properties.length; i++) {
      let prop = properties[i];
      let stateNum = parseInt(prop["state"]);

      if (stateNum === 2 || stateNum === 5) verified++;
      else if (stateNum === 0 || stateNum === 1) pending++;
      else if (stateNum === 4) { verified++; onSale++; }

      let tableRow = "<tr>";
      tableRow += `<td class="fw-semibold text-muted">${i + 1}</td>`;
      tableRow += `<td><span class="badge bg-light text-dark border fw-bold px-2 py-1">#${prop["propertyId"]}</span></td>`;
      tableRow += `<td><strong>${prop["locationName"]}</strong><br><small class="text-muted">ID: ${prop["locationId"]}</small></td>`;
      tableRow += `<td><strong>${prop["revenueDepartmentName"]}</strong><br><small class="text-muted">Dept: ${prop["revenueDepartmentId"]}</small></td>`;
      tableRow += `<td><span class="badge bg-secondary-subtle text-secondary border px-2">${prop["surveyNumberName"]}</span></td>`;
      tableRow += `<td><span class="fw-semibold">${prop["area"]}</span> <small class="text-muted">sq.ft</small></td>`;
      tableRow += `<td>
        <div class="d-flex gap-1">
          <button class='btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1' onclick='showPdf(${prop["propertyId"]})'>
            <i class="fa-solid fa-file-pdf text-danger"></i> Deed
          </button>
          <button class='btn btn-sm btn-outline-info d-inline-flex align-items-center gap-1' onclick='openPropertyHistoryModal(${prop["propertyId"]})'>
            <i class="fa-solid fa-timeline"></i> Lifecycle
          </button>
        </div>
      </td>`;
      tableRow += `<td>${handleStateOfProperty(prop)}</td>`;
      tableRow += `<td>${showSoldButton(prop)}</td>`;
      tableRow += "</tr>";
      tableBodyCode += tableRow;
    }

    // Update Stats counters
    const statTotalEl = document.getElementById("statTotalProps");
    const statVerEl = document.getElementById("statVerifiedProps");
    const statPendEl = document.getElementById("statPendingProps");
    const statSaleEl = document.getElementById("statOnSaleProps");

    if (statTotalEl) statTotalEl.innerText = total;
    if (statVerEl) statVerEl.innerText = verified;
    if (statPendEl) statPendEl.innerText = pending;
    if (statSaleEl) statSaleEl.innerText = onSale;

    if (tableBodyCode === "") {
      tableBodyCode = `<tr><td colspan='9' class='text-center py-5 text-muted'>
        <i class="fa-solid fa-folder-open fs-2 mb-2 d-block text-muted"></i>
        You have no properties registered yet. Click <strong>Add New Property</strong> to begin.
      </td></tr>`;
    }

    tableBody.innerHTML = tableBodyCode;
  } catch (error) {
    console.error("fetchPropertiesOfOwner error:", error);
  }
}

function handleStateOfProperty(property) {
  const properyState = property["state"];
  const isEncumbered = property["isEncumbered"];

  let badge = "";
  if (isEncumbered) {
    badge = `<br><span class='badge-status badge-encumbered mt-1'><i class="fa-solid fa-lock me-1"></i> Lien: ${property["encumbranceDetails"] || "Active"}</span>`;
  }

  if (properyState == 0) {
    return "<span class='badge-status badge-pending'><i class='fa-solid fa-clock me-1'></i> Under Verification</span>" + badge;
  } else if (properyState == 1) {
    return `<span class='badge-status badge-pending'>Scheduled ${property["scheduledDate"]}</span>` + badge;
  } else if (properyState == 2) {
    return "<span class='badge-status badge-verified'><i class='fa-solid fa-shield-check me-1'></i> Verified</span>" + badge;
  } else if (properyState == 3) {
    return `<span class='badge-status badge-disputed'><i class='fa-solid fa-ban me-1'></i> Rejected: ${property["rejectedReason"]}</span>` + badge;
  } else if (properyState == 4) {
    return "<span class='badge-status badge-onsale'><i class='fa-solid fa-tag me-1'></i> On Sale</span>" + badge;
  } else if (properyState == 5) {
    return "<span class='badge-status badge-bought'><i class='fa-solid fa-check me-1'></i> Bought</span>" + badge;
  } else if (properyState == 6) {
    return `<span class='badge-status badge-disputed'><i class='fa-solid fa-triangle-exclamation me-1'></i> DISPUTED: ${property["rejectedReason"]}</span>` + badge;
  } else {
    return "<span class='badge-status badge-pending'>Unknown</span>";
  }
}

function showSoldButton(property) {
  const properyState = property["state"];
  const propertyId = property["propertyId"];
  const isEncumbered = property["isEncumbered"];

  if (properyState == 6 || isEncumbered) {
    return "<span class='text-muted small'><i class='fa-solid fa-lock text-danger me-1'></i> Frozen</span>";
  }

  if (properyState == 2 || properyState == 5) {
    return `<button class='btn btn-sm btn-dapp-primary py-1 px-3' onclick='makePropertyAvailableToSell(${propertyId})'>
      <i class="fa-solid fa-tag me-1"></i> List on Sale
    </button>`;
  } else if (properyState == 4) {
    return "<span class='badge bg-info-subtle text-info border'><i class='fa-solid fa-store me-1'></i> Active Listing</span>";
  } else {
    return "<span class='text-muted small'>Awaiting Review</span>";
  }
}

async function makePropertyAvailableToSell(propertyId) {
  const notify = document.getElementById("notifyUser");
  if (notify) notify.style.display = "none";

  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  const price = await showPrompt();
  if (price && parseFloat(price) > 0) {
    const priceEthInt = Math.floor(parseFloat(price));
    if (priceEthInt <= 0) {
      alertUser("Please enter a valid price of at least 1 ETH (whole number).", "alert-warning", "block");
      return;
    }
    try {
      showTransactionLoading(`Listing Property #${propertyId} for ${priceEthInt} ETH...`);
      await contract.methods.addPropertyOnSale(propertyId, priceEthInt).send({ from: accountUsedToLogin });
      closeTransactionLoading();
      alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Successfully Listed Property #${propertyId} on the Marketplace for ${priceEthInt} ETH!`, "alert-success", "block");
      fetchPropertiesOfOwner();
    } catch (error) {
      console.error(error);
      const reason = showError(error);
      closeTransactionLoading();
      alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> ${reason}`, "alert-danger", "block");
    }
  } else if (price !== null) {
    alertUser("Please enter a valid price greater than 0 ETH", "alert-warning", "block");
  }
}

function showPdf(propertyId) {
  const frame = document.getElementById('pdf-frame');
  frame.src = `/propertiesDocs/pdf/${propertyId}`;
  const popup = document.querySelector('.pdf-popup');
  popup.style.display = 'block';
}

function closePopup() {
  const popup = document.querySelector('.pdf-popup');
  popup.style.display = 'none';
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
  input.value = "";
  input.focus();

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

// ==========================================
// PHASE 7: GEO-LOCATION MAP PICKER WIDGET
// ==========================================

let regMap = null;
let regMarker = null;

function initRegistrationMap() {
  const mapDiv = document.getElementById('registrationMap');
  if (!mapDiv || typeof L === 'undefined') return;

  if (regMap) {
    setTimeout(() => { regMap.invalidateSize(); }, 200);
    return;
  }

  const defaultLat = 12.9698;
  const defaultLng = 77.7500;

  regMap = L.map('registrationMap').setView([defaultLat, defaultLng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(regMap);

  regMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(regMap);

  regMarker.on('dragend', function (e) {
    const pos = e.target.getLatLng();
    document.getElementById('propLatitude').value = pos.lat.toFixed(6);
    document.getElementById('propLongitude').value = pos.lng.toFixed(6);
  });

  regMap.on('click', function (e) {
    regMarker.setLatLng(e.latlng);
    document.getElementById('propLatitude').value = e.latlng.lat.toFixed(6);
    document.getElementById('propLongitude').value = e.latlng.lng.toFixed(6);
  });

  setTimeout(() => { regMap.invalidateSize(); }, 300);
}

async function lookupGeocodingPreview() {
  const locName = document.getElementById('locationName')?.value.trim();
  const revDept = document.getElementById('revenueDepartmentName')?.value.trim();
  const searchAddress = `${locName}, ${revDept}`.trim();

  if (!locName) {
    alert("Please enter a Location / Zone Name first.");
    return;
  }

  try {
    const res = await fetch('/api/geo/geocode_preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: searchAddress })
    });
    const data = await res.json();

    if (data.status === 'OK' && data.lat && data.lng) {
      document.getElementById('propLatitude').value = data.lat.toFixed(6);
      document.getElementById('propLongitude').value = data.lng.toFixed(6);
      if (regMap && regMarker) {
        regMap.setView([data.lat, data.lng], 14);
        regMarker.setLatLng([data.lat, data.lng]);
      }
      alertUser(`<i class="fa-solid fa-map-pin me-2"></i> Geocoded '${data.formatted_address}' (${data.source}). Please verify/drag the pin on the map and confirm.`, "alert-info", "block");
    }
  } catch (err) {
    console.error("Geocoding preview error:", err);
  }
}

// ==========================================
// PHASE 8: ON-CHAIN EVENT HISTORY MODAL
// ==========================================

async function openPropertyHistoryModal(propertyId) {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);

  try {
    const prop = await contract.methods.getPropertyDetails(propertyId).call();
    document.getElementById("historyPropertyBadge").innerText = `Property #${propertyId}`;
    document.getElementById("historyLocation").innerText = `${prop.locationName} (ID: ${prop.locationId})`;
    document.getElementById("historySurvey").innerText = `${prop.surveyNumberName} (Sy: ${prop.surveyNumber})`;
    document.getElementById("historyArea").innerText = `${prop.area} sq.ft`;
    document.getElementById("historyStateBadge").innerHTML = handleStateOfProperty(prop);

    const chainContainer = document.getElementById("historyEventChainContainer");
    if (chainContainer && typeof window.renderEventHistoryChain === 'function') {
      chainContainer.innerHTML = window.renderEventHistoryChain(
        prop.state,
        prop.isEncumbered,
        prop.state == 6,
        prop.scheduledDate
      );
    }

    const modal = new bootstrap.Modal(document.getElementById('propertyHistoryModal'));
    modal.show();
  } catch (err) {
    console.error("Error fetching property history:", err);
  }
}