"""
Phase 7 Test Suite: Google Maps Location Visibility & Privacy Gating
Covers:
1. Registration stores valid lat/lng from map-picker.
2. Geocoding fallback returns overridable pin & caches in MongoDB.
3. Marketplace map shows markers only for active OnSale properties.
4. Server-side precision gating (fuzzed for public/anonymous vs exact for authorized buyers/owners/officers).
"""

import unittest
import os
import sys
from pymongo import MongoClient

# Add utility paths
sys.path.append(os.path.join(os.path.dirname(__file__), "Server_For_Users"))
from utility.geo_service import GeoLocationService


class MockLandContract:
    def __init__(self, property_id: int, owner: str):
        self.property_id = property_id
        self.owner = owner

    class Functions:
        def __init__(self, parent):
            self.parent = parent

        def getLandDetailsAsStruct(self, prop_id):
            class CallWrapper:
                def __init__(self, p):
                    self.p = p
                def call(self):
                    # [prop_id, owner, state, ...]
                    return [prop_id, self.p.owner, 0, 0, 0, "Whitefield", "Dept", "1001/2A", 2400]
            return CallWrapper(self.parent)

    @property
    def functions(self):
        return self.Functions(self)


class MockTransferContract:
    def __init__(self, requested_sales_map: dict):
        self.requested_sales_map = requested_sales_map

    class Functions:
        def __init__(self, parent):
            self.parent = parent

        def getRequestedSales(self, buyer_wallet):
            class CallWrapper:
                def __init__(self, p, bw):
                    self.p = p
                    self.bw = bw
                def call(self):
                    # returns list of sales, where sale[3] is propertyId
                    return self.p.requested_sales_map.get(self.bw.lower(), [])
            return CallWrapper(self.parent, buyer_wallet)

    @property
    def functions(self):
        return self.Functions(self)


