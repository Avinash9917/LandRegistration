"""
Phase 6: Document OCR Cross-Verification Service
Handles multi-document structured field extraction, per-field confidence scoring,
AES-256 GCM PII encryption, fuzzy cross-document consistency auditing, and officer decision persistence.
"""

import os
import json
import re
import math
import datetime
from difflib import SequenceMatcher
from typing import Dict, List, Any, Optional, Tuple

try:
    from .crypto_utils import encrypt_aadhaar, decrypt_aadhaar
except ImportError:
    from crypto_utils import encrypt_aadhaar, decrypt_aadhaar

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "state_document_config.json"
)

# Known Limitations:
# 1. Complex ancestral joint-pattas with multiple co-owners require manual verification of heir shares.
# 2. Historical survey resurvey conversion numbers (e.g. Old Sy No vs New Sy No) require officer manual override.
# 3. OCR character substitutions in regional fonts (e.g., Tamil/Kannada script ligatures) may lower raw confidence.


class OCRService:
    """
    Core OCR extraction and cross-document verification engine.
    """

    def __init__(self, config_path: str = CONFIG_PATH):
        self.config = self._load_config(config_path)
        self.default_state = self.config.get("default_state", "Tamil Nadu")
        self.high_confidence_min = float(
            self.config.get("confidence_thresholds", {}).get("high_confidence_min", 80.0)
        )
        self.fuzzy_min_ratio = float(
            self.config.get("confidence_thresholds", {}).get("fuzzy_match_min_ratio", 0.85)
        )

    def _load_config(self, path: str) -> dict:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {
            "default_state": "Tamil Nadu",
            "confidence_thresholds": {"high_confidence_min": 80.0, "fuzzy_match_min_ratio": 0.85},
            "states": {}
        }

    def get_supported_states(self) -> List[str]:
        return list(self.config.get("states", {}).keys())

    def get_document_config_for_state(self, state: Optional[str] = None) -> dict:
        state_key = state or self.default_state
        return self.config.get("states", {}).get(state_key, {})

    # ==========================================
    # NORMALIZATION & FUZZY MATCHING HELPERS
    # ==========================================

    @staticmethod
    def normalize_text(val: Any) -> str:
        """Strips titles, punctuation, extra whitespace, and standardizes casing."""
        if not val:
            return ""
        text = str(val).strip().lower()
        # Remove common honorifics / titles
        text = re.sub(r"\b(mr|mrs|smt|ms|dr|thiru|thirumathi|shri|late)\b\.?", "", text, flags=re.IGNORECASE)
        # Remove punctuation except alphanumeric and forward slash for survey numbers
        text = re.sub(r"[^a-z0-9/]", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def normalize_survey_number(val: Any) -> str:
        """Standardizes survey number representations: 'Sy. No 1001/2A' -> '1001/2a'."""
        if not val:
            return ""
        text = str(val).strip().lower()
        # Remove common prefixes like 'survey reference', 'survey no', 'sy. no', 's.no', 'sy', 'no', etc.
        text = re.sub(r"\b(survey\s*reference|survey\s*number|survey\s*no|sy\s*no|s\.no|rsno|r\.s\.no|khasra|gat|survey|reference|ref|sy|sno|no)\b\.?", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"[\s\-_:\.]", "", text)
        return text

    @staticmethod
    def normalize_area(val: Any) -> Optional[float]:
        """Extracts numeric area in sq.ft / units."""
        if val is None:
            return None
        text = str(val).lower()
        match = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                return None
        return None

    def calculate_string_similarity(self, a: str, b: str) -> float:
        """Computes SequenceMatcher ratio between two normalized strings."""
        norm_a = self.normalize_text(a)
        norm_b = self.normalize_text(b)
        if not norm_a and not norm_b:
            return 1.0
        if not norm_a or not norm_b:
            return 0.0
        if norm_a == norm_b or norm_a in norm_b or norm_b in norm_a:
            return 1.0
        return SequenceMatcher(None, norm_a, norm_b).ratio()

    # ==========================================
    # STRUCTURED FIELD EXTRACTION
    # ==========================================

    def extract_document_fields(
        self,
        doc_type: str,
        raw_text_or_bytes: Any,
        state: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Extracts structured fields per document type with per-field confidence scores.
        Encrypts PII (Aadhaar, PAN) at rest using AES-256 GCM.
        Never logs raw text or raw PII.
        """
        text = ""
        if isinstance(raw_text_or_bytes, bytes):
            try:
                text = raw_text_or_bytes.decode("utf-8", errors="ignore")
            except Exception:
                text = str(raw_text_or_bytes)
        elif isinstance(raw_text_or_bytes, str):
            text = raw_text_or_bytes
        elif isinstance(raw_text_or_bytes, dict):
            return self._enrich_structured_input(doc_type, raw_text_or_bytes)

        extracted = {}
        confidence = {}

        if doc_type == "sale_deed":
            extracted, confidence = self._parse_sale_deed(text)
        elif doc_type == "previous_title_deed":
            extracted, confidence = self._parse_previous_title_deed(text)
        elif doc_type == "patta":
            extracted, confidence = self._parse_patta(text)
        elif doc_type == "encumbrance_certificate":
            extracted, confidence = self._parse_encumbrance_certificate(text)
        elif doc_type == "property_tax_receipt":
            extracted, confidence = self._parse_property_tax_receipt(text)
        else:
            extracted, confidence = self._parse_generic(text)

        # Protect PII at rest
        self._encrypt_pii_fields(extracted)

        return {
            "doc_type": doc_type,
            "fields": extracted,
            "confidence_scores": confidence,
            "average_confidence": round(sum(confidence.values()) / max(len(confidence), 1), 2),
            "extracted_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

    def _enrich_structured_input(self, doc_type: str, data: dict) -> Dict[str, Any]:
        """Helper to process and score directly supplied test dictionaries."""
        fields = dict(data.get("fields", data))
        confidence = dict(data.get("confidence_scores", {}))

        for k in fields.keys():
            if k not in confidence:
                confidence[k] = 95.0

        self._encrypt_pii_fields(fields)

        return {
            "doc_type": doc_type,
            "fields": fields,
            "confidence_scores": confidence,
            "average_confidence": round(sum(confidence.values()) / max(len(confidence), 1), 2),
            "extracted_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

    def _encrypt_pii_fields(self, fields: dict):
        """Encrypts Aadhaar and PAN fields at rest using AES-256 GCM."""
        if "aadhaar_number" in fields and fields["aadhaar_number"]:
            raw_aadhaar = str(fields["aadhaar_number"]).strip().replace(" ", "").replace("-", "")
            fields["encrypted_aadhaar"] = encrypt_aadhaar(raw_aadhaar)
            fields["aadhaar_masked"] = f"XXXX-XXXX-{raw_aadhaar[-4:]}" if len(raw_aadhaar) >= 4 else "XXXX"
            del fields["aadhaar_number"]

        if "pan_number" in fields and fields["pan_number"]:
            raw_pan = str(fields["pan_number"]).strip().upper()
            fields["encrypted_pan"] = encrypt_aadhaar(raw_pan)
            fields["pan_masked"] = f"{raw_pan[:2]}XXXXX{raw_pan[-2:]}" if len(raw_pan) >= 4 else "XXXX"
            del fields["pan_number"]

    def _parse_sale_deed(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}

        owner_m = re.search(r"(?:registered\s*owner|owner|vendor|seller|transferor)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|residing|buyer|purchaser|$)", text, re.IGNORECASE)
        if owner_m:
            fields["owner_name"] = owner_m.group(1).strip()
            conf["owner_name"] = 92.0

        buyer_m = re.search(r"(?:purchaser|buyer|transferee)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|resident|son\s*of|$)", text, re.IGNORECASE)
        if buyer_m:
            fields["buyer_name"] = buyer_m.group(1).strip()
            conf["buyer_name"] = 90.0

        sy_m = re.search(r"(?:survey\s*reference|survey\s*number|survey\s*no|sy\s*no|s\.no|survey|sy)[\s/:\.a-zA-Z]*?([0-9]+(?:\s*/\s*[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m and sy_m.group(1):
            fields["survey_number"] = sy_m.group(1).replace(" ", "").strip()
            conf["survey_number"] = 94.0

        area_m = re.search(r"(?:extent|area|plot\s*area)[\s/:]*([0-9,]+(?:\.[0-9]+)?)\s*(?:sq\.?\s*ft|sqft|cents|acres)", text, re.IGNORECASE)
        if area_m:
            fields["plot_area"] = area_m.group(1).replace(",", "").strip()
            conf["plot_area"] = 88.0

        date_m = re.search(r"(?:executed|dated|registered\s*on)[\s/:]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})", text, re.IGNORECASE)
        if date_m:
            fields["registration_date"] = date_m.group(1).strip()
            conf["registration_date"] = 91.0

        aadh_m = re.search(r"(?:aadhaar|uid)[\s:]*([0-9]{4}\s*[0-9]{4}\s*[0-9]{4})", text, re.IGNORECASE)
        if aadh_m:
            fields["aadhaar_number"] = aadh_m.group(1).replace(" ", "")
            conf["aadhaar_number"] = 96.0

        return fields, conf

    def _parse_previous_title_deed(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}

        prev_owner_m = re.search(r"(?:previous\s*owner|parent\s*owner|vendor|seller)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|$)", text, re.IGNORECASE)
        if prev_owner_m:
            fields["previous_owner"] = prev_owner_m.group(1).strip()
            conf["previous_owner"] = 89.0

        buyer_m = re.search(r"(?:purchaser|buyer|in\s*favour\s*of)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|$)", text, re.IGNORECASE)
        if buyer_m:
            fields["buyer_name"] = buyer_m.group(1).strip()
            conf["buyer_name"] = 87.0

        sy_m = re.search(r"(?:survey\s*reference|survey\s*number|survey\s*no|sy\s*no|s\.no|survey|sy)[\s/:\.a-zA-Z]*?([0-9]+(?:\s*/\s*[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m and sy_m.group(1):
            fields["survey_number"] = sy_m.group(1).replace(" ", "").strip()
            conf["survey_number"] = 91.0

        area_m = re.search(r"(?:extent|area|plot\s*area)[\s/:]*([0-9,]+(?:\.[0-9]+)?)\s*(?:sq\.?\s*ft|sqft|cents|acres)", text, re.IGNORECASE)
        if area_m:
            fields["plot_area"] = area_m.group(1).replace(",", "").strip()
            conf["plot_area"] = 85.0

        return fields, conf

    def _parse_patta(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}

        patta_no_m = re.search(r"(?:patta\s*no|patta\s*number|rtc\s*no|satbara\s*no|jamabandi\s*no)[\s/:\.]*([0-9]+[A-Za-z0-9]*)", text, re.IGNORECASE)
        if patta_no_m:
            fields["patta_number"] = patta_no_m.group(1).strip()
            conf["patta_number"] = 95.0

        owner_m = re.search(r"(?:landholder\s*name|landholder|owner|pattadhar|khatadar|khatedar)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|s/o|w/o|$)", text, re.IGNORECASE)
        if owner_m:
            fields["landholder_name"] = owner_m.group(1).strip()
            conf["landholder_name"] = 91.0

        sy_m = re.search(r"(?:survey\s*number|survey\s*no|sy\s*no|s\.no|survey)[\s/:\.]*([0-9]+(?:\s*/\s*[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m:
            fields["survey_number"] = sy_m.group(1).replace(" ", "").strip()
            conf["survey_number"] = 93.0

        area_m = re.search(r"(?:extent|area|total\s*area)[\s/:]*([0-9,]+(?:\.[0-9]+)?)\s*(?:sq\.?\s*ft|sqft|hectare|acres)", text, re.IGNORECASE)
        if area_m:
            fields["plot_area"] = area_m.group(1).replace(",", "").strip()
            conf["plot_area"] = 89.0

        return fields, conf

    def _parse_encumbrance_certificate(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}

        sy_m = re.search(r"(?:survey\s*no|sy\s*no|s\.no|survey)[\s/:\.]*([0-9]+(?:\s*/\s*[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m:
            fields["survey_number"] = sy_m.group(1).replace(" ", "").strip()
            conf["survey_number"] = 92.0

        period_m = re.search(r"(?:search\s*period|period)[\s/:]*([0-9]{2,4}[-/.][0-9]{2}[-/.][0-9]{2,4})\s*(?:to|-)\s*([0-9]{2,4}[-/.][0-9]{2}[-/.][0-9]{2,4})", text, re.IGNORECASE)
        if period_m:
            fields["period_from"] = period_m.group(1)
            fields["period_to"] = period_m.group(2)
            conf["period_from"] = 90.0
            conf["period_to"] = 90.0

        mortgage_m = re.search(r"(?:encumbrance\s*entries|encumbrance\s*search)[\s/:]*([A-Za-z0-9\s/]+?)(?:\n|\.|$)", text, re.IGNORECASE)
        if mortgage_m:
            fields["encumbrance_entries"] = mortgage_m.group(1).strip()
            conf["encumbrance_entries"] = 85.0
        else:
            nil_m = re.search(r"(?:nil|no\s*encumbrance|mortgage|charge|lien\s*in\s*favour\s*of)[\s:]*([A-Za-z0-9\s]+?)(?:\n|\.|$)", text, re.IGNORECASE)
            if nil_m:
                fields["encumbrance_entries"] = nil_m.group(0).strip()
                conf["encumbrance_entries"] = 85.0

        return fields, conf

    def _parse_property_tax_receipt(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}

        assess_m = re.search(r"(?:assessment\s*no|tax\s*id|bill\s*no|khata\s*no)[\s/:\.]*([0-9A-Za-z\-]+)", text, re.IGNORECASE)
        if assess_m:
            fields["assessment_number"] = assess_m.group(1).strip()
            conf["assessment_number"] = 93.0

        taxpayer_m = re.search(r"(?:taxpayer\s*name|taxpayer|owner|assessee|in\s*the\s*name\s*of)[\s/:]*([A-Za-z\s\.]+?)(?:,|\n|and|paid|$)", text, re.IGNORECASE)
        if taxpayer_m:
            fields["taxpayer_name"] = taxpayer_m.group(1).strip()
            conf["taxpayer_name"] = 88.0

        sy_m = re.search(r"(?:survey\s*no|sy\s*no|s\.no|survey)[\s/:\.]*([0-9]+(?:\s*/\s*[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m:
            fields["survey_number"] = sy_m.group(1).replace(" ", "").strip()
            conf["survey_number"] = 90.0

        amount_m = re.search(r"(?:amount\s*paid|paid\s*rs|tax\s*paid)[\s/:\.]*([0-9,]+(?:\.[0-9]+)?)", text, re.IGNORECASE)
        if amount_m:
            fields["paid_amount"] = amount_m.group(1).replace(",", "").strip()
            conf["paid_amount"] = 94.0

        return fields, conf

    def _parse_generic(self, text: str) -> Tuple[dict, dict]:
        fields = {}
        conf = {}
        sy_m = re.search(r"(?:survey\s*no|sy\s*no)[\s:\.]*([0-9]+(?:/[0-9]+[A-Za-z0-9]*)?)", text, re.IGNORECASE)
        if sy_m:
            fields["survey_number"] = sy_m.group(1).strip()
            conf["survey_number"] = 80.0
        return fields, conf

    # ==========================================
    # CROSS-DOCUMENT CONSISTENCY AUDIT
    # ==========================================

    def cross_verify_documents(
        self,
        property_record: dict,
        document_extractions: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Compares survey number, owner name, and area across all extracted documents and on-chain record.
        Flags:
          - Field Confidence >= 80% AND Mismatch -> "Risk Alert"
          - Field Confidence < 80% -> "Manual Review"
          - Consistent -> "Verified Consistent"
        """
        flags: List[Dict[str, Any]] = []
        field_comparisons: Dict[str, Any] = {
            "survey_number": {},
            "owner_name": {},
            "plot_area": {}
        }

        # 1. Base property record anchor
        base_survey = str(property_record.get("surveyNumberName") or property_record.get("surveyNumber") or "")
        alt_survey = str(property_record.get("surveyNumber") if property_record.get("surveyNumberName") else "")
        base_owner = str(property_record.get("ownerName") or (property_record.get("firstName", "") + " " + property_record.get("lastName", "")).strip() or property_record.get("owner", "")).strip()
        base_area = property_record.get("area")

        field_comparisons["survey_number"]["property_record"] = {
            "value": base_survey,
            "alt_value": alt_survey,
            "confidence": 100.0
        }
        field_comparisons["owner_name"]["property_record"] = {"value": base_owner, "confidence": 100.0}
        field_comparisons["plot_area"]["property_record"] = {"value": base_area, "confidence": 100.0}

        # 2. Gather extracted fields across docs
        for doc_key, doc_data in document_extractions.items():
            fields = doc_data.get("fields", {})
            conf_scores = doc_data.get("confidence_scores", {})

            # Survey Number
            if "survey_number" in fields:
                field_comparisons["survey_number"][doc_key] = {
                    "value": fields["survey_number"],
                    "confidence": float(conf_scores.get("survey_number", 80.0))
                }

            # Owner Name (handle varied field names like landholder_name, taxpayer_name)
            owner_val = fields.get("owner_name") or fields.get("landholder_name") or fields.get("taxpayer_name") or fields.get("buyer_name")
            if owner_val:
                conf_val = float(
                    conf_scores.get("owner_name")
                    or conf_scores.get("landholder_name")
                    or conf_scores.get("taxpayer_name")
                    or conf_scores.get("buyer_name")
                    or 80.0
                )
                field_comparisons["owner_name"][doc_key] = {
                    "value": owner_val,
                    "confidence": conf_val
                }

            # Plot Area
            if "plot_area" in fields:
                field_comparisons["plot_area"][doc_key] = {
                    "value": fields["plot_area"],
                    "confidence": float(conf_scores.get("plot_area", 80.0))
                }

        # 3. Check Survey Number Consistency
        self._audit_survey_numbers(field_comparisons["survey_number"], flags)

        # 4. Check Owner Name Consistency
        self._audit_owner_names(field_comparisons["owner_name"], flags)

        # 5. Check Plot Area Consistency
        self._audit_plot_areas(field_comparisons["plot_area"], flags)

        # Determine Overall Status
        has_risk_alert = any(f["flag_type"] == "Risk Alert" for f in flags)
        has_manual_review = any(f["flag_type"] == "Manual Review" for f in flags)

        if has_risk_alert:
            overall_status = "RISK_ALERT"
            is_unblocked = False
        elif has_manual_review:
            overall_status = "MANUAL_REVIEW"
            is_unblocked = False
        else:
            overall_status = "VERIFIED_CONSISTENT"
            is_unblocked = True

        return {
            "overall_status": overall_status,
            "is_unblocked": is_unblocked,
            "flags": flags,
            "field_comparisons": field_comparisons,
            "audited_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "summary": f"{len(flags)} issue(s) detected during document cross-verification." if flags else "All document fields are consistent with on-chain title records."
        }

    def _audit_survey_numbers(self, survey_dict: dict, flags: list):
        items = list(survey_dict.items())
        if len(items) < 2:
            return

        ref_key, ref_val = items[0]
        ref_norm = self.normalize_survey_number(ref_val["value"])
        alt_norm = self.normalize_survey_number(ref_val.get("alt_value", ""))

        for key, val in items[1:]:
            curr_val = val["value"]
            curr_conf = val["confidence"]
            curr_norm = self.normalize_survey_number(curr_val)

            if not curr_norm or not ref_norm:
                continue

            is_match = (
                ref_norm == curr_norm
                or curr_norm.startswith(ref_norm + "/")
                or ref_norm.startswith(curr_norm + "/")
                or (alt_norm and (alt_norm == curr_norm or curr_norm.startswith(alt_norm + "/") or alt_norm.startswith(curr_norm + "/")))
            )

            if not is_match:
                # Mismatch found
                if curr_conf >= self.high_confidence_min and ref_val["confidence"] >= self.high_confidence_min:
                    flags.append({
                        "field": "survey_number",
                        "flag_type": "Risk Alert",
                        "severity": "HIGH",
                        "doc_a": ref_key,
                        "value_a": ref_val["value"],
                        "doc_b": key,
                        "value_b": curr_val,
                        "confidence": curr_conf,
                        "message": f"Survey number mismatch between {ref_key} ('{ref_val['value']}') and {key} ('{curr_val}')."
                    })
                else:
                    flags.append({
                        "field": "survey_number",
                        "flag_type": "Manual Review",
                        "severity": "MEDIUM",
                        "doc_a": ref_key,
                        "value_a": ref_val["value"],
                        "doc_b": key,
                        "value_b": curr_val,
                        "confidence": curr_conf,
                        "message": f"Low-confidence survey number reading in {key} ('{curr_val}', {curr_conf}%). Manual review required."
                    })
            else:
                # Consistent values; but if confidence is low, flag for manual review
                if curr_conf < self.high_confidence_min:
                    flags.append({
                        "field": "survey_number",
                        "flag_type": "Manual Review",
                        "severity": "LOW",
                        "doc_a": ref_key,
                        "value_a": ref_val["value"],
                        "doc_b": key,
                        "value_b": curr_val,
                        "confidence": curr_conf,
                        "message": f"Survey number in {key} appears consistent but OCR confidence is {curr_conf}%. Manual check recommended."
                    })

    def _audit_owner_names(self, owner_dict: dict, flags: list):
        items = list(owner_dict.items())
        if len(items) < 2:
            return

        ref_key, ref_val = items[0]
        ref_name = str(ref_val["value"])

        for key, val in items[1:]:
            curr_name = str(val["value"])
            curr_conf = val["confidence"]

            if not curr_name or not ref_name:
                continue

            similarity = self.calculate_string_similarity(ref_name, curr_name)

            if similarity < self.fuzzy_min_ratio:
                # Genuine mismatch
                if curr_conf >= self.high_confidence_min and ref_val["confidence"] >= self.high_confidence_min:
                    flags.append({
                        "field": "owner_name",
                        "flag_type": "Risk Alert",
                        "severity": "HIGH",
                        "doc_a": ref_key,
                        "value_a": ref_name,
                        "doc_b": key,
                        "value_b": curr_name,
                        "confidence": curr_conf,
                        "similarity_score": round(similarity, 2),
                        "message": f"Owner name mismatch between {ref_key} ('{ref_name}') and {key} ('{curr_name}')."
                    })
                else:
                    flags.append({
                        "field": "owner_name",
                        "flag_type": "Manual Review",
                        "severity": "MEDIUM",
                        "doc_a": ref_key,
                        "value_a": ref_name,
                        "doc_b": key,
                        "value_b": curr_name,
                        "confidence": curr_conf,
                        "similarity_score": round(similarity, 2),
                        "message": f"Low-confidence owner name extraction in {key} ('{curr_name}', {curr_conf}%). Manual review required."
                    })
            else:
                if curr_conf < self.high_confidence_min:
                    flags.append({
                        "field": "owner_name",
                        "flag_type": "Manual Review",
                        "severity": "LOW",
                        "doc_a": ref_key,
                        "value_a": ref_name,
                        "doc_b": key,
                        "value_b": curr_name,
                        "confidence": curr_conf,
                        "similarity_score": round(similarity, 2),
                        "message": f"Owner name in {key} matches ('{curr_name}'), but OCR confidence is {curr_conf}%."
                    })

    def _audit_plot_areas(self, area_dict: dict, flags: list):
        items = list(area_dict.items())
        if len(items) < 2:
            return

        ref_key, ref_val = items[0]
        ref_area = self.normalize_area(ref_val["value"])

        if ref_area is None:
            return

        for key, val in items[1:]:
            curr_val = val["value"]
            curr_conf = val["confidence"]
            curr_area = self.normalize_area(curr_val)

            if curr_area is None:
                continue

            # Allow 5% tolerance for rounding / unit conversions
            if abs(curr_area - ref_area) / max(ref_area, 1.0) > 0.05:
                if curr_conf >= self.high_confidence_min:
                    flags.append({
                        "field": "plot_area",
                        "flag_type": "Risk Alert",
                        "severity": "MEDIUM",
                        "doc_a": ref_key,
                        "value_a": ref_val["value"],
                        "doc_b": key,
                        "value_b": curr_val,
                        "confidence": curr_conf,
                        "message": f"Plot area difference between {ref_key} ({ref_area} sq.ft) and {key} ({curr_area} sq.ft)."
                    })
                else:
                    flags.append({
                        "field": "plot_area",
                        "flag_type": "Manual Review",
                        "severity": "LOW",
                        "doc_a": ref_key,
                        "value_a": ref_val["value"],
                        "doc_b": key,
                        "value_b": curr_val,
                        "confidence": curr_conf,
                        "message": f"Low-confidence area reading in {key} ({curr_val}, {curr_conf}%)."
                    })


# ==========================================
# MONGODB AUDIT TRAIL REPOSITORY
# ==========================================

class PropertyOCRAuditRepository:
    """
    Manages persistence and retrieval of OCR extractions, audit flags,
    and mandatory officer review decisions in MongoDB.
    """

    def __init__(self, db_client):
        self.db = db_client.LandRegistry
        self.audit_col = self.db.Property_OCR_Audit

    def save_audit_result(self, property_id: int, audit_data: dict) -> dict:
        existing = self.audit_col.find_one({"propertyId": int(property_id)})
        latest_decision = existing.get("latest_decision") if existing else None

        if latest_decision:
            resolution_status = existing.get("resolution_status", audit_data.get("overall_status"))
            is_unblocked = (latest_decision.get("decision_type") == "RESOLVE_ACCEPTABLE")
        else:
            resolution_status = audit_data.get("overall_status")
            is_unblocked = audit_data.get("is_unblocked", False)

        doc = {
            "propertyId": int(property_id),
            "audit_data": audit_data,
            "overall_status": audit_data.get("overall_status"),
            "flags": audit_data.get("flags", []),
            "latest_decision": latest_decision,
            "resolution_status": resolution_status,
            "is_unblocked": is_unblocked,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        if existing and "decision_history" in existing:
            doc["decision_history"] = existing["decision_history"]

        self.audit_col.update_one(
            {"propertyId": int(property_id)},
            {"$set": doc},
            upsert=True
        )
        return doc

    def record_officer_decision(
        self,
        property_id: int,
        officer_wallet: str,
        decision_type: str,
        reason: str
    ) -> Dict[str, Any]:
        """
        Records one of the 3 officer review decisions:
        - RESOLVE_ACCEPTABLE: "Resolve — documents acceptable"
        - REQUEST_REUPLOAD: "Resolve — request re-upload"
        - ESCALATE: "Escalate to senior officer/admin"
        """
        valid_decisions = ["RESOLVE_ACCEPTABLE", "REQUEST_REUPLOAD", "ESCALATE"]
        if decision_type not in valid_decisions:
            raise ValueError(f"Invalid decision type. Must be one of {valid_decisions}")

        if not reason or not reason.strip():
            raise ValueError("A non-empty reason is mandatory for officer audit decision.")

        decision_record = {
            "officer_wallet": officer_wallet.lower(),
            "decision_type": decision_type,
            "reason": reason.strip(),
            "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        # Update resolution state
        new_status = (
            "OFFICER_APPROVED_ACCEPTABLE" if decision_type == "RESOLVE_ACCEPTABLE"
            else "OFFICER_REQUESTED_REUPLOAD" if decision_type == "REQUEST_REUPLOAD"
            else "OFFICER_ESCALATED"
        )

        self.audit_col.update_one(
            {"propertyId": int(property_id)},
            {
                "$set": {
                    "latest_decision": decision_record,
                    "resolution_status": new_status,
                    "is_unblocked": (decision_type == "RESOLVE_ACCEPTABLE")
                },
                "$push": {
                    "decision_history": decision_record
                }
            },
            upsert=True
        )
        return decision_record

    def get_audit_trail(self, property_id: int) -> Optional[dict]:
        record = self.audit_col.find_one({"propertyId": int(property_id)}, {"_id": 0})
        return record

    def is_verification_unblocked(self, property_id: int) -> Tuple[bool, str]:
        """
        Checks if property title verification is unblocked:
        - True if no flags (VERIFIED_CONSISTENT) OR officer recorded RESOLVE_ACCEPTABLE.
        - False if pending Risk Alert / Manual Review without acceptable officer resolution,
          or if officer requested re-upload / escalated.
        """
        record = self.get_audit_trail(property_id)
        if not record:
            # If not yet audited, treat as unblocked (fallback to standard oracle)
            return True, "No OCR audit record found"

        audit_data = record.get("audit_data", {})
        overall_status = record.get("overall_status")
        latest_decision = record.get("latest_decision")

        if latest_decision:
            if latest_decision.get("decision_type") == "RESOLVE_ACCEPTABLE":
                return True, f"Officer accepted documents: {latest_decision.get('reason')}"
            elif latest_decision.get("decision_type") == "REQUEST_REUPLOAD":
                return False, f"Blocked: Officer requested document re-upload ({latest_decision.get('reason')})"
            elif latest_decision.get("decision_type") == "ESCALATE":
                return False, f"Blocked: Escalated to senior officer/admin ({latest_decision.get('reason')})"

        if overall_status == "VERIFIED_CONSISTENT":
            return True, "All documents verified consistent"

        return False, f"Blocked by OCR {overall_status}. Officer review decision required."
