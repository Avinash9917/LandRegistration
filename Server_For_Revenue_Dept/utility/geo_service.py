import os
import sys

users_utility_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Server_For_Users", "utility")
if users_utility_dir not in sys.path:
    sys.path.append(users_utility_dir)

from geo_service import GeoLocationService

__all__ = ["GeoLocationService"]
