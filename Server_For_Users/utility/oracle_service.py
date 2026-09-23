"""
Government Land Records Oracle Service
Adapter interface for Bhoomi / Dharani state land registries.
"""

import os
from typing import Dict, Any, Tuple


class GovernmentLandRecordsService:
    def __init__(self, api_url: str = None, api_key: str = None):
        self.api_url = api_url or os.environ.get("GOVT_LAND_API_URL", "https://api.mock-landrecords.gov.in/v1")
        self.api_key = api_key or os.environ.get("GOVT_LAND_API_KEY", "MOCK_KEY_DEV")
        
        # Local mock database of official survey numbers for dev environment
        self._mock_registry: Dict[Tuple[int, int], Dict[str, Any]] = {
            (555, 101): {"owner_name": "John Doe", "is_litigated": False, "official_area": 1200},
            (777, 101): {"owner_name": "John Doe", "is_litigated": False, "official_area": 1500},
            (999, 301): {"owner_name": "Disputed Property", "is_litigated": True, "official_area": 2000},
        }

    def verify_survey_record(self, survey_number: int, revenue_dept_id: int, claimant_address: str) -> Dict[str, Any]:
        """
        Verify survey number ownership and encumbrance status against government records.
        """
        key = (int(survey_number), int(revenue_dept_id))
        
        if key in self._mock_registry:
            record = self._mock_registry[key]
            if record["is_litigated"]:
                return {
                    "valid": False,
                    "reason": "Survey number flagged in government registry for active litigation/dispute"
                }
            return {
                "valid": True,
                "owner_name": record["owner_name"],
                "official_area": record["official_area"],
                "reason": "Official record verified"
            }
        
        # Unassigned survey number in dev
        return {
            "valid": True,
            "owner_name": "Unassigned / Open",
            "official_area": 0,
            "reason": "Clear Title (Mock Verified)"
        }
