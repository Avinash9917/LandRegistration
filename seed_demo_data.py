"""
Land Registration DApp — Automated Demo Data Seeder
Populates realistic demo citizens (Abitha & Yashvitha), revenue officer (Abhishek), and super admin (Avinash).
"""

import json
import os
import sys
from pymongo import MongoClient
import gridfs
from web3 import Web3, HTTPProvider
from werkzeug.security import generate_password_hash

# Add Server paths for crypto utilities
sys.path.append(os.path.join(os.path.dirname(__file__), "Server_For_Users"))
from utility.crypto_utils import (
    encrypt_aadhaar,
    compute_salted_aadhaar_hash,
    compute_document_hash,
)

GANACHE_URL = os.environ.get("GANACHE_URL", "http://127.0.0.1:7545")
MONGO_DB_URL = os.environ.get("MONGO_DB_URL", "mongodb://localhost:27017")
NETWORK_CHAIN_ID = "5777"

def generate_sample_pdf_bytes(title_text, survey_no, owner_name):
    """Generates a minimal valid PDF byte sequence for title deed demonstration."""
    pdf_content = f"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 120 >>
stream
BT
/F1 16 Tf
50 700 Td
({title_text}) Tj
0 -30 Td
(Survey Reference: {survey_no}) Tj
0 -30 Td
(Registered Owner: {owner_name}) Tj
0 -30 Td
(Government Land Records Authenticated) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
376
%%EOF"""
    return pdf_content.encode('utf-8')


def seed():
    print("=" * 60)
    print(">> Initializing Land Registration DApp Demo Seeder")
    print("=" * 60)

    # 1. Connect to Blockchain & MongoDB
    w3 = Web3(HTTPProvider(GANACHE_URL))
    if not w3.is_connected():
        print("[ERROR] Cannot connect to Ganache on", GANACHE_URL)
        return

    accounts = w3.eth.accounts
    if len(accounts) < 4:
        print("[ERROR] Ganache must have at least 4 unlocked accounts.")
        return

    admin_account = accounts[0]
    officer_account = accounts[1]
    citizen_a = accounts[2]
    citizen_b = accounts[3]

    print(f"[*] Super Admin       : {admin_account} (Avinash)")
    print(f"[*] Revenue Officer   : {officer_account} (Abhishek - Dept #501)")
    print(f"[*] Citizen A         : {citizen_a} (Abitha)")
    print(f"[*] Citizen B         : {citizen_b} (Yashvitha)")

    mongo_client = MongoClient(MONGO_DB_URL)
    db = mongo_client.LandRegistry
    fs = gridfs.GridFS(db)
    property_docs_col = db.Property_Docs
    users_kyc_col = db.Users_KYC
    employees_col = mongo_client.Revenue_Dept.Employees

    # 2. Load Contract Artifacts
    contracts_dir = os.path.join(os.path.dirname(__file__), "Smart_contracts", "build", "contracts")
    
    with open(os.path.join(contracts_dir, "Users.json")) as f:
        users_artifact = json.load(f)
    with open(os.path.join(contracts_dir, "LandRegistry.json")) as f:
        land_registry_artifact = json.load(f)
    with open(os.path.join(contracts_dir, "TransferOwnerShip.json")) as f:
        transfer_artifact = json.load(f)

    users_contract = w3.eth.contract(
        address=users_artifact["networks"][NETWORK_CHAIN_ID]["address"],
        abi=users_artifact["abi"]
    )
    land_contract = w3.eth.contract(
        address=land_registry_artifact["networks"][NETWORK_CHAIN_ID]["address"],
        abi=land_registry_artifact["abi"]
    )
    transfer_contract = w3.eth.contract(
        address=transfer_artifact["networks"][NETWORK_CHAIN_ID]["address"],
        abi=transfer_artifact["abi"]
    )

    print("\n[+] Smart Contracts Loaded:")
    print(f"  - Users              : {users_contract.address}")
    print(f"  - LandRegistry       : {land_contract.address}")
    print(f"  - TransferOwnerShip  : {transfer_contract.address}")

    # 3. Setup Super Admin & Revenue Officer in DB & On-Chain
    print("\n[1/5] Setting up Super Admin & Revenue Officer...")
    try:
        # Admin in DB
        employees_col.update_one(
            {"adminAddress": admin_account.lower()},
            {"$set": {
                "adminAddress": admin_account.lower(),
                "password": generate_password_hash("12345678"),
                "firstname": "Avinash",
                "fname": "Avinash",
                "lastName": "Chief Registrar",
                "lname": "Chief Registrar"
            }},
            upsert=True
        )

        # Map Officer Abhishek to Dept #501 and Dept #500
        tx_hash = land_contract.functions.mapRevenueDeptIdToEmployee(501, officer_account).transact({'from': admin_account})
        w3.eth.wait_for_transaction_receipt(tx_hash)
        print("  [OK] Officer Abhishek granted OFFICER_ROLE on-chain for Dept #501")

        employees_col.update_one(
            {"employeeWallet": officer_account.lower()},
            {"$set": {
                "employeeWallet": officer_account.lower(),
                "employeeId": officer_account.lower(),
                "password": generate_password_hash("12345678"),
                "firstname": "Abhishek",
                "fname": "Abhishek",
                "lastName": "Kumar",
                "lname": "Kumar",
                "revenueDeptId": 501
            }},
            upsert=True
        )
        print("  [OK] Officer Abhishek record created in Revenue_Dept MongoDB (PIN: 12345678)")
    except Exception as e:
        print(f"  [WARN] Officer setup: {e}")

    # 4. Register Citizen A (Abitha)
    print("\n[2/5] Registering Citizen A (Abitha)...")
    try:
        user_a_details = users_contract.functions.users(citizen_a).call()
        if user_a_details[0].lower() != citizen_a.lower():
            raw_aadhaar = "998877665544"
            enc_aadhaar = encrypt_aadhaar(raw_aadhaar)
            salted_hash_hex = compute_salted_aadhaar_hash(raw_aadhaar)
            salted_hash_bytes = bytes.fromhex(salted_hash_hex[2:] if salted_hash_hex.startswith("0x") else salted_hash_hex)

            tx_hash = users_contract.functions.registerUser(
                "Abitha",
                "R",
                "1994-06-18",
                salted_hash_bytes
            ).transact({'from': citizen_a})
            w3.eth.wait_for_transaction_receipt(tx_hash)

            users_kyc_col.update_one(
                {"walletAddress": citizen_a.lower()},
                {"$set": {
                    "walletAddress": citizen_a.lower(),
                    "encryptedAadhaar": enc_aadhaar,
                    "firstName": "Abitha",
                    "lastName": "R"
                }},
                upsert=True
            )
            print("  [OK] Citizen A (Abitha) registered on-chain with zero plaintext PII")
        else:
            print("  [INFO] Citizen A (Abitha) is already registered.")
    except Exception as e:
        print(f"  [WARN] Citizen A: {e}")

    # 5. Register Citizen B (Yashvitha)
    print("\n[3/5] Registering Citizen B (Yashvitha)...")
    try:
        user_b_details = users_contract.functions.users(citizen_b).call()
        if user_b_details[0].lower() != citizen_b.lower():
            raw_aadhaar_b = "112233445566"
            enc_aadhaar_b = encrypt_aadhaar(raw_aadhaar_b)
            salted_hash_hex_b = compute_salted_aadhaar_hash(raw_aadhaar_b)
            salted_hash_bytes_b = bytes.fromhex(salted_hash_hex_b[2:] if salted_hash_hex_b.startswith("0x") else salted_hash_hex_b)

            tx_hash = users_contract.functions.registerUser(
                "Yashvitha",
                "S",
                "1996-09-24",
                salted_hash_bytes_b
            ).transact({'from': citizen_b})
            w3.eth.wait_for_transaction_receipt(tx_hash)

            users_kyc_col.update_one(
                {"walletAddress": citizen_b.lower()},
                {"$set": {
                    "walletAddress": citizen_b.lower(),
                    "encryptedAadhaar": enc_aadhaar_b,
                    "firstName": "Yashvitha",
                    "lastName": "S"
                }},
                upsert=True
            )
            print("  [OK] Citizen B (Yashvitha) registered on-chain with zero plaintext PII")
        else:
            print("  [INFO] Citizen B (Yashvitha) is already registered.")
    except Exception as e:
        print(f"  [WARN] Citizen B: {e}")

    # 6. Add Demo Properties
    print("\n[4/5] Anchoring & Registering Sample Property Titles...")
    try:
        citizen_a_props = land_contract.functions.getPropertiesOfOwner(citizen_a).call()
        if len(citizen_a_props) == 0:
            pdf_1 = generate_sample_pdf_bytes("TITLE DEED - PLOT 101, WHITEFIELD TECH ZONE", "Sy. No 1001/2A", "Abitha R")
            doc_hash_hex_1 = compute_document_hash(pdf_1)
            doc_hash_bytes_1 = bytes.fromhex(doc_hash_hex_1[2:] if doc_hash_hex_1.startswith("0x") else doc_hash_hex_1)

            tx_hash = land_contract.functions.addLand(
                10,
                501,
                1001,
                "Whitefield Tech Zone",
                "Bangalore Urban North",
                "Sy. No 1001/2A",
                2400,
                doc_hash_bytes_1
            ).transact({'from': citizen_a})
            w3.eth.wait_for_transaction_receipt(tx_hash)
            
            all_props = land_contract.functions.getPropertiesOfOwner(citizen_a).call()
            prop_id_1 = int(all_props[-1][0])

            file_id_1 = fs.put(pdf_1, filename=f"{citizen_a.lower()}_{prop_id_1}.pdf", contentType='application/pdf')
            property_docs_col.update_one(
                {"Property_Id": str(prop_id_1)},
                {"$set": {
                    "Property_Id": str(prop_id_1),
                    "propertyId": prop_id_1,
                    "Owner": citizen_a.lower(),
                    "owner": citizen_a.lower(),
                    "file_id": file_id_1,
                    f"{citizen_a.lower()}_{prop_id_1}.pdf": file_id_1,
                    "documentHash": doc_hash_hex_1
                }},
                upsert=True
            )
            print(f"  [OK] Property #{prop_id_1} registered by Abitha (Hash: {doc_hash_hex_1[:12]}...)")
        else:
            all_props = citizen_a_props
            prop_id_1 = int(all_props[0][0])
            print(f"  [INFO] Abitha already owns Property #{prop_id_1}")

        # State is index 14 in Land struct (0: Created, 2: Verified, 4: OnSale)
        prop_1_state = int(all_props[0][14])
        if prop_1_state == 0:
            tx_v = land_contract.functions.verifyProperty(prop_id_1).transact({'from': officer_account})
            w3.eth.wait_for_transaction_receipt(tx_v)
            print(f"  [OK] Officer Abhishek verified Title #{prop_id_1} on-chain")

            # List Property 1 on Sale for 1.5 ETH
            tx_sale = transfer_contract.functions.addPropertyOnSale(prop_id_1, 1).transact({'from': citizen_a})
            w3.eth.wait_for_transaction_receipt(tx_sale)
            print(f"  [OK] Property #{prop_id_1} listed on Marketplace for 1 ETH")
        else:
            print(f"  [INFO] Property #{prop_id_1} state is already {prop_1_state}")

        citizen_b_props = land_contract.functions.getPropertiesOfOwner(citizen_b).call()
        if len(citizen_b_props) == 0:
            pdf_2 = generate_sample_pdf_bytes("TITLE DEED - PLOT 204, INDIRANAGAR GREENS", "Sy. No 1002/1B", "Yashvitha S")
            doc_hash_hex_2 = compute_document_hash(pdf_2)
            doc_hash_bytes_2 = bytes.fromhex(doc_hash_hex_2[2:] if doc_hash_hex_2.startswith("0x") else doc_hash_hex_2)

            tx_hash2 = land_contract.functions.addLand(
                10,
                501,
                1002,
                "Indiranagar Greens",
                "Bangalore Urban North",
                "Sy. No 1002/1B",
                1800,
                doc_hash_bytes_2
            ).transact({'from': citizen_b})
            w3.eth.wait_for_transaction_receipt(tx_hash2)

            all_b_props = land_contract.functions.getPropertiesOfOwner(citizen_b).call()
            prop_id_2 = int(all_b_props[-1][0])

            file_id_2 = fs.put(pdf_2, filename=f"{citizen_b.lower()}_{prop_id_2}.pdf", contentType='application/pdf')
            property_docs_col.update_one(
                {"Property_Id": str(prop_id_2)},
                {"$set": {
                    "Property_Id": str(prop_id_2),
                    "propertyId": prop_id_2,
                    "Owner": citizen_b.lower(),
                    "owner": citizen_b.lower(),
                    "file_id": file_id_2,
                    f"{citizen_b.lower()}_{prop_id_2}.pdf": file_id_2,
                    "documentHash": doc_hash_hex_2
                }},
                upsert=True
            )
            print(f"  [OK] Property #{prop_id_2} registered by Yashvitha (Pending Officer Abhishek Review)")
        else:
            print("  [INFO] Yashvitha properties already seeded.")

    except Exception as e:
        print(f"  [WARN] Property registration: {e}")

    print("\n" + "=" * 60)
    print("[SUCCESS] Demo Data Seeding Complete!")
    print("=" * 60)
    print("\nReady-to-use Demo Accounts (Ganache):")
    print(f"  1. Citizen A (Abitha)          : {citizen_a}")
    print("     - Role: Property Owner & Seller")
    print(f"     - Properties: Prop #{prop_id_1} (Verified, Listed on Marketplace for 1 ETH)")
    print(f"  2. Citizen B (Yashvitha)       : {citizen_b}")
    print("     - Role: Citizen / Buyer")
    print("     - Properties: Prop #2 (Pending verification by Officer)")
    print(f"  3. Revenue Officer (Abhishek)  : {officer_account}")
    print("     - Assigned Jurisdiction: Dept #501 (Bangalore Urban North)")
    print("     - Portal: http://127.0.0.1:5001 (PIN: 12345678)")
    print(f"  4. Super Admin (Avinash)       : {admin_account}")
    print("     - Admin Console: http://127.0.0.1:5001/admin (PIN: 12345678)")
    print("=" * 60)


if __name__ == "__main__":
    seed()
