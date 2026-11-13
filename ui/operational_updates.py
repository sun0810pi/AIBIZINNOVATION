"""Operational updates collected by the assistant (Mo the otter) in chat.

Feedback for Monetra: important facts (a buyer promising a new payment date, a dispute, a purchase deposit that is
not yet in the books) arrive by phone, chat or email rather than through the ledger. Sales or procurement should be
able to report them in a few taps, and finance should review them before they touch the forecast.

Rules kept here, deliberately boring:
* An update is only ever *proposed* (``PENDING_REVIEW``). Nothing in this module changes the forecast, the ledger,
  or a contractual due date. An accepted update records the reviewed *expected* date; the contractual due date stays.
* The reviewer must be a different person from the author (segregation of duties).
* Free text is parsed with plain rules, no model. If the invoice or the date cannot be resolved the parser says what is
  missing instead of guessing. Relative dates ("next Friday") are resolved against an explicit message date only.
"""

from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

CHANGE_TYPES = ("ON_TIME", "PAYMENT_PROMISE", "PAYMENT_DELAY", "DISPUTE", "UNKNOWN", "PURCHASE_COMMITMENT", "HIRING_PLAN")
STATUSES = ("PENDING_REVIEW", "ACCEPTED", "REJECTED")
MAX_NOTE = 500
MAX_TEXT = 1000
CHECKIN_WINDOW_DAYS = 28
CHECKIN_LIMIT = 5

_INV = re.compile(r"\bINV[-\s]?(\d{3,6})\b", re.IGNORECASE)
_DMY = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b")
_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
_LATE = re.compile(r"(?:trễ|tre|chậm|cham|late|delay(?:ed)?)\D{0,12}(\d{1,3})\s*(?:ngày|ngay|days?|d)\b", re.IGNORECASE)
_LATE_REV = re.compile(r"(\d{1,3})\s*(?:ngày|ngay|days?)\s*(?:trễ|tre|chậm|cham|late)", re.IGNORECASE)
_WEEKDAYS = {
    # Vietnamese "thứ 2".."thứ 7", "chủ nhật"; English names. Monday = 0.
    "thứ 2": 0, "thu 2": 0, "thứ hai": 0, "monday": 0,
    "thứ 3": 1, "thu 3": 1, "thứ ba": 1, "tuesday": 1,
    "thứ 4": 2, "thu 4": 2, "thứ tư": 2, "wednesday": 2,
    "thứ 5": 3, "thu 5": 3, "thứ năm": 3, "thursday": 3,
    "thứ 6": 4, "thu 6": 4, "thứ sáu": 4, "friday": 4,
    "thứ 7": 5, "thu 7": 5, "thứ bảy": 5, "saturday": 5,
    "chủ nhật": 6, "chu nhat": 6, "sunday": 6,
}
_NEXT_WEEK = ("tuần sau", "tuan sau", "next week")
_DISPUTE = ("tranh chấp", "tranh chap", "khiếu nại", "khieu nai", "dispute", "complain")
_ON_TIME = ("đúng hạn", "dung han", "on time", "as agreed")


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


def _parse_date(value: Any) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as error:
        raise ValueError("Dates must be YYYY-MM-DD") from error


