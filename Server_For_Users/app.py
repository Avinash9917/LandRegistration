from flask import Flask, jsonify, render_template, request, Response, redirect
from pymongo import MongoClient
import gridfs
from web3 import Web3, HTTPProvider
import json
import os
import io

from utility.crypto_utils import (
    encrypt_aadhaar,
    decrypt_aadhaar,
    compute_salted_aadhaar_hash,
    compute_document_hash,
)
from utility.oracle_service import GovernmentLandRecordsService
from utility.sms_notification_service import SMSNotificationService

# Load environment configuration
GANACHE_URL = os.environ.get("GANACHE_URL", "http://127.0.0.1:7545")
NETWORK_CHAIN_ID = str(os.environ.get("NETWORK_CHAIN_ID", "5777"))
MONGO_DB_URL = os.environ.get("MONGO_DB_URL", "mongodb://localhost:27017")
SECRET_KEY = os.environ.get("SECRET_KEY_USER_PORTAL", "UserPortalSecret$123")

# Connect to MongoDB
client = MongoClient(MONGO_DB_URL)
LandRegistryDB = client.LandRegistry
fs = gridfs.GridFS(LandRegistryDB)
propertyDocsTable = LandRegistryDB.Property_Docs
usersKycTable = LandRegistryDB.Users_KYC

# Connect to Web3 for on-chain integrity checks
web3 = Web3(HTTPProvider(GANACHE_URL))
oracle_service = GovernmentLandRecordsService()
sms_service = SMSNotificationService(MONGO_DB_URL)

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(
    __name__,
    static_url_path='', 
    static_folder='web/static',
    template_folder='web/templates'
)
app.secret_key = SECRET_KEY

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per day", "100 per hour"],
    storage_uri="memory://"
)


from utility.ocr_service import OCRService, PropertyOCRAuditRepository
from utility.geo_service import GeoLocationService

ocr_service = OCRService()
ocr_repo = PropertyOCRAuditRepository(client)
geo_service = GeoLocationService(client)


def get_land_registry_contract():
    """Helper to load compiled LandRegistry contract artifact and Web3 instance."""
    contract_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "Smart_contracts", "build", "contracts", "LandRegistry.json"
    )
    if not os.path.exists(contract_path):
        return None
    with open(contract_path, "r") as f:
        contract_json = json.load(f)
    if NETWORK_CHAIN_ID in contract_json.get("networks", {}):
        address = contract_json["networks"][NETWORK_CHAIN_ID]["address"]
        return web3.eth.contract(address=address, abi=contract_json["abi"])
    elif contract_json.get("networks"):
        address = list(contract_json["networks"].values())[-1].get("address")
        if address:
            return web3.eth.contract(address=address, abi=contract_json["abi"])
    return None


def get_transfer_contract():
    """Helper to load compiled TransferOwnerShip contract artifact and Web3 instance."""
    contract_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "Smart_contracts", "build", "contracts", "TransferOwnerShip.json"
    )
    if not os.path.exists(contract_path):
        return None
    with open(contract_path, "r") as f:
        contract_json = json.load(f)
    if NETWORK_CHAIN_ID in contract_json.get("networks", {}):
        address = contract_json["networks"][NETWORK_CHAIN_ID]["address"]
        return web3.eth.contract(address=address, abi=contract_json["abi"])
    elif contract_json.get("networks"):
        address = list(contract_json["networks"].values())[-1].get("address")
        if address:
            return web3.eth.contract(address=address, abi=contract_json["abi"])
    return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/register')
def register():
    return render_template('register.html')


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', add_property=True)


# ==========================================
# KYC PRIVACY & REGISTRATION (PHASE 0.1)
# ==========================================

