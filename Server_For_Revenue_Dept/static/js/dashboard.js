let allLoadedProperties = [];

async function checkConnection() {
  if (window.ethereum) {
    try {
      window.web3 = new Web3(ethereum);
      const accounts = await web3.eth.getAccounts();
      const accountConnectedToMetaMask = accounts[0];

      if (!accountConnectedToMetaMask) {
        alert("Please connect your authorized officer wallet.");
        window.location.href = "/";
        return;
      }

      if (!window.localStorage["employeeId"] || accountConnectedToMetaMask.toLowerCase() !== window.localStorage["employeeId"].toLowerCase()) {
        window.localStorage.setItem("employeeId", accountConnectedToMetaMask);
      }

      const officerWalletEl = document.getElementById("officerWalletDisplay");
      if (officerWalletEl) {
        officerWalletEl.innerText = `${accountConnectedToMetaMask.slice(0, 6)}...${accountConnectedToMetaMask.slice(-4)}`;
      }

      const deptEl = document.getElementById("revenueDeptId");
      if (deptEl) deptEl.innerText = window.localStorage.revenueDepartmentId || "501";

      const nameEl = document.getElementById("nameOfUser");
      if (nameEl && window.localStorage.empName) nameEl.innerText = window.localStorage.empName;

      // Always ensure fresh contract details are loaded
      try {
        const response = await fetch('/fetchContractDetails');
        const data = await response.json();
        window.localStorage.setItem("LandRegistry_ContractABI", JSON.stringify(data.LandRegistry.abi));
        window.localStorage.setItem("LandRegistry_ContractAddress", data.LandRegistry.address);
      } catch (e) {
        console.error("Error fetching contract details:", e);
      }

      fetchPropertiesUnderControl();
    } catch (error) {
      console.error(error);
      alert(error);
    }
  } else {
    alert("Please Add MetaMask extension for your browser!");
  }
}

async function fetchPropertiesUnderControl() {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);

  try {
    let properties = [];
    if (contract.methods.getAllProperties) {
      try {
        properties = await contract.methods.getAllProperties().call();
      } catch (e) {
        console.warn("getAllProperties fallback:", e);
      }
    }

    if (!properties || properties.length === 0) {
      // Fallback: fetch by known departments and combine
      const deptIds = [500, 501, 10, 20, 100, 1, 2, 3];
      const fetched = [];
      const seenIds = new Set();
      for (const d of deptIds) {
        try {
          const props = await contract.methods.getPropertiesByRevenueDeptId(d).call();
          if (props && props.length > 0) {
            for (const p of props) {
              if (!seenIds.has(p.propertyId)) {
                seenIds.add(p.propertyId);
                fetched.push(p);
              }
            }
          }
        } catch (e) {}
      }
      properties = fetched;
    }

    allLoadedProperties = properties || [];
    renderPropertiesTable(allLoadedProperties);
  } catch (error) {
    console.error("Error fetching properties:", error);
    let tableBody = document.getElementById("propertiesTableBody");
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan='7' class='text-center text-danger py-4'>Error reading records: ${error.message || error}</td></tr>`;
    }
  }
}

function renderPropertiesTable(properties) {
  let tableBody = document.getElementById("propertiesTableBody");
  if (!tableBody) return;

  if (!properties || properties.length === 0) {
    tableBody.innerHTML = `<tr><td colspan='7' class='text-center py-5 text-muted'>
      <i class="fa-solid fa-folder-open fs-2 mb-2 d-block text-muted"></i>
      No land title submissions currently in the verification queue.
    </td></tr>`;
    return;
  }

  let tableBodyCode = "";
  for (let i = 0; i < properties.length; i++) {
    let prop = properties[i];
    let pId = prop["propertyId"];

    let tableRow = "<tr>";
    tableRow += `<td><span class="badge bg-light text-dark border fw-bold px-2 py-1">Prop #${pId}</span></td>`;
    tableRow += `<td><strong>${prop["locationName"]}</strong><br><small class="text-muted">ID: ${prop["locationId"]} | Dept #${prop["revenueDepartmentId"]}</small></td>`;
    tableRow += `<td><span class="badge bg-secondary-subtle text-secondary border">${prop["surveyNumberName"]}</span><br><small class="text-muted">Sy. No: ${prop["surveyNumber"]}</small></td>`;
    tableRow += `<td><span class="fw-semibold">${prop["area"]}</span> <small class="text-muted">sq.ft</small></td>`;
    tableRow += `<td>
      <div class="d-flex gap-1">
        <button class='btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1' onclick='showPdf(${pId})'>
          <i class="fa-solid fa-file-pdf text-danger"></i> Deed
        </button>
        <button class='btn btn-sm btn-outline-info d-inline-flex align-items-center gap-1' onclick='openOcrAuditModal(${pId})'>
          <i class="fa-solid fa-file-contract"></i> OCR Audit
        </button>
      </div>
    </td>`;
    tableRow += `<td>${handleStateOfProperty(prop)}</td>`;
    tableRow += `<td>${renderOfficerActions(prop)}</td>`;
    tableRow += "</tr>";
    tableBodyCode += tableRow;
  }

  tableBody.innerHTML = tableBodyCode;
}

