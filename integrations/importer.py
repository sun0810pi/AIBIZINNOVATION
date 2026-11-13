"""Accounting data in and out: Excel / CSV files, accounting-software exports (MISA layout), Google Sheets links,
and a MISA sync that runs the same pipeline from a sandbox file.

Pipeline (feedback for Monetra, section 6F): upload or link -> detect columns -> validate -> compare with the
current ledger -> commit as one batch (all or nothing) -> available to the rest of the app.
A failed batch never changes what is already committed; every batch keeps its raw rows and mapping.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
import unicodedata
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "sandbox_inputs" / "integrations"
MAX_BYTES = 3_000_000
MAX_ROWS = 2000

FIELDS = ["invoice_id", "customer", "customer_code", "invoice_date", "due_date", "currency", "amount", "paid", "outstanding", "memo"]
SYNONYMS: Dict[str, List[str]] = {
    "invoice_id": ["so hoa don", "so hd", "invoice no", "invoice number", "invoice", "ma hoa don"],
    "customer": ["ten khach hang", "khach hang", "customer", "customer name", "ten doi tuong", "buyer"],
    "customer_code": ["ma khach hang", "ma doi tuong", "customer code", "customer id"],
    "invoice_date": ["ngay hoa don", "ngay chung tu", "invoice date", "ngay hach toan", "date"],
    "due_date": ["han thanh toan", "ngay den han", "due date", "han tt", "due"],
    "currency": ["loai tien", "currency", "tien te", "ccy"],
    "amount": ["so tien", "tong tien", "amount", "gia tri", "thanh tien", "total"],
    "paid": ["so da thu", "da thu", "paid", "received"],
    "outstanding": ["so con phai thu", "con phai thu", "outstanding", "balance", "con lai", "du no"],
    "memo": ["dien giai", "description", "memo", "noi dung"],
}
REQUIRED = ["invoice_id", "customer", "due_date", "amount"]


def fold(s: Any) -> str:
    s = unicodedata.normalize("NFD", str(s or "").replace("đ", "d").replace("Đ", "D"))
    return re.sub(r"\s+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn").lower()).strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------ reading tables
def read_table(filename: str, data: bytes) -> List[List[Any]]:
    if not data or len(data) > MAX_BYTES:
        raise ValueError("File must be 1 byte to 3 MB")
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)  # values only: formulas are never run
        except ImportError as exc:
            raise ValueError("Excel reading is not installed on this server; save the sheet as CSV") from exc
        except Exception as exc:
            raise ValueError("This Excel file could not be read") from exc
        ws = wb.worksheets[0]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        return rows
    if name.endswith((".csv", ".txt")) or not name:
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        return [row for row in csv.reader(io.StringIO(text), dialect)]
    raise ValueError("Upload an Excel (.xlsx) or CSV file")


def google_sheet_csv_url(link: str) -> str:
    m = re.match(r"https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]{20,})(?:/[^?#]*)?(?:[?#].*?gid=(\d+))?", (link or "").strip())
    if not m:
        raise ValueError("Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/…)")
    gid = m.group(2) or "0"
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv&gid={gid}"


def fetch_google_sheet(link: str, opener=None) -> bytes:
    url = google_sheet_csv_url(link)
    req = urllib.request.Request(url, headers={"User-Agent": "Monetra/1.0"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=12) as resp:
            body = resp.read(MAX_BYTES + 1)
            ctype = resp.headers.get("Content-Type", "") if hasattr(resp, "headers") else "text/csv"
    except Exception as exc:
        raise ValueError("Could not open the sheet. Set sharing to 'Anyone with the link can view' and try again") from exc
    if len(body) > MAX_BYTES:
        raise ValueError("The sheet is larger than 3 MB")
    if "html" in ctype.lower():
        raise ValueError("The sheet is private. Set sharing to 'Anyone with the link can view' and try again")
    return body


# ------------------------------------------------------------------ mapping and validation
def detect_header(rows: List[List[Any]]) -> Tuple[int, Dict[str, int]]:
    """Find the header row (it may sit under a title) and map our fields to its columns."""
    best = (-1, {})
    for i, row in enumerate(rows[:15]):
        cells = [fold(c) for c in row]
        mapping: Dict[str, int] = {}
        for field, names in SYNONYMS.items():
            for j, cell in enumerate(cells):
                if not cell or j in mapping.values():
                    continue
                if any(cell == n or cell.startswith(n) for n in names):
                    mapping[field] = j
                    break
        if len(mapping) > len(best[1]):
            best = (i, mapping)
    if best[0] < 0 or not all(f in best[1] for f in ("invoice_id", "amount")):
        raise ValueError("No invoice number / amount columns were found. Use the template or rename the headers")
    return best


def _date(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"'{s}' is not a date")


def _money(v: Any) -> Optional[float]:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):  # 1.234.567,5 (Vietnamese)
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError as exc:
        raise ValueError(f"'{v}' is not an amount") from exc


def normalise(rows: List[List[Any]], source: str, existing: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    if len(rows) > MAX_ROWS:
        raise ValueError(f"At most {MAX_ROWS} rows per import")
    head, mapping = detect_header(rows)
    known = {str(x.get("invoice_id")): x for x in existing}
    out, issues, seen = [], [], set()
    for n, raw in enumerate(rows[head + 1:], start=head + 2):
        if not any(c not in (None, "") for c in raw):
            continue
        get = lambda f: raw[mapping[f]] if f in mapping and mapping[f] < len(raw) else None  # noqa: E731
        rec: Dict[str, Any] = {"row": n}
        errs: List[str] = []
        inv = str(get("invoice_id") or "").strip()
        if not inv:
            errs.append("missing invoice number")
        rec["invoice_id"] = inv
        rec["customer"] = str(get("customer") or "").strip() or None
        if not rec["customer"]:
            errs.append("missing customer")
        rec["customer_code"] = str(get("customer_code") or "").strip() or None
        for f in ("invoice_date", "due_date"):
            try:
                rec[f] = _date(get(f))
            except ValueError as e:
                rec[f] = None
                errs.append(str(e))
        if not rec["due_date"] and "invalid" not in " ".join(errs):
            errs.append("missing due date") if not any("not a date" in e for e in errs) else None
        try:
            amount = _money(get("amount"))
            paid = _money(get("paid")) or 0.0
            outstanding = _money(get("outstanding"))
        except ValueError as e:
            amount, paid, outstanding = None, 0.0, None
            errs.append(str(e))
        if amount is None:
            errs.append("missing amount") if not any("amount" in e for e in errs) else None
        elif amount < 0:
            errs.append("negative amount")
        if outstanding is None and amount is not None:
            outstanding = amount - paid
        if amount is not None and outstanding is not None and outstanding > amount + 0.5:
            errs.append("outstanding is larger than the invoice")
        rec.update(amount=amount, paid=paid, outstanding=outstanding,
                   currency=(str(get("currency") or "VND").strip().upper() or "VND"), memo=str(get("memo") or "").strip() or None)
        if inv and inv in seen:
            errs.append("duplicate of an earlier row")
        seen.add(inv)
        if errs:
            issues.append({"row": n, "invoice_id": inv or "—", "errors": errs})
            rec["status"] = "ERROR"
        elif inv in known:
            k = known[inv]
            same = abs(float(k.get("outstanding", k.get("amount", 0)) or 0) - float(outstanding or 0)) < 0.5 and k.get("due_date") == rec["due_date"]
            rec["status"] = "UNCHANGED" if same else "CHANGED"
            rec["was"] = {"due_date": k.get("due_date"), "outstanding": k.get("outstanding", k.get("amount"))}
        else:
            rec["status"] = "NEW"
        out.append(rec)
    good = [r for r in out if r["status"] != "ERROR"]
    by_ccy: Dict[str, float] = {}
    for r in good:
        by_ccy[r["currency"]] = by_ccy.get(r["currency"], 0.0) + float(r["outstanding"] or 0)
    return {"source": source, "header_row": head + 1,
            "mapping": {f: (str(rows[head][j]) if j < len(rows[head]) else "") for f, j in mapping.items()},
            "unmapped_required": [f for f in REQUIRED if f not in mapping],
            "rows": out, "issues": issues,
            "counts": {"total": len(out), "new": sum(r["status"] == "NEW" for r in out), "changed": sum(r["status"] == "CHANGED" for r in out),
                       "unchanged": sum(r["status"] == "UNCHANGED" for r in out), "errors": len(issues)},
            "control_totals": by_ccy}


# ------------------------------------------------------------------ store (batches, all-or-nothing commit)
class Integrations:
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._staged: Dict[str, Dict[str, Any]] = {}
        self._batches: List[Dict[str, Any]] = []
        self._ledger: Dict[str, Dict[str, Any]] = {}
        self._syncs: Dict[str, str] = {}

    def invoices(self) -> List[Dict[str, Any]]:
        return list(self._ledger.values())

    def stage(self, rows: List[List[Any]], source: str, kind: str, existing: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        merged = {str(x.get("invoice_id")): x for x in existing}
        merged.update(self._ledger)
        preview = normalise(rows, source, merged.values())
        batch_id = "IMP-" + secrets.token_hex(3).upper()
        preview.update(batch_id=batch_id, kind=kind, staged_at=_now())
        self._staged = {batch_id: preview}  # one open preview at a time
        return preview

    def commit(self, batch_id: str, actor: str, skip_errors: bool) -> Dict[str, Any]:
        batch = self._staged.get(batch_id)
        if not batch:
            raise LookupError("This preview has expired. Upload the file again")
        if batch["issues"] and not skip_errors:
            raise ValueError(f"{len(batch['issues'])} row(s) have errors. Fix the file, or import only the valid rows")
        applied = 0
        for r in batch["rows"]:
            if r["status"] in ("NEW", "CHANGED"):
                self._ledger[r["invoice_id"]] = {
                    "invoice_id": r["invoice_id"], "buyer": r["customer"], "customer_code": r["customer_code"],
                    "amount": r["outstanding"], "invoice_amount": r["amount"], "currency": r["currency"],
                    "due_date": r["due_date"], "status": "ELIGIBLE", "source": batch["source"], "batch_id": batch_id,
                }
                applied += 1
        record = {k: batch[k] for k in ("batch_id", "source", "kind", "counts", "control_totals", "mapping")}
        record.update(committed_at=_now(), committed_by=actor, applied=applied, skipped_errors=len(batch["issues"]) if skip_errors else 0)
        self._batches.append(record)
        if batch["kind"] in ("misa", "gsheet", "excel"):
            self._syncs[batch["kind"]] = record["committed_at"]
        del self._staged[batch_id]
        return record

    def status(self) -> Dict[str, Any]:
        return {"batches": list(reversed(self._batches))[:20], "imported_invoices": len(self._ledger), "last_sync": dict(self._syncs),
                "templates": [p.name for p in sorted(SAMPLES.glob("*"))] if SAMPLES.exists() else []}

    @staticmethod
    def sample(name: str) -> Tuple[str, bytes]:
        path = (SAMPLES / name).resolve()
        if path.parent != SAMPLES.resolve() or not path.exists():
            raise LookupError("Sample not found")
        return path.name, path.read_bytes()


# ------------------------------------------------------------------ Excel export of the forecast and decision
def forecast_xlsx(snapshot: Dict[str, Any]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    head = PatternFill("solid", fgColor="0B4F36")

    def sheet(ws, header: List[str], rows: List[List[Any]], widths: List[int]):
        ws.append(header)
        for c in ws[1]:
            c.font, c.fill = Font(bold=True, color="FFFFFF"), head
        for r in rows:
            ws.append([("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v for v in r])
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = w
        ws.freeze_panes = "A2"

    ws = wb.active
    ws.title = "13-week forecast"
    weeks = snapshot["forecast"]["weeks"]
    sheet(ws, ["Week", "Start", "Opening (USD)", "Inflows", "Outflows", "Closing", "Status"],
          [[w["week"], w["start_date"], w["opening"], w["inflows"], w["outflows"], w["closing"], w["status"]] for w in weeks], [8, 12, 15, 14, 14, 14, 10])
    for row in ws.iter_rows(min_row=2, min_col=3, max_col=6):
        for c in row:
            c.number_format = "#,##0.00"
    ws2 = wb.create_sheet("Funding options")
    sheet(ws2, ["Rank", "Option", "Amount (USD)", "APR %", "Total cost (USD)", "Eligible", "Why not"],
          [[o.get("rank"), o.get("name"), o.get("amount_usd"), o.get("apr_pct"), (o.get("cost_breakdown") or {}).get("total_usd"), o.get("eligible"), o.get("ineligible_reason")]
           for o in snapshot.get("funding_options", [])], [6, 46, 14, 8, 16, 9, 40])
    ws3 = wb.create_sheet("Receivables")
    sheet(ws3, ["Invoice", "Customer", "Amount", "Currency", "Due date", "Status"],
          [[v.get("invoice_id"), v.get("buyer"), v.get("amount"), v.get("currency"), v.get("due_date"), v.get("status")] for v in snapshot.get("verification", [])],
          [12, 44, 14, 9, 12, 12])
    ws4 = wb.create_sheet("About")
    k = snapshot["kpis"]
    for line in [["Monetra export", snapshot["meta"]["company"]], ["As of", snapshot["meta"]["as_of"]], ["Cash today (USD)", k["cash_today_usd"]],
                 ["First short week", k["first_shortfall_week"]], ["Shortfall (USD)", k["shortfall_usd"]], ["FX note", snapshot["meta"]["fx_note"]],
                 ["Source", "Same calculation snapshot the app shows; recompute in the app, not in this file"]]:
        ws4.append(line)
    ws4.column_dimensions["A"].width, ws4.column_dimensions["B"].width = 22, 70
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