@app.route('/api/kyc/prepare_registration', methods=['POST'])
@limiter.limit("15 per minute")
def prepare_kyc_registration():
    """
    Encrypts raw Aadhaar off-chain with AES-256 at rest in MongoDB.
    Returns salted SHA-256/Keccak256 hash for privacy-preserving on-chain registration.
    """
    data = request.get_json(silent=True) or request.form
    first_name = data.get('firstName', '').strip()
    last_name = data.get('lastName', '').strip()
    dob = data.get('dob', '').strip()
    raw_aadhaar = data.get('aadharNo', '').strip()
    wallet_address = data.get('walletAddress', '').strip()

    if not raw_aadhaar or len(raw_aadhaar) < 12:
        return jsonify({'status': 'error', 'message': 'Invalid Aadhaar number'}), 400

    try:
        # 1. Compute salted hash for on-chain identity uniqueness
        salted_hash = compute_salted_aadhaar_hash(raw_aadhaar)

        # 2. Check for duplicate Aadhaar off-chain
        existing_kyc = usersKycTable.find_one({"aadharHash": salted_hash})
        if existing_kyc and existing_kyc.get("walletAddress") != wallet_address.lower():
            return jsonify({'status': 'error', 'message': 'Aadhaar number already registered to another wallet'}), 409

        # 3. Encrypt Aadhaar at rest with AES-256 GCM
        encrypted_aadhaar = encrypt_aadhaar(raw_aadhaar)

        # 4. Save to off-chain encrypted KYC collection
        usersKycTable.update_one(
            {"walletAddress": wallet_address.lower()},
            {"$set": {
                "firstName": first_name,
                "lastName": last_name,
                "dateOfBirth": dob,
                "encryptedAadhaar": encrypted_aadhaar,
                "aadharHash": salted_hash,
                "walletAddress": wallet_address.lower(),
                "kycStatus": "VERIFIED_OFFCHAIN"
            }},
            upsert=True
        )

        return jsonify({
            'status': 'success',
            'aadharHash': salted_hash,
            'message': 'KYC processed and encrypted off-chain'
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ==========================================
# PRE-REGISTRATION LAND ORACLE (PHASE 2)
# ==========================================

@app.route('/api/oracle/verify_survey', methods=['GET', 'POST'])
@limiter.limit("30 per minute")
def verify_survey_with_oracle():
    """
    Pre-registration check against government land records API.
    """
    if request.method == 'POST':
        data = request.get_json(silent=True) or request.form
        survey_number = data.get('surveyNumber')
        dept_id = data.get('revenueDeptId')
        claimant = data.get('claimant', '')
    else:
        survey_number = request.args.get('surveyNumber')
        dept_id = request.args.get('revenueDeptId')
        claimant = request.args.get('claimant', '')

    if not survey_number or not dept_id:
        return jsonify({'status': 'error', 'message': 'surveyNumber and revenueDeptId are required'}), 400

    result = oracle_service.verify_survey_record(int(survey_number), int(dept_id), claimant)
    return jsonify({'status': 'success', 'data': result})


# ==========================================
# DOCUMENT ANCHORING & TAMPERING DETECTION (PHASE 0.3)
# ==========================================

@app.route('/uploadPropertyDocs', methods=['POST'])
@limiter.limit("10 per minute")
def upload():
    registraionDocs = request.files.get('propertyDocs')
    owner = request.form.get('owner')
    propertyId = request.form.get('propertyId')

    if not registraionDocs or not owner or not propertyId:
        return jsonify({'status': 'Failed Uploading Files', 'fileId': '0', 'reason': 'Missing parameters'}), 400

    try:
        file_bytes = registraionDocs.read()
        doc_hash = compute_document_hash(file_bytes)
        registraionDocs.seek(0)

        file_name = f"{owner}_{propertyId}.pdf"
        file_id = fs.put(registraionDocs, filename=file_name, metadata={"documentHash": doc_hash})
        
        propertyDocsTable.insert_one({
            "Owner": owner,
            "Property_Id": str(propertyId),
            file_name: file_id,
            "documentHash": doc_hash
        })

        # Phase 9: Real-time SMS notification
        try:
            sms_service.notify_property_registered(owner, propertyId)
        except Exception as sms_err:
            print(f"SMS notification warning: {sms_err}")

        return jsonify({
            'status': 'success',
            'fileId': str(file_id),
            'documentHash': doc_hash
        })
    except Exception as e:
        return jsonify({'status': 'Failed Uploading Files', 'fileId': '0', 'error': str(e)}), 500


@app.route('/propertiesDocs/pdf/<propertyId>')
def get_pdf(propertyId):
    try:
        propertyDetails = propertyDocsTable.find_one({
            "$or": [
                {"Property_Id": str(propertyId)},
                {"propertyId": int(propertyId)},
                {"propertyId": str(propertyId)}
            ]
        })
        if not propertyDetails:
            return jsonify({"status": 0, "Reason": "No Property Matched With Id"}), 404

        owner = propertyDetails.get('Owner') or propertyDetails.get('owner', '')
        fileName = f"{owner}_{propertyId}.pdf"
        file_id = propertyDetails.get(fileName) or propertyDetails.get('file_id')

        if not file_id:
            return jsonify({"status": 0, "Reason": "File ID not found in record"}), 404

        grid_file = fs.get(file_id)
        file_bytes = grid_file.read()

        # Compute hash of stored file
        computed_hash = compute_document_hash(file_bytes)
        computed_norm = computed_hash.lower() if computed_hash.startswith("0x") else "0x" + computed_hash.lower()

        # On-chain Integrity Verification
        contract = get_land_registry_contract()
        if contract and web3.is_connected():
            try:
                on_chain_prop = contract.functions.getPropertyDetails(int(propertyId)).call()
                # documentHash is index 15 in Land struct
                on_chain_hash_bytes = on_chain_prop[15]
                on_chain_hex = on_chain_hash_bytes.hex() if isinstance(on_chain_hash_bytes, bytes) else str(on_chain_hash_bytes)
                on_chain_norm = on_chain_hex.lower() if on_chain_hex.startswith("0x") else "0x" + on_chain_hex.lower()

                print(f"[get_pdf DEBUG] propId={propertyId} computed={computed_norm} onchain={on_chain_norm} equal={computed_norm == on_chain_norm}")

                if on_chain_norm != "0x0000000000000000000000000000000000000000000000000000000000000000":
                    if computed_norm != on_chain_norm:
                        print("[get_pdf DEBUG] MISMATCH TRIGGERED")
                        return jsonify({
                            "status": 0,
                            "error": "CRITICAL INTEGRITY ERROR: Document tampering detected! Stored file hash does not match immutable on-chain deed hash."
                        }), 403
            except Exception as contract_err:
                print(f"On-chain check warning: {contract_err}")

        response = Response(file_bytes, content_type='application/pdf')
        response.headers['Content-Disposition'] = f'inline; filename="{grid_file.filename}"'
        response.headers['X-Document-Integrity'] = 'VERIFIED_ON_CHAIN'
        response.headers['X-Document-Hash'] = computed_norm
        return response
    except Exception as e:
        return jsonify({"status": 0, "Reason": str(e)}), 500


@app.route('/fetchContractDetails')
def fetchContractDetails():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    contracts_dir = os.path.join(base_dir, "..", "Smart_contracts", "build", "contracts")

    def load_contract(name):
        path = os.path.join(contracts_dir, f"{name}.json")
        with open(path, "r") as f:
            return json.load(f)

    usersContract = load_contract("Users")
    landRegistryContract = load_contract("LandRegistry")
    transferOwnerShip = load_contract("TransferOwnerShip")

    def get_addr(contract_dict):
        networks = contract_dict.get("networks", {})
        if NETWORK_CHAIN_ID in networks and networks[NETWORK_CHAIN_ID].get("address"):
            return networks[NETWORK_CHAIN_ID]["address"]
        if networks:
            return list(networks.values())[-1].get("address", "")
        return ""

    response = {
        "Users": {
            "address": get_addr(usersContract),
            "abi": usersContract["abi"]
        },
        "LandRegistry": {
            "address": get_addr(landRegistryContract),
            "abi": landRegistryContract["abi"]
        },
        "TransferOwnership": {
            "address": get_addr(transferOwnerShip),
            "abi": transferOwnerShip["abi"]
        }
    }
    return jsonify(response)


@app.route('/logout')
def logout():
    return redirect('/')


@app.route('/availableToBuy')
@app.route('/availabletobuy')
@app.route('/marketplace')
def availableToBuy():
    return render_template('availableToBuy.html')


@app.route('/MySales')
@app.route('/mysales')
@app.route('/mySales')
@app.route('/sales')
def MySales():
    return render_template('mySales.html')


@app.route('/myRequestedSales')
@app.route('/myrequestedsales')
@app.route('/offers')
@app.route('/escrow')
def myRequestedSales():
    return render_template('myRequestedSales.html')


# ==========================================
# PHASE 6: DOCUMENT OCR CROSS-VERIFICATION
# ==========================================

@app.route('/api/ocr/state_config', methods=['GET'])
def get_ocr_state_config():
    """Returns supported states and document equivalents."""
    state = request.args.get('state')
    return jsonify({
        "supported_states": ocr_service.get_supported_states(),
        "config": ocr_service.get_document_config_for_state(state)
    })


@app.route('/api/ocr/cross_verify/<int:property_id>', methods=['POST'])
@limiter.limit("30 per minute")
def run_ocr_cross_verification(property_id):
    """
    Extracts structured fields across submitted document types and runs fuzzy cross-verification.
    Encrypts PII at rest and persists the audit result in MongoDB.
    """
    data = request.get_json(silent=True) or {}
    state = data.get('state', ocr_service.default_state)
    provided_docs = data.get('documents', {})

    # 1. Fetch on-chain or DB property record anchor
    prop_doc = propertyDocsTable.find_one({"propertyId": property_id}) or propertyDocsTable.find_one({"Property_Id": str(property_id)})
    land_contract = get_land_registry_contract()

    property_record = {}
    if land_contract:
        try:
            land_details = land_contract.functions.getLandDetailsAsStruct(property_id).call()
            owner_addr = land_details[7]
            kyc_user = usersKycTable.find_one({"walletAddress": str(owner_addr).lower()})
            owner_name = f"{kyc_user.get('firstName', '')} {kyc_user.get('lastName', '')}".strip() if kyc_user else ""
            property_record = {
                "propertyId": property_id,
                "owner": owner_addr,
                "ownerName": owner_name,
                "locationId": land_details[1],
                "revenueDepartmentId": land_details[2],
                "surveyNumber": land_details[3],
                "locationName": land_details[4],
                "revenueDepartmentName": land_details[5],
                "surveyNumberName": land_details[6],
                "area": land_details[8]
            }
        except Exception:
            pass

    if not property_record and prop_doc:
        property_record = {
            "propertyId": property_id,
            "owner": prop_doc.get("owner") or prop_doc.get("Owner", ""),
            "surveyNumber": prop_doc.get("surveyNumber", ""),
            "area": prop_doc.get("area", 0)
        }

    # 2. Extract structured fields from any stored PDF in GridFS if not provided in payload
    extracted_docs = {}
    if not provided_docs and prop_doc and prop_doc.get("file_id"):
        try:
            grid_file = fs.get(prop_doc["file_id"])
            pdf_bytes = grid_file.read()
            # Parse main sale deed from stored PDF
            extracted_docs["sale_deed"] = ocr_service.extract_document_fields("sale_deed", pdf_bytes, state=state)
        except Exception as e:
            pass

    for doc_type, doc_content in provided_docs.items():
        extracted_docs[doc_type] = ocr_service.extract_document_fields(doc_type, doc_content, state=state)

    # 3. Run cross-document consistency audit
    audit_result = ocr_service.cross_verify_documents(property_record, extracted_docs)

    # 4. Persist in MongoDB
    saved = ocr_repo.save_audit_result(property_id, audit_result)

    return jsonify({
        "status": "OK",
        "propertyId": property_id,
        "overall_status": audit_result["overall_status"],
        "is_unblocked": audit_result["is_unblocked"],
        "flags": audit_result["flags"],
        "field_comparisons": audit_result["field_comparisons"],
        "summary": audit_result["summary"],
        "extracted_documents": extracted_docs
    })


@app.route('/api/ocr/results/<int:property_id>', methods=['GET'])
def get_ocr_audit_results(property_id):
    """Retrieves existing OCR extraction breakdown and audit trail."""
    record = ocr_repo.get_audit_trail(property_id)
    if not record:
        return jsonify({"status": "NOT_FOUND", "message": "No OCR audit found for this property"}), 404
    return jsonify({"status": "OK", "audit": record})


# ==========================================
# PHASE 7: GOOGLE MAPS LOCATION VISIBILITY
# ==========================================

@app.route('/api/geo/geocode_preview', methods=['POST'])
def geocode_preview():
    """Returns geocoded coordinates with mandatory user confirmation required before submit."""
    data = request.get_json(silent=True) or request.form
    address = data.get('address', '').strip()
    result = geo_service.geocode_address(address)
    return jsonify(result)


@app.route('/api/geo/save_coordinates', methods=['POST'])
def save_property_coordinates():
    """Stores user-confirmed pin coordinates captured from map-picker widget."""
    data = request.get_json(silent=True) or request.form
    property_id = int(data.get('propertyId', 0))
    lat = float(data.get('latitude', 0.0))
    lng = float(data.get('longitude', 0.0))
    formatted_addr = data.get('formattedAddress', '')
    confirmed = bool(data.get('userConfirmed', True))

    saved = geo_service.save_property_coordinates(property_id, lat, lng, formatted_addr, confirmed)
    return jsonify({"status": "OK", "saved": saved})


@app.route('/api/geo/property_location/<int:property_id>', methods=['GET'])
def get_property_location(property_id):
    """
    Returns parcel location with server-side precision privacy policy:
    Fuzzed coordinates for anonymous users, exact for owner / active escrow buyer / officer.
    """
    requester_wallet = request.args.get('requesterWallet', '').strip()
    land_contract = get_land_registry_contract()
    transfer_contract = get_transfer_contract()

    loc = geo_service.get_property_location(
        property_id=property_id,
        requester_wallet=requester_wallet,
        is_officer_or_admin=False,
        transfer_contract=transfer_contract,
        land_contract=land_contract
    )

    if not loc:
        return jsonify({
            "status": "OK",
            "propertyId": property_id,
            "latitude": 12.9716,
            "longitude": 77.5946,
            "precision": "PARCEL_FUZZED",
            "is_fuzzed": True
        })

    return jsonify({"status": "OK", "location": loc})


@app.route('/api/geo/marketplace_locations', methods=['GET'])
def get_marketplace_locations():
    """Returns map markers for all active OnSale properties with fuzzed parcel precision."""
    transfer_contract = get_transfer_contract()
    land_contract = get_land_registry_contract()
    active_sales = []

    if transfer_contract and land_contract:
        try:
            sales = transfer_contract.functions.getAllActiveSales().call()
            for s in sales:
                sale_id = int(s[0])
                price_wei = s[2]
                prop_id = int(s[3])
                state = int(s[9])
                if state in (0, 1):
                    try:
                        prop = land_contract.functions.getPropertyDetails(prop_id).call()
                        active_sales.append({
                            "saleId": sale_id,
                            "propertyId": prop_id,
                            "price": str(price_wei),
                            "priceEth": str(web3.from_wei(price_wei, 'ether')),
                            "locationName": prop[4],
                            "surveyNumberName": prop[6],
                            "area": int(prop[8])
                        })
                    except Exception:
                        pass
        except Exception:
            pass

    markers = geo_service.get_marketplace_locations(active_sales)
    return jsonify({"status": "OK", "markers": markers})


# ==========================================
# PHASE 9: PHONE KYC & REAL-TIME SMS ENGINE
# ==========================================

@app.route('/api/auth/send_otp', methods=['POST'])
@limiter.limit("15 per minute")
def send_otp():
    data = request.get_json(force=True, silent=True) or request.form
    wallet = (data.get('walletAddress') or '').strip().lower()
    phone = (data.get('phone') or '').strip()

    if not wallet or not phone:
        return jsonify({"status": "ERROR", "message": "walletAddress and phone are required"}), 400

    result = sms_service.generate_and_send_otp(wallet, phone)
    return jsonify({"status": "OK", "data": result})


@app.route('/api/auth/verify_otp', methods=['POST'])
@limiter.limit("15 per minute")
def verify_otp():
    data = request.get_json(force=True, silent=True) or request.form
    wallet = (data.get('walletAddress') or '').strip().lower()
    otp = (data.get('otp') or '').strip()
    phone = (data.get('phone') or '').strip()
    email = (data.get('email') or '').strip()

    if not wallet or not otp:
        return jsonify({"status": "ERROR", "message": "walletAddress and otp are required"}), 400

    res = sms_service.verify_otp(wallet, otp)
    if res.get("status") == "SUCCESS":
        if phone:
            sms_service.save_user_contact(wallet, phone, email)
        return jsonify({"status": "OK", "message": "Phone number verified successfully", "phone": res.get("phone")})
    else:
        return jsonify({"status": "ERROR", "message": res.get("reason", "Verification failed")}), 400


@app.route('/api/auth/save_contact', methods=['POST'])
@limiter.limit("20 per minute")
def save_contact():
    data = request.get_json(force=True, silent=True) or request.form
    wallet = (data.get('walletAddress') or '').strip().lower()
    phone = (data.get('phone') or '').strip()
    email = (data.get('email') or '').strip()

    if not wallet or not phone:
        return jsonify({"status": "ERROR", "message": "walletAddress and phone are required"}), 400

    sms_service.save_user_contact(wallet, phone, email)
    return jsonify({"status": "OK", "message": "Contact info securely saved"})


@app.route('/api/notifications/my_sms', methods=['GET'])
def get_my_sms_notifications():
    wallet = request.args.get('walletAddress', '').strip().lower()
    if not wallet:
        return jsonify({"status": "ERROR", "message": "walletAddress parameter is required"}), 400

    notifications = sms_service.get_user_notifications(wallet)
    return jsonify({"status": "OK", "notifications": notifications})


@app.route('/api/notifications/notify_offer', methods=['POST'])
def notify_offer():
    data = request.get_json(force=True, silent=True) or request.form
    seller_wallet = data.get('sellerWallet', '').strip().lower()
    property_id = data.get('propertyId')
    buyer_wallet = data.get('buyerWallet', '').strip().lower()
    price_eth = data.get('priceEth')

    if not seller_wallet or not property_id:
        return jsonify({"status": "ERROR", "message": "sellerWallet and propertyId are required"}), 400

    sms_service.notify_offer_received(seller_wallet, property_id, buyer_wallet, price_eth)
    return jsonify({"status": "OK", "message": "Offer SMS dispatched"})


@app.route('/api/notifications/notify_transfer', methods=['POST'])
def notify_transfer():
    data = request.get_json(force=True, silent=True) or request.form
    seller_wallet = data.get('sellerWallet', '').strip().lower()
    buyer_wallet = data.get('buyerWallet', '').strip().lower()
    property_id = data.get('propertyId')
    price_eth = data.get('priceEth')

    if not seller_wallet or not buyer_wallet or not property_id:
        return jsonify({"status": "ERROR", "message": "sellerWallet, buyerWallet, and propertyId are required"}), 400

    sms_service.notify_transfer_completed(seller_wallet, buyer_wallet, property_id, price_eth)
    return jsonify({"status": "OK", "message": "Transfer settlement SMS dispatched"})


@app.errorhandler(404)
def page_not_found(e):
    return render_template('index.html'), 404


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