function filterProperties() {
  const query = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  if (!query) {
    renderPropertiesTable(allLoadedProperties);
    return;
  }

  const filtered = allLoadedProperties.filter(prop => {
    return (
      String(prop.propertyId).includes(query) ||
      String(prop.locationName || "").toLowerCase().includes(query) ||
      String(prop.surveyNumberName || "").toLowerCase().includes(query) ||
      String(prop.revenueDepartmentName || "").toLowerCase().includes(query) ||
      String(prop.surveyNumber).includes(query) ||
      String(prop.revenueDepartmentId).includes(query)
    );
  });

  renderPropertiesTable(filtered);
}

function handleStateOfProperty(prop) {
  let s = parseInt(prop["state"]);
  let enc = prop["isEncumbered"];
  let badge = "";

  if (enc) {
    badge = `<br><span class="badge-status badge-encumbered mt-1"><i class="fa-solid fa-lock me-1"></i> Lien: ${prop["encumbranceDetails"] || "Active"}</span>`;
  }

  if (s === 0) return "<span class='badge-status badge-pending'><i class='fa-solid fa-clock me-1'></i> Pending Review</span>" + badge;
  if (s === 1) return `<span class='badge-status badge-pending'>Scheduled: ${prop["scheduledDate"]}</span>` + badge;
  if (s === 2) return "<span class='badge-status badge-verified'><i class='fa-solid fa-shield-check me-1'></i> Verified</span>" + badge;
  if (s === 3) return `<span class='badge-status badge-disputed'><i class='fa-solid fa-ban me-1'></i> Rejected: ${prop["rejectedReason"]}</span>` + badge;
  if (s === 4) return "<span class='badge-status badge-onsale'><i class='fa-solid fa-tag me-1'></i> On Sale</span>" + badge;
  if (s === 5) return "<span class='badge-status badge-bought'>Transferred</span>" + badge;
  if (s === 6) return `<span class='badge-status badge-disputed'><i class='fa-solid fa-triangle-exclamation me-1'></i> DISPUTED: ${prop["rejectedReason"]}</span>` + badge;
  return "<span class='badge-status badge-pending'>Pending</span>";
}

function renderOfficerActions(prop) {
  let s = parseInt(prop["state"]);
  let pId = prop["propertyId"];

  if (s === 0 || s === 1) {
    return `
      <div class="d-flex gap-1">
        <button class='btn btn-sm btn-dapp-success' onclick='acceptProperty(${pId})'>
          <i class="fa-solid fa-check me-1"></i> Verify Title
        </button>
        <button class='btn btn-sm btn-outline-danger' onclick='rejectProperty(${pId})'>
          <i class="fa-solid fa-xmark me-1"></i> Reject
        </button>
      </div>
    `;
  } else if (s === 6) {
    return `
      <button class='btn btn-sm btn-outline-warning' onclick='resolveDisputePrompt(${pId})'>
        <i class="fa-solid fa-scale-balanced me-1"></i> Resolve Dispute
      </button>
    `;
  } else if (s === 2 || s === 4 || s === 5) {
    return `
      <button class='btn btn-sm btn-outline-secondary' onclick='setEncumbrancePrompt(${pId}, ${!prop["isEncumbered"]})'>
        <i class="fa-solid fa-building-columns me-1"></i> ${prop["isEncumbered"] ? 'Release Lien' : 'Attach Lien'}
      </button>
    `;
  }
  return "<span class='text-muted small'>No Action Required</span>";
}

