import os
import json
import time
from web3 import Web3

# 1. Parse environment variables
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
env_vars = {}
with open(env_path, "r") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

rpc_url = env_vars.get("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
if "tenderly" in rpc_url:
    rpc_url = "https://ethereum-sepolia-rpc.publicnode.com"

print(f"Connecting to Sepolia RPC: {rpc_url}")
w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={'timeout': 60}))
assert w3.is_connected(), "Failed to connect to Sepolia RPC!"

chain_id = w3.eth.chain_id
print(f"Connected! Chain ID: {chain_id}, Block: {w3.eth.block_number}")

private_key = env_vars["DEPLOYER_PRIVATE_KEY"]
if not private_key.startswith("0x"):
    private_key = "0x" + private_key

account = w3.eth.account.from_key(private_key)
deployer_address = account.address
balance = w3.eth.get_balance(deployer_address)
print(f"Deployer Address: {deployer_address}")
print(f"Deployer Balance: {w3.from_wei(balance, 'ether')} ETH")

if balance == 0:
    raise ValueError("Deployer account has 0 ETH! Please fund it first.")

build_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "build", "contracts"))

def load_artifact(name):
    path = os.path.join(build_dir, f"{name}.json")
    with open(path, "r") as f:
        return json.load(f), path

def send_tx(tx_dict):
    tx_dict['chainId'] = chain_id
    if 'nonce' not in tx_dict:
        tx_dict['nonce'] = w3.eth.get_transaction_count(deployer_address)
    if 'maxFeePerGas' in tx_dict:
        if 'gasPrice' in tx_dict:
            del tx_dict['gasPrice']
    elif 'gasPrice' not in tx_dict:
        tx_dict['gasPrice'] = int(w3.eth.gas_price * 1.25)
    
    signed = w3.eth.account.sign_transaction(tx_dict, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"  Tx Broadcasted: {tx_hash.hex()}")
    print("  Waiting for receipt...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
    if receipt.status != 1:
        raise RuntimeError(f"Transaction failed! Receipt: {receipt}")
    print(f"  Confirmed in block {receipt.blockNumber}, gas used: {receipt.gasUsed}")
    return receipt, tx_hash.hex()

def update_artifact(art_path, art_json, contract_addr, tx_hash):
    if "networks" not in art_json:
        art_json["networks"] = {}
    art_json["networks"][str(chain_id)] = {
        "events": {},
        "links": {},
        "address": contract_addr,
        "transactionHash": tx_hash
    }
    with open(art_path, "w") as f:
        json.dump(art_json, f, indent=2)

print("\n--- 1. Deploying Users Contract ---")
users_art, users_path = load_artifact("Users")
users_contract = w3.eth.contract(abi=users_art["abi"], bytecode=users_art["bytecode"])
estimated_gas = users_contract.constructor().estimate_gas({'from': deployer_address})
tx = users_contract.constructor().build_transaction({
    'from': deployer_address,
    'gas': int(estimated_gas * 1.2)
})
users_receipt, users_tx_hash = send_tx(tx)
users_address = users_receipt.contractAddress
print(f"Users deployed at: {users_address}")
update_artifact(users_path, users_art, users_address, users_tx_hash)

print("\n--- 2. Deploying MockLandRecordsOracle Contract ---")
oracle_art, oracle_path = load_artifact("MockLandRecordsOracle")
oracle_contract = w3.eth.contract(abi=oracle_art["abi"], bytecode=oracle_art["bytecode"])
estimated_gas = oracle_contract.constructor().estimate_gas({'from': deployer_address})
tx = oracle_contract.constructor().build_transaction({
    'from': deployer_address,
    'gas': int(estimated_gas * 1.2)
})
oracle_receipt, oracle_tx_hash = send_tx(tx)
oracle_address = oracle_receipt.contractAddress
print(f"MockLandRecordsOracle deployed at: {oracle_address}")
update_artifact(oracle_path, oracle_art, oracle_address, oracle_tx_hash)

print("\n--- 3. Deploying LandRegistry Contract ---")
registry_art, registry_path = load_artifact("LandRegistry")
registry_contract = w3.eth.contract(abi=registry_art["abi"], bytecode=registry_art["bytecode"])
estimated_gas = registry_contract.constructor().estimate_gas({'from': deployer_address})
tx = registry_contract.constructor().build_transaction({
    'from': deployer_address,
    'gas': int(estimated_gas * 1.2)
})
registry_receipt, registry_tx_hash = send_tx(tx)
registry_address = registry_receipt.contractAddress
print(f"LandRegistry deployed at: {registry_address}")
update_artifact(registry_path, registry_art, registry_address, registry_tx_hash)

print("\n--- 4. Setting Oracle Address on LandRegistry ---")
registry_instance = w3.eth.contract(address=registry_address, abi=registry_art["abi"])
tx = registry_instance.functions.setOracleAddress(oracle_address).build_transaction({
    'from': deployer_address,
    'gas': 100000
})
send_tx(tx)
print(f"Oracle configured successfully on LandRegistry!")

print("\n--- 5. Deploying TransferOwnerShip Contract ---")
transfer_art, transfer_path = load_artifact("TransferOwnerShip")
transfer_contract = w3.eth.contract(abi=transfer_art["abi"], bytecode=transfer_art["bytecode"])
estimated_gas = transfer_contract.constructor(registry_address).estimate_gas({'from': deployer_address})
tx = transfer_contract.constructor(registry_address).build_transaction({
    'from': deployer_address,
    'gas': int(estimated_gas * 1.2)
})
transfer_receipt, transfer_tx_hash = send_tx(tx)
transfer_address = transfer_receipt.contractAddress
print(f"TransferOwnerShip deployed at: {transfer_address}")
update_artifact(transfer_path, transfer_art, transfer_address, transfer_tx_hash)

# Copy updated artifacts to Server_For_Users/contracts and Server_For_Revenue_Dept/contracts
print("\n--- 6. Syncing Contract Artifacts to Portals ---")
targets = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "Server_For_Users", "contracts")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "Server_For_Revenue_Dept", "contracts"))
]

for contract_name in ["Users", "MockLandRecordsOracle", "LandRegistry", "TransferOwnerShip"]:
    src = os.path.join(build_dir, f"{contract_name}.json")
    with open(src, "r") as f:
        data = f.read()
    for target_dir in targets:
        os.makedirs(target_dir, exist_ok=True)
        dest = os.path.join(target_dir, f"{contract_name}.json")
        with open(dest, "w") as f:
            f.write(data)
        print(f"Synced {contract_name}.json -> {dest}")

print("\n=======================================================")
print("ALL SMART CONTRACTS DEPLOYED & SYNCED SUCCESSFULLY!")
print(f"Network: Sepolia (Chain ID: {chain_id})")
print(f"Users:              {users_address} (https://sepolia.etherscan.io/address/{users_address})")
print(f"MockOracle:         {oracle_address} (https://sepolia.etherscan.io/address/{oracle_address})")
print(f"LandRegistry:       {registry_address} (https://sepolia.etherscan.io/address/{registry_address})")
print(f"TransferOwnerShip:  {transfer_address} (https://sepolia.etherscan.io/address/{transfer_address})")
print("=======================================================")
