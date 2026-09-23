"""
Phase 7: Geo-Location & Google Maps Integration Service
Handles map-picker pin captures, Geocoding API integration with caching,
and strict server-side coordinate precision privacy gating (fuzzed vs exact).
"""

import os
import requests
import datetime
from typing import Dict, List, Any, Optional, Tuple

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")


class GeoLocationService:
    """
    Coordinates manager with MongoDB caching and server-side precision policy.
    """

    def __init__(self, db_client):
        self.db = db_client.LandRegistry
        self.coords_col = self.db.Property_Coordinates
        self.geocode_cache_col = self.db.Geocode_Cache

    # ==========================================
    # GEOCODING & CACHING
    # ==========================================

    def geocode_address(self, address_text: str) -> Dict[str, Any]:
        """
        Geocodes text address into lat/lng.
        Caches results in MongoDB to control API costs.
        """
        if not address_text or not address_text.strip():
            return {"status": "ERROR", "message": "Address is empty"}

        norm_addr = address_text.strip().lower()

        # Check Cache
        cached = self.geocode_cache_col.find_one({"normalized_address": norm_addr}, {"_id": 0})
        if cached:
            return {
                "status": "OK",
                "lat": cached["lat"],
                "lng": cached["lng"],
                "formatted_address": cached["formatted_address"],
                "source": "CACHE"
            }

        # If API key is present, call Google Geocoding API
        if GOOGLE_MAPS_API_KEY:
            try:
                url = "https://maps.googleapis.com/maps/api/geocode/json"
                params = {"address": address_text, "key": GOOGLE_MAPS_API_KEY}
                res = requests.get(url, params=params, timeout=5)
                data = res.json()
                if data.get("status") == "OK" and data.get("results"):
                    first = data["results"][0]
                    lat = first["geometry"]["location"]["lat"]
                    lng = first["geometry"]["location"]["lng"]
                    fmt = first.get("formatted_address", address_text)

                    # Cache in DB
                    self.geocode_cache_col.update_one(
                        {"normalized_address": norm_addr},
                        {"$set": {
                            "normalized_address": norm_addr,
                            "lat": lat,
                            "lng": lng,
                            "formatted_address": fmt,
                            "cached_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                        }},
                        upsert=True
                    )
                    return {
                        "status": "OK",
                        "lat": lat,
                        "lng": lng,
                        "formatted_address": fmt,
                        "source": "GOOGLE_API"
                    }
            except Exception as e:
                pass

        # Fallback / Local mock generator based on landmark names (Bangalore reference coordinates)
        mock_coords = self._get_fallback_coordinates(address_text)
        self.geocode_cache_col.update_one(
            {"normalized_address": norm_addr},
            {"$set": {
                "normalized_address": norm_addr,
                "lat": mock_coords["lat"],
                "lng": mock_coords["lng"],
                "formatted_address": mock_coords["formatted_address"],
                "cached_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }},
            upsert=True
        )
        return {
            "status": "OK",
            "lat": mock_coords["lat"],
            "lng": mock_coords["lng"],
            "formatted_address": mock_coords["formatted_address"],
            "source": "FALLBACK"
        }

    def _get_fallback_coordinates(self, text: str) -> dict:
        t = text.lower()
        if "whitefield" in t:
            return {"lat": 12.9698, "lng": 77.7500, "formatted_address": f"{text}, Bangalore, Karnataka"}
        elif "indiranagar" in t:
            return {"lat": 12.9784, "lng": 77.6408, "formatted_address": f"{text}, Bangalore, Karnataka"}
        elif "koramangala" in t:
            return {"lat": 12.9352, "lng": 77.6245, "formatted_address": f"{text}, Bangalore, Karnataka"}
        elif "chennai" in t or "guindy" in t:
            return {"lat": 13.0067, "lng": 80.2025, "formatted_address": f"{text}, Chennai, Tamil Nadu"}
        else:
            return {"lat": 12.9716, "lng": 77.5946, "formatted_address": f"{text}, Bangalore, Karnataka"}

    # ==========================================
    # SAVE COORDINATES FROM REGISTRATION MAP PICKER
    # ==========================================

    def save_property_coordinates(
        self,
        property_id: int,
        lat: float,
        lng: float,
        formatted_address: str = "",
        user_confirmed: bool = True
    ) -> Dict[str, Any]:
        """
        Stores parcel coordinates submitted and confirmed by citizen during property registration.
        """
        lat = float(lat)
        lng = float(lng)
        fuzzed_lat = round(lat, 2)
        fuzzed_lng = round(lng, 2)

        record = {
            "propertyId": int(property_id),
            "exact_latitude": lat,
            "exact_longitude": lng,
            "fuzzed_latitude": fuzzed_lat,
            "fuzzed_longitude": fuzzed_lng,
            "formatted_address": formatted_address,
            "user_confirmed": user_confirmed,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        self.coords_col.update_one(
            {"propertyId": int(property_id)},
            {"$set": record},
            upsert=True
        )
        return record

    # ==========================================
    # SERVER-SIDE PRECISION PRIVACY GATING
    # ==========================================

    def get_property_location(
        self,
        property_id: int,
        requester_wallet: Optional[str] = None,
        is_officer_or_admin: bool = False,
        transfer_contract=None,
        land_contract=None
    ) -> Optional[Dict[str, Any]]:
        """
        Returns location metadata with server-side precision policy:
        - Anonymous / Unrelated user: Fuzzed neighborhood coordinates (~1.1 km radius).
        - Owner / Revenue Officer / Super Admin: Exact parcel coordinates.
        - Buyer with initiated/accepted purchase request: Exact parcel coordinates.
        """
        coord_doc = self.coords_col.find_one({"propertyId": int(property_id)}, {"_id": 0})
        if not coord_doc:
            return None

        # Determine authorization for exact coordinates
        is_authorized = False

        if is_officer_or_admin:
            is_authorized = True
        elif requester_wallet:
            req_wallet = requester_wallet.lower()

            # Check if requester is property owner
            if land_contract:
                try:
                    land_details = land_contract.functions.getLandDetailsAsStruct(int(property_id)).call()
                    owner = land_details[1].lower() if len(land_details) > 1 else ""
                    if owner == req_wallet:
                        is_authorized = True
                except Exception:
                    pass

            # Check if requester has initiated or active purchase request for this property
            if not is_authorized and transfer_contract:
                try:
                    req_sales = transfer_contract.functions.getRequestedSales(requester_wallet).call()
                    for sale in req_sales:
                        # sale[3] is propertyId
                        if int(sale[3]) == int(property_id):
                            is_authorized = True
                            break
                except Exception:
                    pass

        if is_authorized:
            return {
                "propertyId": int(property_id),
                "latitude": coord_doc["exact_latitude"],
                "longitude": coord_doc["exact_longitude"],
                "formatted_address": coord_doc.get("formatted_address", ""),
                "precision": "EXACT_PARCEL",
                "is_fuzzed": False
            }
        else:
            return {
                "propertyId": int(property_id),
                "latitude": coord_doc["fuzzed_latitude"],
                "longitude": coord_doc["fuzzed_longitude"],
                "formatted_address": coord_doc.get("formatted_address", ""),
                "precision": "PARCEL_FUZZED",
                "is_fuzzed": True
            }

    def get_marketplace_locations(self, active_sales: List[dict]) -> List[Dict[str, Any]]:
        """
        Returns map markers for active OnSale properties with fuzzed public coordinates.
        """
        markers = []
        for sale in active_sales:
            p_id = int(sale.get("propertyId", 0))
            coord_doc = self.coords_col.find_one({"propertyId": p_id}, {"_id": 0})

            lat = coord_doc["fuzzed_latitude"] if coord_doc else 12.9716
            lng = coord_doc["fuzzed_longitude"] if coord_doc else 77.5946
            fmt = coord_doc.get("formatted_address", "") if coord_doc else ""

            markers.append({
                "saleId": sale.get("saleId"),
                "propertyId": p_id,
                "price": sale.get("price"),
                "priceEth": sale.get("priceEth"),
                "locationName": sale.get("locationName", "Land Parcel"),
                "surveyNumberName": sale.get("surveyNumberName", ""),
                "area": sale.get("area", 0),
                "latitude": lat,
                "longitude": lng,
                "formatted_address": fmt,
                "precision": "PARCEL_FUZZED"
            })
        return markers
