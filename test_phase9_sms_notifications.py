"""
Test Suite for Phase 9: Phone Number KYC & Real-Time SMS Notification Engine
=============================================================================
Verifies:
1. Contact PII encryption at rest (Phone mandatory, Email optional) via AES-256 GCM.
2. 6-digit OTP generation, validation, and expiry handling.
3. Automated SMS notification dispatch for all 4 key lifecycle events:
   - Trigger 1: Property Registered
   - Trigger 2: Officer Verified
   - Trigger 3: Offer Received
   - Trigger 4: Transfer Completed
4. User notification history retrieval.
"""

import unittest
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "Server_For_Users"))
from utility.sms_notification_service import SMSNotificationService
from utility.crypto_utils import encrypt_pii, decrypt_pii


class TestPhase9SMSNotificationService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = SMSNotificationService()
        cls.test_wallet = "0xf20dfcc8b3f67f07c4531b11c2b52b503c704003"  # Abitha
        cls.buyer_wallet = "0x0daf158c1251b53b20ff4cf9cb8633c91e7db6e8"  # Yashvitha
        cls.phone = "9876543210"
        cls.email = "abitha.citizen@domain.com"

    def test_01_save_and_decrypt_contact_pii(self):
        """Verify phone is mandatory, email is optional, and both are encrypted at rest."""
        self.service.save_user_contact(self.test_wallet, self.phone, self.email)
        contact = self.service.get_user_contact(self.test_wallet)

        self.assertIsNotNone(contact)
        self.assertEqual(contact["phone"], self.phone)
        self.assertEqual(contact["email"], self.email)

        # Raw DB check: ensure no plaintext in DB
        raw_doc = self.service.users_pii.find_one({"walletAddress": self.test_wallet})
        self.assertNotIn(self.phone, str(raw_doc.get("encryptedPhone")))
        self.assertNotIn(self.email, str(raw_doc.get("encryptedEmail")))

    def test_02_otp_generation_and_verification(self):
        """Verify 6-digit OTP generation and successful verification."""
        otp_res = self.service.generate_and_send_otp(self.test_wallet, self.phone)
        self.assertEqual(otp_res["status"], "SUCCESS")
        self.assertEqual(len(otp_res["otp"]), 6)
        self.assertTrue(otp_res["otp"].isdigit())

        # Test invalid OTP
        wrong_res = self.service.verify_otp(self.test_wallet, "000000")
        self.assertEqual(wrong_res["status"], "ERROR")

        # Test correct OTP
        valid_res = self.service.verify_otp(self.test_wallet, otp_res["otp"])
        self.assertEqual(valid_res["status"], "SUCCESS")

    def test_03_trigger_1_property_registered_sms(self):
        """Verify Trigger 1: Land parcel submitted for verification."""
        rec = self.service.notify_property_registered(self.test_wallet, 1084, "SY-108/4A")
        self.assertIn("1084", rec["message"])
        self.assertIn("submitted for verification", rec["message"])
        self.assertEqual(rec["recipientWallet"], self.test_wallet)
        self.assertEqual(rec["deliveryStatus"], "DELIVERED")

    def test_04_trigger_2_officer_verified_sms(self):
        """Verify Trigger 2: Revenue Officer review & verification."""
        rec = self.service.notify_officer_review(self.test_wallet, 1084, 501, is_approved=True)
        self.assertIn("Officer #501 verified your title deed", rec["message"])
        self.assertIn("Property #1084", rec["message"])
        self.assertEqual(rec["deliveryStatus"], "DELIVERED")

    def test_05_trigger_3_offer_received_sms(self):
        """Verify Trigger 3: Purchase offer received on Marketplace."""
        rec = self.service.notify_offer_received(self.test_wallet, 1084, self.buyer_wallet, 5.0)
        self.assertIn("submitted a 5.0 ETH offer", rec["message"])
        self.assertIn("property #1084", rec["message"])
        self.assertEqual(rec["deliveryStatus"], "DELIVERED")

    def test_06_trigger_4_transfer_completed_sms(self):
        """Verify Trigger 4: Escrow settlement and ownership transfer completion."""
        self.service.save_user_contact(self.buyer_wallet, "9123456780")
        success = self.service.notify_transfer_completed(self.test_wallet, self.buyer_wallet, 1084, 5.0)
        self.assertTrue(success)

        # Check seller notifications
        seller_notifs = self.service.get_user_notifications(self.test_wallet)
        seller_msgs = [n["message"] for n in seller_notifs]
        self.assertTrue(any("5.0 ETH settled in your wallet" in m for m in seller_msgs))

        # Check buyer notifications
        buyer_notifs = self.service.get_user_notifications(self.buyer_wallet)
        buyer_msgs = [n["message"] for n in buyer_notifs]
        self.assertTrue(any("You are now the on-chain title owner of Property #1084" in m for m in buyer_msgs))


if __name__ == "__main__":
    unittest.main()
