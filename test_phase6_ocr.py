"""
Phase 6 Test Suite: Multi-Document OCR Extraction & Cross-Verification
Covers:
1. Field extraction for 5 document types (Sale Deed, Previous Title Deed, Patta, EC, Tax Receipt) with confidence scores.
2. AES-256 GCM PII encryption at rest.
3. Fuzzy matching (Exact, Minor OCR noise, Genuine mismatch, Low-confidence-but-consistent).
4. Policy enforcement: High confidence mismatch -> Risk Alert; Low confidence -> Manual Review.
5. Officer audit workflow: All 3 decisions persist, mandatory reason enforcement, and unblocking logic.
"""

import unittest
import os
import sys
import datetime
from pymongo import MongoClient

# Add utility paths
sys.path.append(os.path.join(os.path.dirname(__file__), "Server_For_Users"))
from utility.ocr_service import OCRService, PropertyOCRAuditRepository
from utility.crypto_utils import decrypt_aadhaar


class TestPhase6OCRService(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.ocr = OCRService()
        cls.mongo = MongoClient("mongodb://localhost:27017")
        cls.repo = PropertyOCRAuditRepository(cls.mongo)

    def setUp(self):
        self.mongo.LandRegistry.Property_OCR_Audit.delete_many({"propertyId": {"$in": [99991, 99992, 99993]}})

    # -------------------------------------------------------------
    # 1. State Config Driven Document Set Tests
    # -------------------------------------------------------------
    def test_state_document_config_loading(self):
        states = self.ocr.get_supported_states()
        self.assertIn("Tamil Nadu", states)
        self.assertIn("Karnataka", states)
        self.assertIn("Maharashtra", states)
        self.assertIn("Punjab_Haryana", states)

        tn_config = self.ocr.get_document_config_for_state("Tamil Nadu")
        self.assertIn("sale_deed", tn_config["documents"])
        self.assertIn("patta", tn_config["documents"])
        self.assertIn("encumbrance_certificate", tn_config["documents"])

    # -------------------------------------------------------------
    # 2. Structured Field Extraction for 5 Document Types
    # -------------------------------------------------------------
    def test_extract_sale_deed_fields(self):
        sample_text = """
        ABSOLUTE SALE DEED
        Registered Owner / Vendor: Abitha R, residing at Bangalore.
        Purchaser / Buyer: Yashvitha S.
        Property Description: Survey Reference Sy. No 1001/2A, Whitefield Tech Zone.
        Total Extent / Plot Area: 2400 sq.ft.
        Executed on Date: 2026-06-15.
        Aadhaar: 9988 7766 5544
        """
        res = self.ocr.extract_document_fields("sale_deed", sample_text)
        fields = res["fields"]
        conf = res["confidence_scores"]

        self.assertIn("Abitha", fields["owner_name"])
        self.assertIn("Yashvitha", fields["buyer_name"])
        self.assertEqual(fields["survey_number"], "1001/2A")
        self.assertEqual(fields["plot_area"], "2400")
        self.assertGreaterEqual(conf["survey_number"], 80.0)
        self.assertGreaterEqual(conf["plot_area"], 80.0)

        # Verify PII AES-256 GCM Encryption at rest
        self.assertNotIn("aadhaar_number", fields)
        self.assertIn("encrypted_aadhaar", fields)
        self.assertEqual(fields["aadhaar_masked"], "XXXX-XXXX-5544")
        decrypted = decrypt_aadhaar(fields["encrypted_aadhaar"])
        self.assertEqual(decrypted, "998877665544")

    def test_extract_previous_title_deed_fields(self):
        sample_text = """
        PARENT TITLE DEED
        Previous Owner / Vendor: Ramanathan K.
        Buyer / Purchaser: Abitha R.
        Survey Reference: Sy. No 1001/2A.
        Plot Area: 2400 sq.ft.
        """
        res = self.ocr.extract_document_fields("previous_title_deed", sample_text)
        fields = res["fields"]
        self.assertIn("Ramanathan", fields["previous_owner"])
        self.assertIn("Abitha", fields["buyer_name"])
        self.assertEqual(fields["survey_number"], "1001/2A")
        self.assertEqual(fields["plot_area"], "2400")

    def test_extract_patta_fields(self):
        sample_text = """
        GOVERNMENT OF TAMIL NADU - REVENUE DEPARTMENT
        Patta No: 45092
        Landholder Name: Abitha R
        Survey Number: 1001/2A
        Total Area: 2400 sq.ft
        """
        res = self.ocr.extract_document_fields("patta", sample_text)
        fields = res["fields"]
        self.assertEqual(fields["patta_number"], "45092")
        self.assertIn("Abitha", fields["landholder_name"])
        self.assertEqual(fields["survey_number"], "1001/2A")
        self.assertEqual(fields["plot_area"], "2400")

    def test_extract_encumbrance_certificate_fields(self):
        sample_text = """
        DEPARTMENT OF REGISTRATION - ENCUMBRANCE CERTIFICATE
        Survey No: 1001/2A
        Search Period: 2010-01-01 to 2026-06-01
        Encumbrance Entries: Nil / No Encumbrance Found
        """
        res = self.ocr.extract_document_fields("encumbrance_certificate", sample_text)
        fields = res["fields"]
        self.assertEqual(fields["survey_number"], "1001/2A")
        self.assertIn("Nil", fields["encumbrance_entries"])

    def test_extract_property_tax_receipt_fields(self):
        sample_text = """
        MUNICIPAL CORPORATION - PROPERTY TAX RECEIPT
        Assessment No: TAX-2026-9901
        Taxpayer Name: Abitha R
        Survey No: 1001/2A
        Amount Paid: 4,500.00
        """
        res = self.ocr.extract_document_fields("property_tax_receipt", sample_text)
        fields = res["fields"]
        self.assertEqual(fields["assessment_number"], "TAX-2026-9901")
        self.assertIn("Abitha", fields["taxpayer_name"])
        self.assertEqual(fields["survey_number"], "1001/2A")
        self.assertEqual(fields["paid_amount"], "4500.00")

    # -------------------------------------------------------------
    # 3. Fuzzy Matching & Normalization Unit Tests
    # -------------------------------------------------------------
    def test_fuzzy_matching_exact_and_minor_noise(self):
        # Exact match
        sim1 = self.ocr.calculate_string_similarity("Abitha R", "Abitha R")
        self.assertEqual(sim1, 1.0)

        # Minor OCR noise (titles, dots, spacing, casing)
        sim2 = self.ocr.calculate_string_similarity("Mrs. Abitha R", "Abitha.R")
        self.assertGreaterEqual(sim2, 0.85)

        # Survey number normalization
        sy1 = self.ocr.normalize_survey_number("Sy. No 1001/2A")
        sy2 = self.ocr.normalize_survey_number("Survey No. 1001 / 2A")
        sy3 = self.ocr.normalize_survey_number("1001/2A")
        self.assertEqual(sy1, "1001/2a")
        self.assertEqual(sy2, "1001/2a")
        self.assertEqual(sy3, "1001/2a")

    # -------------------------------------------------------------
    # 4. Consistency Audit Policies
    # -------------------------------------------------------------
    def test_consistent_documents_unblocked(self):
        prop_record = {
            "surveyNumber": "1001/2A",
            "ownerName": "Abitha R",
            "area": 2400
        }
        docs = {
            "sale_deed": {
                "fields": {"owner_name": "Abitha R", "survey_number": "Sy. No 1001/2A", "plot_area": "2400"},
                "confidence_scores": {"owner_name": 95.0, "survey_number": 95.0, "plot_area": 95.0}
            },
            "patta": {
                "fields": {"landholder_name": "Abitha R", "survey_number": "1001/2A", "plot_area": "2400"},
                "confidence_scores": {"landholder_name": 90.0, "survey_number": 92.0, "plot_area": 90.0}
            },
            "encumbrance_certificate": {
                "fields": {"survey_number": "1001/2A", "encumbrance_entries": "Nil"},
                "confidence_scores": {"survey_number": 94.0}
            }
        }
        audit = self.ocr.cross_verify_documents(prop_record, docs)
        self.assertEqual(audit["overall_status"], "VERIFIED_CONSISTENT")
        self.assertTrue(audit["is_unblocked"])
        self.assertEqual(len(audit["flags"]), 0)

    def test_high_confidence_mismatch_triggers_risk_alert(self):
        prop_record = {
            "surveyNumber": "1001/2A",
            "ownerName": "Abitha R",
            "area": 2400
        }
        # Patta has genuine mismatch (Survey No 9999/9Z and Owner Suresh) with high OCR confidence
        docs = {
            "sale_deed": {
                "fields": {"owner_name": "Abitha R", "survey_number": "1001/2A", "plot_area": "2400"},
                "confidence_scores": {"owner_name": 95.0, "survey_number": 95.0, "plot_area": 95.0}
            },
            "patta": {
                "fields": {"landholder_name": "Suresh Kumar", "survey_number": "9999/9Z", "plot_area": "2400"},
                "confidence_scores": {"landholder_name": 92.0, "survey_number": 94.0, "plot_area": 90.0}
            }
        }
        audit = self.ocr.cross_verify_documents(prop_record, docs)
        self.assertEqual(audit["overall_status"], "RISK_ALERT")
        self.assertFalse(audit["is_unblocked"])
        risk_flags = [f for f in audit["flags"] if f["flag_type"] == "Risk Alert"]
        self.assertGreaterEqual(len(risk_flags), 1)

    def test_low_confidence_triggers_manual_review_not_risk_alert(self):
        prop_record = {
            "surveyNumber": "1001/2A",
            "ownerName": "Abitha R",
            "area": 2400
        }
        # Low confidence reading in blurred image (65% confidence)
        docs = {
            "sale_deed": {
                "fields": {"owner_name": "Abitha R", "survey_number": "1001/2A", "plot_area": "2400"},
                "confidence_scores": {"owner_name": 95.0, "survey_number": 95.0, "plot_area": 95.0}
            },
            "patta": {
                "fields": {"landholder_name": "Abitha R", "survey_number": "1001/2A", "plot_area": "2400"},
                "confidence_scores": {"landholder_name": 62.0, "survey_number": 65.0, "plot_area": 60.0}
            }
        }
        audit = self.ocr.cross_verify_documents(prop_record, docs)
        self.assertEqual(audit["overall_status"], "MANUAL_REVIEW")
        self.assertFalse(audit["is_unblocked"])
        # Ensure it is flagged as Manual Review, NOT a Risk Alert
        flag_types = [f["flag_type"] for f in audit["flags"]]
        self.assertIn("Manual Review", flag_types)
        self.assertNotIn("Risk Alert", flag_types)

    # -------------------------------------------------------------
    # 5. Officer Audit Persistence & Decision Workflow
    # -------------------------------------------------------------
    def test_officer_review_all_three_decisions(self):
        test_prop_id = 99991
        officer_wallet = "0x1C5Ab81cf1221e6aa08129f9632801965D6b261F"

        # Save an initial audit with a risk alert
        audit_data = {
            "overall_status": "RISK_ALERT",
            "is_unblocked": False,
            "flags": [{"field": "survey_number", "flag_type": "Risk Alert", "message": "Mismatch"}]
        }
        self.repo.save_audit_result(test_prop_id, audit_data)

        # Verification is initially blocked
        unblocked, msg = self.repo.is_verification_unblocked(test_prop_id)
        self.assertFalse(unblocked)

        # 1. Decision: REQUEST_REUPLOAD
        d1 = self.repo.record_officer_decision(
            test_prop_id,
            officer_wallet,
            "REQUEST_REUPLOAD",
            "Patta copy is illegible, please upload high-res scan."
        )
        self.assertEqual(d1["decision_type"], "REQUEST_REUPLOAD")
        unblocked, msg = self.repo.is_verification_unblocked(test_prop_id)
        self.assertFalse(unblocked)
        self.assertIn("re-upload", msg.lower())

        # 2. Decision: ESCALATE
        d2 = self.repo.record_officer_decision(
            test_prop_id,
            officer_wallet,
            "ESCALATE",
            "Discrepancy in revenue subdivision boundary, escalating to Tahsildar."
        )
        self.assertEqual(d2["decision_type"], "ESCALATE")
        unblocked, msg = self.repo.is_verification_unblocked(test_prop_id)
        self.assertFalse(unblocked)
        self.assertIn("escalated", msg.lower())

        # 3. Decision: RESOLVE_ACCEPTABLE (Unblocks verification)
        d3 = self.repo.record_officer_decision(
            test_prop_id,
            officer_wallet,
            "RESOLVE_ACCEPTABLE",
            "Verified physical revenue register volume 102 page 45, subdivision 2A matches title."
        )
        self.assertEqual(d3["decision_type"], "RESOLVE_ACCEPTABLE")
        unblocked, msg = self.repo.is_verification_unblocked(test_prop_id)
        self.assertTrue(unblocked)
        self.assertIn("accepted", msg.lower())

        # Verify audit history is fully persisted and retrievable
        trail = self.repo.get_audit_trail(test_prop_id)
        self.assertIsNotNone(trail)
        self.assertEqual(len(trail["decision_history"]), 3)
        self.assertEqual(trail["latest_decision"]["decision_type"], "RESOLVE_ACCEPTABLE")

    def test_officer_decision_validation_empty_reason_reverts(self):
        with self.assertRaises(ValueError):
            self.repo.record_officer_decision(
                99992,
                "0x1C5Ab81cf1221e6aa08129f9632801965D6b261F",
                "RESOLVE_ACCEPTABLE",
                ""  # Empty reason should revert
            )


if __name__ == "__main__":
    unittest.main()