class OperationalUpdates:
    """In-memory store for one demo tenant. A real deployment persists this with the audit chain."""

    def __init__(self) -> None:
        self._items: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------ read
    def reset(self) -> None:
        self._items.clear()

    def list(self) -> List[Dict[str, Any]]:
        return [dict(x) for x in reversed(self._items)]

    def pending_for(self, subject_id: str) -> Optional[Dict[str, Any]]:
        for item in reversed(self._items):
            if item["subject_id"] == subject_id and item["status"] == "PENDING_REVIEW":
                return item
        return None

    def checkin(self, invoices: Iterable[Dict[str, Any]], buyer_risk: Iterable[Dict[str, Any]],
                as_of: Optional[str]) -> Dict[str, Any]:
        """Pick the few open invoices most worth asking about: due soon, from buyers that pay late most often,
        and with no update already waiting for review."""
        today = _parse_date(as_of) or _today()
        p_on_time = {r.get("buyer"): r.get("p_on_time") for r in buyer_risk}
        late_days = {r.get("buyer"): r.get("avg_days_late") for r in buyer_risk}
        candidates = []
        for inv in invoices:
            due = _parse_date(inv.get("due_date"))
            if not due or inv.get("status") not in {"ELIGIBLE", "VERIFIED", "FLAGGED"}:
                continue
            if not (today - timedelta(days=7) <= due <= today + timedelta(days=CHECKIN_WINDOW_DAYS)):
                continue
            if self.pending_for(inv["invoice_id"]):
                continue
            p = p_on_time.get(inv.get("buyer"))
            # no payment history (e.g. a customer that just arrived from an accounting import) is worth asking about
            candidates.append((0.6 if p is None else float(p), due, inv, p))
        candidates.sort(key=lambda x: (x[0], x[1]))
        questions = []
        for _, due, inv, p in candidates[:CHECKIN_LIMIT]:
            questions.append({
                "subject_id": inv["invoice_id"],
                "buyer": inv.get("buyer"),
                "amount": inv.get("amount"),
                "currency": inv.get("currency"),
                "due_date": _iso(due),
                "days_to_due": (due - today).days,
                "p_on_time": p,
                "avg_days_late": late_days.get(inv.get("buyer")),
                "why": "No payment history for this customer yet" if p is None
                       else "Due soon and this buyer has a lower on-time record" if p < 0.8
                       else "Due soon; no recent update on file",
            })
        return {"as_of": _iso(today), "questions": questions,
                "pending_count": sum(1 for x in self._items if x["status"] == "PENDING_REVIEW"),
                "rule": "Updates are proposals. Finance reviews them before the forecast uses them."}

    # ------------------------------------------------------------------ parse
    def parse(self, text: str, invoices: Iterable[Dict[str, Any]], message_date: Optional[str]) -> Dict[str, Any]:
        """Turn one chat message into a draft update, or say what is missing. Never invents an invoice or date."""
        text = (text or "").strip()
        if not text:
            raise ValueError("Write what the customer or supplier said")
        if len(text) > MAX_TEXT:
            raise ValueError(f"Keep a message under {MAX_TEXT} characters")
        known = {inv["invoice_id"].upper(): inv for inv in invoices if inv.get("invoice_id")}
        low = text.lower()
        missing: List[str] = []

        ids = ["INV-" + m.group(1) for m in _INV.finditer(text)]
        ids = list(dict.fromkeys(ids))
        invoice = None
        if not ids:
            missing.append("invoice")
        elif len(ids) > 1:
            missing.append("one_invoice")
        elif ids[0].upper() not in known:
            missing.append("known_invoice")
        else:
            invoice = known[ids[0].upper()]

        change_type = None
        if any(k in low for k in _DISPUTE):
            change_type = "DISPUTE"
        elif any(k in low for k in _ON_TIME):
            change_type = "ON_TIME"

        anchor = _parse_date(message_date) if message_date else None
        proposed: Optional[date] = None
        delay_days: Optional[int] = None
        m = _ISO.search(text)
        if m:
            proposed = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        else:
            m = _DMY.search(text)
            if m and not _INV.search(m.group(0)):
                day, month = int(m.group(1)), int(m.group(2))
                year_txt = m.group(3)
                if year_txt:
                    year = int(year_txt) + (2000 if len(year_txt) == 2 else 0)
                elif anchor:
                    year = anchor.year if (month, day) >= (anchor.month, anchor.day) else anchor.year + 1
                else:
                    year = None
                if year is None:
                    missing.append("year_or_message_date")
                else:
                    try:
                        proposed = date(year, month, day)
                    except ValueError:
                        missing.append("valid_date")
        if proposed is None:
            lm = _LATE.search(text) or _LATE_REV.search(text)
            if lm:
                delay_days = int(lm.group(1))
        if proposed is None and delay_days is None:
            for name, wd in _WEEKDAYS.items():
                if name in low:
                    if not anchor:
                        missing.append("message_date")
                        break
                    ahead = (wd - anchor.weekday()) % 7 or 7
                    if any(k in low for k in _NEXT_WEEK):
                        ahead += 7 if ahead < 7 else 0
                    proposed = anchor + timedelta(days=ahead)
                    break

        if invoice and delay_days is not None:
            proposed = _parse_date(invoice.get("due_date")) + timedelta(days=delay_days)
        if change_type is None:
            if proposed is not None and invoice:
                change_type = "PAYMENT_DELAY" if proposed > _parse_date(invoice.get("due_date")) else "PAYMENT_PROMISE"
            elif "message_date" not in missing and "year_or_message_date" not in missing:
                missing.append("date_or_status")

        draft = None
        if invoice and change_type:
            draft = {"subject_id": invoice["invoice_id"], "buyer": invoice.get("buyer"),
                     "amount": invoice.get("amount"), "currency": invoice.get("currency"),
                     "due_date": invoice.get("due_date"), "change_type": change_type,
                     "proposed_date": _iso(proposed), "note": text[:MAX_NOTE]}
        return {"draft": draft, "missing": missing, "ids_found": ids, "method": "rules-no-llm",
                "rule": "Drafts are checked by you before sending, then by finance before the forecast uses them."}

    # ------------------------------------------------------------------ write
    def submit(self, body: Dict[str, Any], author: str, invoices: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        change_type = str(body.get("change_type") or "").upper()
        if change_type not in CHANGE_TYPES:
            raise ValueError("Unknown update type")
        note = str(body.get("note") or "").strip()[:MAX_NOTE]
        proposed = _parse_date(body.get("proposed_date"))
        item: Dict[str, Any] = {
            "update_id": "UPD-" + secrets.token_hex(3).upper(),
            "change_type": change_type, "note": note, "author": author,
            "source": "assistant_chat", "status": "PENDING_REVIEW",
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "reviewed_by": None, "reviewed_at": None, "review_note": None,
            "applies_to_forecast": False,
        }
        if change_type == "HIRING_PLAN":
            amount = body.get("amount_vnd")
            if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
                raise ValueError("A hiring plan needs its monthly cost in whole VND")
            if proposed is None:
                raise ValueError("A hiring plan needs the first start date")
            if any(x["change_type"] == "HIRING_PLAN" and x["status"] == "PENDING_REVIEW" for x in self._items):
                raise ValueError("A hiring plan is already waiting for finance review")
            item.update({"subject_id": "HIRING-PLAN", "counterparty": str(body.get("counterparty") or "Recruitment plan")[:150],
                         "amount_vnd": amount, "currency": "VND", "proposed_date": _iso(proposed), "contractual_due_date": None})
        elif change_type == "PURCHASE_COMMITMENT":
            amount = body.get("amount_vnd")
            if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
                raise ValueError("A purchase needs a whole, positive amount in VND")
            if amount > 1_000_000_000_000:
                raise ValueError("Amount is out of range; check the number of zeros")
            if proposed is None:
                raise ValueError("A purchase needs the date the cash leaves")
            supplier = str(body.get("counterparty") or "").strip()[:150]
            if not supplier:
                raise ValueError("Name the supplier")
            item.update({"subject_id": "NEW-PURCHASE", "counterparty": supplier, "amount_vnd": amount,
                         "currency": "VND", "proposed_date": _iso(proposed), "contractual_due_date": None})
        else:
            known = {inv["invoice_id"]: inv for inv in invoices}
            subject = str(body.get("subject_id") or "")
            inv = known.get(subject)
            if inv is None:
                raise LookupError(f"Invoice {subject or '(none)'} is not in the current records")
            if change_type in ("PAYMENT_PROMISE", "PAYMENT_DELAY") and proposed is None:
                raise ValueError("Give the date the customer said they will pay")
            if change_type in ("ON_TIME", "DISPUTE", "UNKNOWN"):
                proposed = None if change_type != "ON_TIME" else _parse_date(inv.get("due_date"))
            if change_type == "DISPUTE" and not note:
                raise ValueError("Say briefly what is disputed so finance can follow up")
            if self.pending_for(subject):
                raise ValueError(f"{subject} already has an update waiting for review")
            item.update({"subject_id": subject, "counterparty": inv.get("buyer"), "amount": inv.get("amount"),
                         "currency": inv.get("currency"), "contractual_due_date": inv.get("due_date"),
                         "proposed_date": _iso(proposed)})
        self._items.append(item)
        return dict(item)

    def review(self, update_id: str, accept: bool, reviewer: str, note: str = "") -> Dict[str, Any]:
        for item in self._items:
            if item["update_id"] == update_id:
                break
        else:
            raise LookupError(f"Update {update_id} not found")
        if item["status"] != "PENDING_REVIEW":
            raise ValueError(f"{update_id} was already reviewed")
        if reviewer == item["author"]:
            raise ValueError("Segregation of duties: the author cannot review their own update")
        item.update({"status": "ACCEPTED" if accept else "REJECTED", "reviewed_by": reviewer,
                     "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "review_note": str(note or "")[:MAX_NOTE],
                     # Accepted means finance may use it as an assumption; the contractual due date never changes.
                     "applies_to_forecast": bool(accept)})
        return dict(item)
