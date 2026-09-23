from web3 import Web3
import os
import json


def to_checksum(address_str):
    if not address_str:
        return ""
    if hasattr(Web3, "to_checksum_address"):
        return Web3.to_checksum_address(address_str)
    elif hasattr(Web3, "toChecksumAddress"):
        return Web3.toChecksumAddress(address_str)
    return address_str


def mapRevenueDeptIdToEmployee(revenueDeptId, employeeId):
    # Load config or environment variables
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config.json")
    config = {}
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)

    ganache_url = os.environ.get("GANACHE_URL", config.get("Ganache_Url", "http://127.0.0.1:7545"))
    admin_address = os.environ.get("ADMIN_WALLET_ADDRESS", config.get("Address_Used_To_Deploy_Contract"))
    network_chain_id = str(os.environ.get("NETWORK_CHAIN_ID", config.get("NETWORK_CHAIN_ID", 5777)))

    web3 = Web3(Web3.HTTPProvider(ganache_url))
    if not web3.is_connected():
        print("Web3 provider not connected")
        return False

    # Contract artifact
    contract_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "..", "Smart_contracts", "build", "contracts", "LandRegistry.json"
    )
    if not os.path.exists(contract_path):
        print(f"Contract artifact not found at {contract_path}")
        return False

    with open(contract_path, "r") as f:
        land_registry_json = json.load(f)

    contract_abi = land_registry_json["abi"]
    contract_address = land_registry_json["networks"].get(network_chain_id, {}).get("address")
    if not contract_address:
        print(f"LandRegistry contract address not found for network {network_chain_id}")
        return False

    contract = web3.eth.contract(abi=contract_abi, address=contract_address)
    checksum_emp = to_checksum(employeeId)
    dept_id = int(revenueDeptId)

    # 1. Pre-check: If already mapped on-chain (e.g. via MetaMask browser transaction), return True
    try:
        current_officer = contract.functions.revenueDeptIdToEmployee(dept_id).call()
        if current_officer and current_officer.lower() == checksum_emp.lower():
            return True
    except Exception:
        pass

    # 2. Transact on-chain if not already mapped
    from_account = to_checksum(admin_address) if admin_address else None
    accounts = web3.eth.accounts
    if (not from_account or from_account not in accounts) and len(accounts) > 0:
        from_account = accounts[0]

    try:
        txn_hash = contract.functions.mapRevenueDeptIdToEmployee(
            dept_id,
            checksum_emp
        ).transact({'from': from_account})

        receipt = web3.eth.wait_for_transaction_receipt(txn_hash) if hasattr(web3.eth, 'wait_for_transaction_receipt') else web3.eth.waitForTransactionReceipt(txn_hash)
        return receipt['status'] == 1
    except Exception as e:
        print(f"Error mapping employee on-chain: {str(e)}")
        # Check if the mapping succeeded despite error
        try:
            current_officer = contract.functions.revenueDeptIdToEmployee(dept_id).call()
            if current_officer and current_officer.lower() == checksum_emp.lower():
                return True
        except Exception:
            pass
        return False
