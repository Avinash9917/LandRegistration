let allMarketplaceSales = [];

async function checkConnection() {
  if (window.ethereum) {
    try {
      window.web3 = new Web3(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
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
      await fetchPropertiesAvailabletoBuy();
    } catch (error) {
      console.error(error);
      alert(error);
    }
  } else {
    alert("Please Add MetaMask extension for your browser!");
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

async function fetchPropertiesAvailabletoBuy(e) {
  if (e) e.preventDefault();

  let transferABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let transferAddress = window.localStorage.TransferOwnership_ContractAddress;
  let transferContract = new window.web3.eth.Contract(transferABI, transferAddress);

  let registryABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let registryAddress = window.localStorage.LandRegistry_ContractAddress;
  let registryContract = new window.web3.eth.Contract(registryABI, registryAddress);

  const tableBody = document.getElementById("salesTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan='8' class='text-center py-4 text-muted'>
    <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
    Fetching all active marketplace listings on Ethereum...
  </td></tr>`;

  try {
    let sales = [];
    if (transferContract.methods.getAllActiveSales) {
      try {
        sales = await transferContract.methods.getAllActiveSales().call();
      } catch (err) {
        console.warn("getAllActiveSales error, falling back:", err);
      }
    }

    if (!sales || sales.length === 0) {
      // Fallback: fetch all sales by ID count
      try {
        const count = await transferContract.methods.getSalesCount().call();
        const fetchedSales = [];
        for (let i = 0; i < count; i++) {
          const s = await transferContract.methods.getSale(i).call();
          if (parseInt(s.state) === 0 || parseInt(s.state) === 1) {
            fetchedSales.push(s);
          }
        }
        sales = fetchedSales;
      } catch (err) {}
    }

    let enrichedSales = [];
    for (let i = 0; i < sales.length; i++) {
      let sale = sales[i];
      let pId = sale.propertyId;
      try {
        let propDetails = await registryContract.methods.getPropertyDetails(pId).call();
        enrichedSales.push({
          sale: sale,
          property: propDetails
        });
      } catch (pErr) {
        console.error("Error reading prop details:", pErr);
      }
    }

    allMarketplaceSales = enrichedSales;
    renderMarketplaceTable(allMarketplaceSales);
  } catch (error) {
    console.error("Error fetching available sales:", error);
    tableBody.innerHTML = `<tr><td colspan='8' class='text-center text-danger py-4'>Error loading listings: ${error.message || error}</td></tr>`;
  }
}

function renderMarketplaceTable(items) {
  const tableBody = document.getElementById("salesTableBody");
  if (!tableBody) return;

  const currentAccount = (window.localStorage["userAddress"] || "").toLowerCase();

  if (!items || items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan='8' class='text-center py-5 text-muted'>
      <i class="fa-solid fa-store-slash fs-2 mb-2 d-block text-muted"></i>
      No properties are currently listed for sale in the marketplace.
    </td></tr>`;
    return;
  }

  let tableCode = "";
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    let sale = item.sale;
    let prop = item.property;
    let saleId = sale.saleId;
    let pId = prop.propertyId;
    let isSeller = (sale.owner.toLowerCase() === currentAccount);

    let priceInEth = window.web3.utils.fromWei(sale.price, 'ether');

    let row = "<tr>";
    row += `<td><span class="badge bg-light text-dark border fw-bold px-2 py-1">Sale #${saleId}</span></td>`;
    row += `<td><strong>${prop.locationName}</strong><br><small class="text-muted">ID: ${prop.locationId} | Dept #${prop.revenueDepartmentId}</small></td>`;
    row += `<td><span class="badge bg-secondary-subtle text-secondary border">${prop.surveyNumberName}</span><br><small class="text-muted">Sy. No: ${prop.surveyNumber}</small></td>`;
    row += `<td><span class="fw-semibold">${prop.area}</span> <small class="text-muted">sq.ft</small></td>`;
    row += `<td><span class="fw-bold text-success fs-6">${priceInEth} ETH</span></td>`;
    row += `<td><code class="text-dark small">${sale.owner.slice(0, 6)}...${sale.owner.slice(-4)}</code>${isSeller ? '<br><span class="badge bg-info-subtle text-info border mt-1">Your Listing</span>' : ''}</td>`;
    row += `<td>
      <button class='btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1' onclick='showPdf(${pId})'>
        <i class="fa-solid fa-file-pdf text-danger"></i> View Deed
      </button>
    </td>`;

    if (isSeller) {
      row += `<td><span class="text-muted small"><i class="fa-solid fa-user-check me-1"></i> You own this</span></td>`;
    } else {
      row += `<td>
        <button class='btn btn-sm btn-primary d-inline-flex align-items-center gap-1' onclick='openPurchaseOfferModal(${saleId}, "${priceInEth}", "${prop.locationName}")'>
          <i class="fa-solid fa-hand-holding-dollar"></i> Make Offer
        </button>
      </td>`;
    }

    row += "</tr>";
    tableCode += row;
  }

  tableBody.innerHTML = tableCode;
}

function filterMarketplace() {
  const query = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  if (!query) {
    renderMarketplaceTable(allMarketplaceSales);
    return;
  }

  const filtered = allMarketplaceSales.filter(item => {
    const prop = item.property;
    const sale = item.sale;
    return (
      String(sale.saleId).includes(query) ||
      String(prop.propertyId).includes(query) ||
      String(prop.locationName || "").toLowerCase().includes(query) ||
      String(prop.surveyNumberName || "").toLowerCase().includes(query) ||
      String(prop.revenueDepartmentName || "").toLowerCase().includes(query) ||
      String(prop.locationId).includes(query) ||
      String(prop.surveyNumber).includes(query) ||
      String(sale.owner || "").toLowerCase().includes(query)
    );
  });

  renderMarketplaceTable(filtered);
}

function openPurchaseOfferModal(saleId, askingPrice, locationName) {
  document.getElementById("modalSaleId").value = saleId;
  document.getElementById("modalLocationName").innerText = locationName;
  document.getElementById("modalAskingPrice").innerText = `${askingPrice} ETH`;
  document.getElementById("offerPriceInput").value = askingPrice;
  
  const modal = new bootstrap.Modal(document.getElementById('purchaseOfferModal'));
  modal.show();
}

async function submitPurchaseOffer() {
  const saleId = document.getElementById("modalSaleId").value;
  const offerPrice = document.getElementById("offerPriceInput").value;

  if (!offerPrice || parseFloat(offerPrice) <= 0) {
    alert("Please enter a valid offer price in ETH.");
    return;
  }

  const offerPriceEthInt = Math.floor(parseFloat(offerPrice));
  if (offerPriceEthInt <= 0) {
    alert("Please enter an offer price of at least 1 ETH (whole number).");
    return;
  }

  let contractABI = JSON.parse(window.localStorage.TransferOwnership_ContractABI);
  let contractAddress = window.localStorage.TransferOwnership_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["userAddress"];

  const modalEl = document.getElementById('purchaseOfferModal');
  const modalInstance = bootstrap.Modal.getInstance(modalEl);
  if (modalInstance) modalInstance.hide();

  try {
    showTransactionLoading(`Submitting purchase offer of ${offerPriceEthInt} ETH for Sale #${saleId}...`);
    await contract.methods.sendPurchaseRequest(saleId, offerPriceEthInt).send({ from: accountUsedToLogin });
    closeTransactionLoading();

    // Trigger Phase 9 Real-Time SMS notification to seller
    try {
      const saleItem = (allMarketplaceSales || []).find(s => s.sale && s.sale.saleId == saleId);
      if (saleItem) {
        await fetch('/api/notifications/notify_offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellerWallet: saleItem.sale.owner,
            propertyId: saleItem.property.propertyId,
            buyerWallet: accountUsedToLogin,
            priceEth: offerPrice
          })
        });
      }
    } catch (e) {}

    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Purchase offer for Sale #${saleId} submitted successfully! Check status in 'Offers & Escrow'.`, "alert-success", "block");
    await fetchPropertiesAvailabletoBuy();
  } catch (error) {
    console.error("Error sending purchase request:", error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Offer submission failed: ${error.message || error}`, "alert-danger", "block");
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

function alertUser(msg, msgType, display) {
  const notifyUser = document.getElementById("notifyUser");
  if (notifyUser) {
    notifyUser.className = `alert ${msgType}`;
    notifyUser.innerHTML = msg;
    notifyUser.style.display = display;
  }
}

// ==========================================
// PHASE 7: MARKETPLACE MAP VIEW
// ==========================================

let marketplaceMap = null;
let marketplaceMarkersGroup = null;

function switchMarketplaceView(mode) {
  const listView = document.getElementById("salesTable");
  const mapView = document.getElementById("marketplaceMapView");
  const btnList = document.getElementById("btnListView");
  const btnMap = document.getElementById("btnMapView");

  if (mode === 'map') {
    listView.style.display = "none";
    mapView.style.display = "block";
    btnList.classList.remove("active");
    btnMap.classList.add("active");
    initMarketplaceMap();
  } else {
    listView.style.display = "block";
    mapView.style.display = "none";
    btnList.classList.add("active");
    btnMap.classList.remove("active");
  }
}

async function initMarketplaceMap() {
  if (typeof L === 'undefined') return;

  if (!marketplaceMap) {
    marketplaceMap = L.map('marketplaceMap').setView([12.9716, 77.5946], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(marketplaceMap);

    marketplaceMarkersGroup = L.layerGroup().addTo(marketplaceMap);
  }

  setTimeout(() => { marketplaceMap.invalidateSize(); }, 200);

  // Fetch geographic marker data for active OnSale properties
  try {
    const res = await fetch('/api/geo/marketplace_locations');
    const data = await res.json();
    const markers = data.markers || [];

    marketplaceMarkersGroup.clearLayers();

    if (markers.length === 0) return;

    const bounds = [];
    const currentAccount = (window.localStorage["userAddress"] || "").toLowerCase();

    markers.forEach(m => {
      const lat = m.latitude;
      const lng = m.longitude;
      bounds.push([lat, lng]);

      const priceEth = m.priceEth || (m.price ? window.web3.utils.fromWei(m.price, 'ether') : "1.0");
      const isSeller = (m.owner && m.owner.toLowerCase() === currentAccount);

      const marker = L.marker([lat, lng]).addTo(marketplaceMarkersGroup);

      const popupContent = `
        <div style="min-width: 220px; font-family: var(--font-sans);">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="badge bg-light text-dark border fw-bold">Sale #${m.saleId}</span>
            <span class="badge bg-success fw-bold">${priceEth} ETH</span>
          </div>
          <h6 class="fw-bold mb-1 text-dark">${m.locationName}</h6>
          <p class="text-muted small mb-2">${m.surveyNumberName} &bull; ${m.area} sq.ft</p>
          <div class="d-flex gap-1 mt-2">
            <button class="btn btn-sm btn-outline-primary py-1 px-2 small" onclick="showPdf(${m.propertyId})">
              <i class="fa-solid fa-file-pdf text-danger"></i> Deed
            </button>
            ${!isSeller ? `
              <button class="btn btn-sm btn-primary py-1 px-2 small" onclick="openPurchaseOfferModal(${m.saleId}, '${priceEth}', '${m.locationName}')">
                <i class="fa-solid fa-hand-holding-dollar"></i> Make Offer
              </button>
            ` : '<span class="badge bg-info-subtle text-info border align-self-center">Your Listing</span>'}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
    });

    if (bounds.length > 0) {
      marketplaceMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  } catch (err) {
    console.error("Error loading marketplace map markers:", err);
  }
}