async function acceptProperty(propertyId) {
  // Pre-verification: Check OCR Cross-Verification Audit
  try {
    const ocrRes = await fetch(`/api/officer/ocr_audit/${propertyId}`);
    const ocrData = await ocrRes.json();

    if (ocrData && !ocrData.is_unblocked) {
      alert(`⚠️ Cannot verify title on-chain!\n\n${ocrData.unblock_reason || 'OCR cross-verification flags detected.'}\n\nPlease review the documents in 'OCR Audit' and record an official decision first.`);
      openOcrAuditModal(propertyId);
      return;
    }
  } catch (err) {
    console.warn("OCR pre-check error, proceeding:", err);
  }

  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["employeeId"];

  try {
    showTransactionLoading(`Anchoring official officer verification for Property #${propertyId}...`);
    await contract.methods.verifyProperty(propertyId).send({ from: accountUsedToLogin });
    closeTransactionLoading();

    // Trigger Phase 9 Real-Time SMS notification to owner
    try {
      await fetch('/api/officer/notify_verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propertyId, isApproved: true })
      });
    } catch (e) {}

    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Property #${propertyId} successfully verified on-chain!`, "alert-success", "block");
    fetchPropertiesUnderControl();
  } catch (error) {
    console.error("Error verifying property:", error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Verification failed: ${error.message || error}`, "alert-danger", "block");
  }
}

async function rejectProperty(propertyId) {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["employeeId"];

  const reason = prompt("Enter official reason for title rejection:") || "Document integrity mismatch";

  try {
    showTransactionLoading(`Recording rejection for Property #${propertyId}...`);
    await contract.methods.rejectProperty(propertyId, reason).send({ from: accountUsedToLogin });
    closeTransactionLoading();

    // Trigger Phase 9 SMS rejection notice
    try {
      await fetch('/api/officer/notify_verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propertyId, isApproved: false })
      });
    } catch (e) {}

    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Property #${propertyId} rejected.`, "alert-info", "block");
    fetchPropertiesUnderControl();
  } catch (error) {
    console.error("Error rejecting property:", error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Rejection failed: ${error.message || error}`, "alert-danger", "block");
  }
}

async function resolveDisputePrompt(propertyId) {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["employeeId"];

  const findings = prompt("Enter official resolution findings / court decree:") || "Title dispute dismissed by revenue commissioner";

  try {
    showTransactionLoading(`Resolving dispute for Property #${propertyId}...`);
    await contract.methods.resolveDispute(propertyId, 2, findings).send({ from: accountUsedToLogin });
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Dispute on Property #${propertyId} resolved and property restored!`, "alert-success", "block");
    fetchPropertiesUnderControl();
  } catch (error) {
    console.error("Error resolving dispute:", error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Dispute resolution failed: ${error.message || error}`, "alert-danger", "block");
  }
}

async function setEncumbrancePrompt(propertyId, setLien) {
  let contractABI = JSON.parse(window.localStorage.LandRegistry_ContractABI);
  let contractAddress = window.localStorage.LandRegistry_ContractAddress;
  let contract = new window.web3.eth.Contract(contractABI, contractAddress);
  let accountUsedToLogin = window.localStorage["employeeId"];

  let details = "";
  if (setLien) {
    details = prompt("Enter Encumbrance / Mortgage Bank Details:", "State Bank Mortgage Lien #8821") || "Bank Mortgage";
  }

  try {
    showTransactionLoading(`${setLien ? 'Attaching' : 'Releasing'} encumbrance on Property #${propertyId}...`);
    await contract.methods.setEncumbrance(propertyId, setLien, details).send({ from: accountUsedToLogin });
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-circle-check me-2"></i> Encumbrance on Property #${propertyId} successfully ${setLien ? 'attached' : 'released'}!`, "alert-success", "block");
    fetchPropertiesUnderControl();
  } catch (error) {
    console.error("Error updating encumbrance:", error);
    closeTransactionLoading();
    alertUser(`<i class="fa-solid fa-triangle-exclamation me-2"></i> Encumbrance update failed: ${error.message || error}`, "alert-danger", "block");
  }
}

// ==========================================
// PHASE 6: OCR AUDIT MODAL & DECISION LOGIC
// ==========================================

async function openOcrAuditModal(propertyId) {
  document.getElementById("ocrModalPropertyId").value = propertyId;
  const statusBadge = document.getElementById("ocrStatusBadge");
  const summaryBox = document.getElementById("ocrAuditSummaryBox");
  const matrixBody = document.getElementById("ocrComparisonTableBody");
  const flagsContainer = document.getElementById("ocrFlagsContainer");

  statusBadge.className = "badge bg-secondary ms-2";
  statusBadge.innerText = "Loading...";
  summaryBox.className = "alert alert-info py-2 px-3 small mb-3";
  summaryBox.innerText = "Fetching multi-document extraction and consistency audit...";

  const modal = new bootstrap.Modal(document.getElementById('ocrAuditModal'));
  modal.show();

  try {
    const res = await fetch(`/api/officer/ocr_audit/${propertyId}`);
    const data = await res.json();
    const auditDoc = data.audit || {};
    const auditData = auditDoc.audit_data || {};
    const comparisons = auditData.field_comparisons || {};
    const flags = auditData.flags || [];
    const status = auditDoc.overall_status || "VERIFIED_CONSISTENT";

    if (status === "VERIFIED_CONSISTENT") {
      statusBadge.className = "badge bg-success ms-2";
      statusBadge.innerText = "Verified Consistent";
      summaryBox.className = "alert alert-success py-2 px-3 small mb-3";
      summaryBox.innerHTML = `<i class="fa-solid fa-circle-check me-1"></i> All extracted document fields are consistent with on-chain title records.`;
    } else if (status === "RISK_ALERT") {
      statusBadge.className = "badge bg-danger ms-2";
      statusBadge.innerText = "Risk Alert";
      summaryBox.className = "alert alert-danger py-2 px-3 small mb-3";
      summaryBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-1"></i> <strong>Risk Alert:</strong> High-confidence field mismatch detected across documents.`;
    } else {
      statusBadge.className = "badge bg-warning text-dark ms-2";
      statusBadge.innerText = "Manual Review";
      summaryBox.className = "alert alert-warning py-2 px-3 small mb-3";
      summaryBox.innerHTML = `<i class="fa-solid fa-circle-exclamation me-1"></i> <strong>Manual Review:</strong> Low-confidence OCR extraction detected. Review document scans.`;
    }

    // Build Consistency Matrix Rows
    let matrixHtml = "";
    const fields = [
      { key: "survey_number", label: "Survey Number" },
      { key: "owner_name", label: "Owner Name" },
      { key: "plot_area", label: "Plot Area (sq.ft)" }
    ];

    fields.forEach(f => {
      const comp = comparisons[f.key] || {};
      const reg = comp.property_record ? comp.property_record.value : "-";
      const sale = comp.sale_deed ? `${comp.sale_deed.value} (${comp.sale_deed.confidence}%)` : "-";
      const patta = comp.patta ? `${comp.patta.value} (${comp.patta.confidence}%)` : "-";
      const ec = comp.encumbrance_certificate ? `${comp.encumbrance_certificate.value}` : "-";

      const hasFlag = flags.some(fl => fl.field === f.key);
      const flagBadge = hasFlag ? `<span class="badge bg-danger-subtle text-danger border">Mismatch</span>` : `<span class="badge bg-success-subtle text-success border">Match</span>`;

      matrixHtml += `<tr>
        <td class="fw-bold">${f.label}</td>
        <td><code>${reg}</code></td>
        <td>${sale}</td>
        <td>${patta}</td>
        <td>${ec}</td>
        <td>${flagBadge}</td>
      </tr>`;
    });

    matrixBody.innerHTML = matrixHtml;

    // Render Active Flags
    if (flags.length === 0) {
      flagsContainer.innerHTML = `<div class="text-success small"><i class="fa-solid fa-check me-1"></i> No discrepancies detected across Sale Deed, Patta, and EC records.</div>`;
    } else {
      let flagsHtml = `<div class="list-group list-group-flush border rounded">`;
      flags.forEach(fl => {
        const isRisk = fl.flag_type === "Risk Alert";
        flagsHtml += `<div class="list-group-item list-group-item-${isRisk ? 'danger' : 'warning'} py-2">
          <div class="d-flex justify-content-between">
            <span class="fw-bold">${fl.flag_type}: ${fl.field}</span>
            <small class="text-muted">Confidence: ${fl.confidence}%</small>
          </div>
          <p class="mb-0 small">${fl.message}</p>
        </div>`;
      });
      flagsHtml += `</div>`;
      flagsContainer.innerHTML = flagsHtml;
    }

    if (auditDoc.latest_decision) {
      const dec = auditDoc.latest_decision;
      document.getElementById("officerReasonInput").value = `Previous Decision (${dec.decision_type}): ${dec.reason}`;
    }

  } catch (err) {
    console.error("Error loading OCR audit:", err);
    summaryBox.className = "alert alert-danger py-2 px-3 small mb-3";
    summaryBox.innerText = `Error loading OCR audit: ${err.message || err}`;
  }
}

async function submitOfficerOcrDecision() {
  const propertyId = document.getElementById("ocrModalPropertyId").value;
  const decisionType = document.querySelector('input[name="officerDecisionType"]:checked')?.value || "RESOLVE_ACCEPTABLE";
  const reason = document.getElementById("officerReasonInput").value.trim();
  const officerWallet = window.localStorage["employeeId"] || "";

  if (!reason) {
    alert("Please enter a mandatory explanation/reason before recording your decision.");
    return;
  }

  try {
    const res = await fetch('/api/officer/record_ocr_decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: propertyId,
        decisionType: decisionType,
        reason: reason,
        officerWallet: officerWallet
      })
    });

    const data = await res.json();
    if (data.status === 1) {
      alert(`Decision successfully recorded for Property #${propertyId}!`);
      const modalEl = document.getElementById('ocrAuditModal');
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
      fetchPropertiesUnderControl();
    } else {
      alert(`Error recording decision: ${data.msg}`);
    }
  } catch (err) {
    console.error("Error submitting decision:", err);
    alert(`Failed to record decision: ${err.message || err}`);
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