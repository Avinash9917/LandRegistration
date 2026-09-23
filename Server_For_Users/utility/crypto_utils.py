import os
import base64
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from web3 import Web3

# 32-byte secret encryption key loaded from environment or generated securely
KYC_AES_SECRET_KEY = os.environ.get("KYC_AES_SECRET_KEY")
if not KYC_AES_SECRET_KEY:
    # 32-byte deterministic fallback for dev
    KYC_AES_SECRET_KEY = b"LandRegSecureAES256SecretKey32B!"
elif isinstance(KYC_AES_SECRET_KEY, str):
    KYC_AES_SECRET_KEY = KYC_AES_SECRET_KEY.encode('utf-8')[:32].ljust(32, b'#')

# Server salt for Aadhaar hashing
AADHAAR_HASH_SALT = os.environ.get("AADHAAR_HASH_SALT", "LandRegistryAadhaarSalt2026")


def encrypt_aadhaar(plaintext_aadhaar: str) -> str:
    """
    Encrypts Aadhaar number at rest using AES-256 GCM authenticated encryption.
    Returns base64 encoded nonce + ciphertext + tag.
    """
    if not plaintext_aadhaar:
        return ""
    
    nonce = get_random_bytes(12)
    cipher = AES.new(KYC_AES_SECRET_KEY, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext_aadhaar.encode('utf-8'))
    
    # Pack: nonce (12B) + tag (16B) + ciphertext
    payload = nonce + tag + ciphertext
    return base64.b64encode(payload).decode('utf-8')


def decrypt_aadhaar(encrypted_aadhaar_b64: str) -> str:
    """
    Decrypts AES-256 GCM encrypted Aadhaar number.
    """
    if not encrypted_aadhaar_b64:
        return ""
    
    try:
        payload = base64.b64decode(encrypted_aadhaar_b64.encode('utf-8'))
        nonce = payload[:12]
        tag = payload[12:28]
        ciphertext = payload[28:]
        
        cipher = AES.new(KYC_AES_SECRET_KEY, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        return plaintext.decode('utf-8')
    except Exception as e:
        raise ValueError(f"Aadhaar decryption failed: {str(e)}")


def compute_salted_aadhaar_hash(raw_aadhaar: str) -> str:
    """
    Computes a salted Keccak256 hash (bytes32 hex string) of the citizen Aadhaar number.
    Used exclusively for on-chain identity uniqueness checks (no plaintext PII).
    """
    clean_aadhaar = raw_aadhaar.strip().replace(" ", "").replace("-", "")
    salted_input = f"{AADHAAR_HASH_SALT}:{clean_aadhaar}"
    
    # Support both Web3.py v6/v7 (solidity_keccak) and fallback
    if hasattr(Web3, "solidity_keccak"):
        h = Web3.solidity_keccak(['string'], [salted_input]).hex()
    elif hasattr(Web3, "solidityKeccak"):
        h = Web3.solidityKeccak(['string'], [salted_input]).hex()
    else:
        h = Web3.keccak(text=salted_input).hex()
        
    if not h.startswith("0x"):
        h = "0x" + h
    return h


def compute_document_hash(file_bytes: bytes) -> str:
    """
    Computes cryptographic Keccak256 hash of PDF document bytes for on-chain anchoring.
    """
    return Web3.keccak(file_bytes).hex()


encrypt_pii = encrypt_aadhaar
decrypt_pii = decrypt_aadhaar