class TestPhase7GeoMapsService(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.mongo = MongoClient("mongodb://localhost:27017")
        cls.geo = GeoLocationService(cls.mongo)

    def setUp(self):
        self.mongo.LandRegistry.Property_Coordinates.delete_many({"propertyId": {"$in": [77001, 77002, 77003]}})
        self.mongo.LandRegistry.Geocode_Cache.delete_many({"normalized_address": "test plot 77, whitefield, bangalore"})

    # -------------------------------------------------------------
    # 1. Registration Map Picker Coordinate Storage
    # -------------------------------------------------------------
    def test_save_property_coordinates_from_map_picker(self):
        prop_id = 77001
        exact_lat = 12.969845
        exact_lng = 77.750012

        saved = self.geo.save_property_coordinates(
            property_id=prop_id,
            lat=exact_lat,
            lng=exact_lng,
            formatted_address="Plot 101, Whitefield Tech Zone, Bangalore",
            user_confirmed=True
        )

        self.assertEqual(saved["propertyId"], prop_id)
        self.assertEqual(saved["exact_latitude"], exact_lat)
        self.assertEqual(saved["exact_longitude"], exact_lng)
        self.assertEqual(saved["fuzzed_latitude"], 12.97)
        self.assertEqual(saved["fuzzed_longitude"], 77.75)
        self.assertTrue(saved["user_confirmed"])

        # Check in DB
        db_record = self.mongo.LandRegistry.Property_Coordinates.find_one({"propertyId": prop_id})
        self.assertIsNotNone(db_record)
        self.assertEqual(db_record["exact_latitude"], exact_lat)

    # -------------------------------------------------------------
    # 2. Geocoding Fallback with Caching
    # -------------------------------------------------------------
    def test_geocoding_fallback_and_caching(self):
        addr = "Test Plot 77, Whitefield, Bangalore"
        res1 = self.geo.geocode_address(addr)
        self.assertEqual(res1["status"], "OK")
        self.assertAlmostEqual(res1["lat"], 12.9698, places=2)
        self.assertAlmostEqual(res1["lng"], 77.7500, places=2)

        # Ensure result was cached in MongoDB
        cached = self.mongo.LandRegistry.Geocode_Cache.find_one({"normalized_address": addr.lower()})
        self.assertIsNotNone(cached)

        # Second call hits cache
        res2 = self.geo.geocode_address(addr)
        self.assertEqual(res2["source"], "CACHE")
        self.assertEqual(res2["lat"], res1["lat"])

    # -------------------------------------------------------------
    # 3. Server-Side Precision Privacy Policy Gating
    # -------------------------------------------------------------
    def test_precision_gating_anonymous_vs_authorized(self):
        prop_id = 77002
        exact_lat = 12.978432
        exact_lng = 77.640891
        owner_wallet = "0xF20dfCC8B3f67F07C4531B11C2B52B503c704003"
        buyer_with_offer = "0x0DaF158C1251b53b20fF4cf9Cb8633C91e7db6E8"
        unrelated_user = "0x9999999999999999999999999999999999999999"

        self.geo.save_property_coordinates(
            property_id=prop_id,
            lat=exact_lat,
            lng=exact_lng,
            formatted_address="Indiranagar Greens, Bangalore"
        )

        mock_land = MockLandContract(prop_id, owner_wallet)
        # Mock sale for buyer: [saleId, owner, price, propertyId=77002, ...]
        mock_transfer = MockTransferContract({
            buyer_with_offer.lower(): [[1, owner_wallet, 1000000000000000000, prop_id, buyer_with_offer, 0, 0, 0, False, 0]]
        })

        # A. Anonymous browser (no wallet) -> Fuzzed precision
        loc_anon = self.geo.get_property_location(prop_id, requester_wallet=None)
        self.assertEqual(loc_anon["precision"], "PARCEL_FUZZED")
        self.assertTrue(loc_anon["is_fuzzed"])
        self.assertEqual(loc_anon["latitude"], 12.98)
        self.assertEqual(loc_anon["longitude"], 77.64)

        # B. Unrelated user -> Fuzzed precision
        loc_unrelated = self.geo.get_property_location(
            prop_id,
            requester_wallet=unrelated_user,
            land_contract=mock_land,
            transfer_contract=mock_transfer
        )
        self.assertEqual(loc_unrelated["precision"], "PARCEL_FUZZED")
        self.assertTrue(loc_unrelated["is_fuzzed"])

        # C. Property Owner -> Exact precision
        loc_owner = self.geo.get_property_location(
            prop_id,
            requester_wallet=owner_wallet,
            land_contract=mock_land,
            transfer_contract=mock_transfer
        )
        self.assertEqual(loc_owner["precision"], "EXACT_PARCEL")
        self.assertFalse(loc_owner["is_fuzzed"])
        self.assertEqual(loc_owner["latitude"], exact_lat)
        self.assertEqual(loc_owner["longitude"], exact_lng)

        # D. Revenue Officer -> Exact precision
        loc_officer = self.geo.get_property_location(
            prop_id,
            requester_wallet=None,
            is_officer_or_admin=True
        )
        self.assertEqual(loc_officer["precision"], "EXACT_PARCEL")
        self.assertFalse(loc_officer["is_fuzzed"])
        self.assertEqual(loc_officer["latitude"], exact_lat)

        # E. Buyer with active purchase request -> Exact precision
        loc_buyer = self.geo.get_property_location(
            prop_id,
            requester_wallet=buyer_with_offer,
            land_contract=mock_land,
            transfer_contract=mock_transfer
        )
        self.assertEqual(loc_buyer["precision"], "EXACT_PARCEL")
        self.assertFalse(loc_buyer["is_fuzzed"])
        self.assertEqual(loc_buyer["latitude"], exact_lat)

    # -------------------------------------------------------------
    # 4. Marketplace Map Filtering
    # -------------------------------------------------------------
    def test_marketplace_locations_returns_onsale_properties(self):
        prop_id = 77003
        self.geo.save_property_coordinates(
            property_id=prop_id,
            lat=12.9698,
            lng=77.7500,
            formatted_address="Whitefield Tech Zone"
        )

        active_sales = [
            {
                "saleId": 0,
                "propertyId": prop_id,
                "price": "1000000000000000000",
                "priceEth": "1.0",
                "locationName": "Whitefield Tech Zone",
                "surveyNumberName": "Sy. No 1001/2A",
                "area": 2400
            }
        ]

        markers = self.geo.get_marketplace_locations(active_sales)
        self.assertEqual(len(markers), 1)
        self.assertEqual(markers[0]["propertyId"], prop_id)
        self.assertEqual(markers[0]["precision"], "PARCEL_FUZZED")
        self.assertEqual(markers[0]["priceEth"], "1.0")


if __name__ == "__main__":
    unittest.main()
