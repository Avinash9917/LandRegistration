import os
import sys

# Import from Server_For_Users utility to ensure single source of truth
users_utility_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Server_For_Users", "utility")
if users_utility_dir not in sys.path:
    sys.path.append(users_utility_dir)

from ocr_service import OCRService, PropertyOCRAuditRepository

__all__ = ["OCRService", "PropertyOCRAuditRepository"]
