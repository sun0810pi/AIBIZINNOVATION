"""HR: CV reading, a master CV sheet, explainable scoring against open positions, salary guidance,
a recruitment budget and a draft employment contract.

Design rules, same as the rest of Monetra:
* Deterministic and explainable. Every score lists the skills it matched and the ones that are missing.
  Nothing is hidden in a model; a reviewer can disagree with any line.
* The salary figure is a *range inside an internal band* (synthetic, set by the company), not market data.
* The budget only becomes a cash-flow assumption after finance reviews it (it is sent as an operational update).
* The contract is a draft. Legal checks block obvious breaches of the Labour Code 2019
  (Art. 25 probation length, Art. 26 probation pay >= 85%), but HR / legal must still review it.
* All people in the sample data are SYNTHETIC.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "data" / "sandbox_inputs" / "hr_cvs"
MAX_CVS = 200

# Labour Code 2019, Art. 25: maximum probation by the qualification the job needs.
PROBATION_MAX_DAYS = {"manager": 180, "college": 60, "intermediate": 30, "other": 6}
PROBATION_MIN_PAY_PCT = 85  # Art. 26

# Employer-side statutory contributions and hiring costs are company assumptions, editable, and shown as such.
ASSUMPTIONS = {
    "employer_contrib_pct": 21.5,  # social, health and unemployment insurance (employer share); verify each year
    "recruiting_cost_per_hire_vnd": 3_000_000,  # job ads and interviews, per hire
    "months_in_first_year": 12,
}

# ------------------------------------------------------------------ positions the company needs (SYNTHETIC)
OPENINGS: List[Dict[str, Any]] = [
    {"id": "OP-AR", "title": "Kế toán công nợ", "title_en": "Accounts receivable accountant", "department": "fin",
     "needed": 1, "filled": 0, "level": "college", "min_years": 2, "start": "2026-12-01",
     "band_vnd": [13_000_000, 19_000_000],
     "must": ["accounts_receivable", "misa", "excel"], "nice": ["e_invoice", "vat", "english"]},
    {"id": "OP-SALES", "title": "Nhân viên kinh doanh B2B", "title_en": "B2B sales executive", "department": "sales",
     "needed": 2, "filled": 0, "level": "college", "min_years": 1, "start": "2026-12-15",
     "band_vnd": [11_000_000, 17_000_000],
     "must": ["b2b", "negotiation", "crm"], "nice": ["customer_care", "export", "english"]},
    {"id": "OP-WH", "title": "Thủ kho", "title_en": "Warehouse keeper", "department": "ops",
     "needed": 1, "filled": 0, "level": "intermediate", "min_years": 2, "start": "2027-01-02",
     "band_vnd": [9_000_000, 14_000_000],
     "must": ["warehouse", "stock_control", "excel"], "nice": ["wms", "forklift", "5s"]},
]

# Skill dictionary: id -> (label, phrases). Phrases are matched without accents, so "kế toán" == "ke toan".
SKILLS: Dict[str, Tuple[str, List[str]]] = {
    "accounts_receivable": ("Kế toán công nợ", ["ke toan cong no", "cong no phai thu", "doi chieu cong no", "accounts receivable", "ar accountant"]),
    "misa": ("MISA", ["misa"]),
    "excel": ("Excel", ["excel"]),
    "e_invoice": ("Hoá đơn điện tử", ["hoa don dien tu", "e-invoice", "einvoice"]),
    "vat": ("Thuế GTGT / VAT", ["vat", "thue gtgt"]),
    "english": ("Tiếng Anh", ["tieng anh", "english", "ielts", "toeic"]),
    "b2b": ("Kinh doanh B2B", ["b2b"]),
    "negotiation": ("Đàm phán", ["dam phan", "negotiation", "negotiate"]),
    "crm": ("CRM", ["crm", "hubspot", "salesforce"]),
    "customer_care": ("Chăm sóc khách hàng", ["cham soc khach hang", "customer care", "customer service", "key account"]),
    "export": ("Xuất khẩu", ["xuat khau", "export"]),
    "warehouse": ("Quản lý kho", ["quan ly kho", "thu kho", "warehouse"]),
    "stock_control": ("Nhập xuất tồn / kiểm kê", ["nhap xuat ton", "kiem ke", "stock control", "inventory"]),
    "wms": ("Phần mềm WMS", ["wms"]),
    "forklift": ("Xe nâng", ["xe nang", "forklift"]),
    "5s": ("5S", ["5s"]),
}

EDU_RANK = {"other": 0, "intermediate": 1, "college": 2, "university": 3}
EDU_PATTERNS = [
    ("university", ["dai hoc", "cu nhan", "bachelor", "university", "thac si", "master"]),
    ("college", ["cao dang", "college"]),
    ("intermediate", ["trung cap", "vocational"]),
]


def fold(text: str) -> str:
    """Lower case, no Vietnamese accents (đ -> d), single spaces: for matching only."""
    text = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", text)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _round_500k(v: float) -> int:
    return int(round(v / 500_000) * 500_000)


# ------------------------------------------------------------------ CV parsing
def parse_cv(text: str, source: str = "paste", method: str = "text") -> Dict[str, Any]:
    raw = (text or "").strip()
    if len(raw) < 40:
        raise ValueError("This does not look like a CV: too little text was read")
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    f = fold(raw)
    missing: List[str] = []

    name = None
    m = re.search(r"(?:họ (?:và )?tên|full name|name)\s*[:\-]\s*(.+)", raw, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
    elif lines and len(lines[0]) <= 60 and not re.search(r"@|\d{4}", lines[0]):
        name = lines[0]
    if name:
        name = re.sub(r"\s+", " ", name).strip(" -|")
    else:
        missing.append("name")

    email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", raw) or [None])[0]
    phone_m = re.search(r"(?:\+?84|0)(?:[\s.]?\d){8,10}", raw)
    phone = re.sub(r"[\s.]", "", phone_m.group(0)) if phone_m else None
    if not email and not phone:
        missing.append("contact")

    headline = lines[1] if len(lines) > 1 and len(lines[1]) <= 60 and "@" not in lines[1] else None

    years = None
    m = re.search(r"(\d{1,2})\s*(?:\+\s*)?(?:nam kinh nghiem|years? of experience|years? experience)", f)
    if m:
        years = int(m.group(1))
    else:
        spans = re.findall(r"(20\d{2}|19\d{2})\s*[-–]\s*(20\d{2}|19\d{2}|nay|present|hien tai)", f)
        if spans:
            this_year = date.today().year
            starts = [int(a) for a, _ in spans]
            ends = [this_year if not b.isdigit() else int(b) for _, b in spans]
            years = max(0, max(ends) - min(starts))
    if years is None:
        missing.append("experience")

    education = "other"
    for level, keys in EDU_PATTERNS:
        if any(k in f for k in keys):
            education = level
            break

    skills = [sid for sid, (_, phrases) in SKILLS.items() if any(re.search(r"(?<![a-z0-9])" + re.escape(p) + r"(?![a-z0-9])", f) for p in phrases)]

    expected = None
    m = re.search(r"(?:luong mong muon|muc luong mong muon|expected salary|salary expectation)\s*[:\-]?\s*([\d.,]+)\s*(trieu|tr|m|million|vnd|d)?", f)
    if m:
        num = m.group(1).replace(",", "").replace(".", "")
        try:
            v = float(num)
            unit = m.group(2) or ""
            if unit in ("trieu", "tr", "m", "million") or v < 1000:
                v *= 1_000_000
            expected = int(v)
        except ValueError:
            pass

    return {
        "cv_id": "CV-" + secrets.token_hex(3).upper(),
        "name": name, "headline": headline, "email": email, "phone": phone,
        "years": years, "education": education, "skills": skills, "expected_salary_vnd": expected,
        "source": source, "method": method, "added_at": _now(), "missing": missing,
        "text_chars": len(raw),
    }


# ------------------------------------------------------------------ scoring and salary
def score(cv: Dict[str, Any], op: Dict[str, Any]) -> Dict[str, Any]:
    have = set(cv.get("skills") or [])
    must, nice = op["must"], op["nice"]
    must_hit = [s for s in must if s in have]
    nice_hit = [s for s in nice if s in have]
    years = cv.get("years") or 0
    parts = {
        "must": round(50 * len(must_hit) / len(must), 1) if must else 50.0,
        "nice": round(15 * len(nice_hit) / len(nice), 1) if nice else 15.0,
        "experience": round(20 * min(1.0, years / (op["min_years"] + 5)), 1),
        "education": 10.0 if EDU_RANK.get(cv.get("education", "other"), 0) >= EDU_RANK.get(op["level"], 0) else 0.0,
        "complete": 5.0 if not cv.get("missing") else 0.0,
    }
    total = round(sum(parts.values()))
    verdict = "interview" if total >= 75 and len(must_hit) == len(must) else "consider" if total >= 55 else "not_fit"
    flags = []
    if years < op["min_years"]:
        flags.append("below_min_experience")
    if len(must_hit) < len(must):
        flags.append("missing_must_have")
    return {"opening_id": op["id"], "score": total, "parts": parts, "verdict": verdict, "flags": flags,
            "matched": [SKILLS[s][0] for s in must_hit + nice_hit],
            "missing": [SKILLS[s][0] for s in must if s not in have]}


def salary_guidance(cv: Dict[str, Any], op: Dict[str, Any], fit: Dict[str, Any]) -> Dict[str, Any]:
    low, high = op["band_vnd"]
    years = cv.get("years") or 0
    exp_pos = min(1.0, max(0.0, (years - op["min_years"]) / 6))
    fit_pos = min(1.0, max(0.0, (fit["score"] - 55) / 45))
    point = low + (high - low) * (0.6 * exp_pos + 0.4 * fit_pos)
    rec = {"low": _round_500k(max(low, point * 0.95)), "high": _round_500k(min(high, point * 1.05)), "point": _round_500k(point)}
    expected = cv.get("expected_salary_vnd")
    note = None
    if expected:
        if expected > high:
            note = "above_band"   # needs the Director's approval or a different level
        elif expected < low:
            note = "below_band"
        elif expected > rec["high"]:
            note = "above_recommendation"
        else:
            note = "within"
    return {"band": [low, high], "recommended": rec, "expected": expected, "expected_vs_band": note,
            "basis": "internal band (synthetic) adjusted for experience and fit; not market data"}


# ------------------------------------------------------------------ store
class Recruiting:
    def __init__(self) -> None:
        self._cvs: List[Dict[str, Any]] = []
        self.reset()

    def reset(self) -> None:
        self._cvs = []
        if SAMPLE_DIR.exists():
            for path in sorted(SAMPLE_DIR.glob("*.txt")):
                cv = parse_cv(path.read_text(encoding="utf-8"), source=path.name, method="sample")
                self._cvs.append(cv)

    def add(self, text: str, source: str, method: str) -> Dict[str, Any]:
        if len(self._cvs) >= MAX_CVS:
            raise ValueError(f"The CV sheet is full ({MAX_CVS}); remove old CVs first")
        cv = parse_cv(text, source=source[:120], method=method)
        if cv.get("email") and any(c.get("email") == cv["email"] for c in self._cvs):
            raise ValueError(f"A CV with {cv['email']} is already in the sheet")
        self._cvs.append(cv)
        return self.view_cv(cv)

    def remove(self, cv_id: str) -> None:
        before = len(self._cvs)
        self._cvs = [c for c in self._cvs if c["cv_id"] != cv_id]
        if len(self._cvs) == before:
            raise LookupError(f"CV {cv_id} not found")

    def find(self, cv_id: str) -> Dict[str, Any]:
        for c in self._cvs:
            if c["cv_id"] == cv_id:
                return c
        raise LookupError(f"CV {cv_id} not found")

    @staticmethod
    def opening(op_id: str) -> Dict[str, Any]:
        for op in OPENINGS:
            if op["id"] == op_id:
                return op
        raise LookupError(f"Position {op_id} not found")

    def view_cv(self, cv: Dict[str, Any], mask: bool = False) -> Dict[str, Any]:
        fits = sorted((score(cv, op) for op in OPENINGS), key=lambda x: -x["score"])
        best = fits[0]
        op = self.opening(best["opening_id"])
        out = dict(cv, fits=fits, best=best, salary=salary_guidance(cv, op, best),
                   skill_labels=[SKILLS[s][0] for s in cv.get("skills", [])])
        if mask:  # the Director reviews hiring, but does not need personal contact details
            out["email"] = (cv["email"][:2] + "•••@" + cv["email"].split("@")[1]) if cv.get("email") else None
            out["phone"] = ("•••" + cv["phone"][-3:]) if cv.get("phone") else None
        return out

    def overview(self, mask: bool = False) -> Dict[str, Any]:
        cvs = [self.view_cv(c, mask) for c in self._cvs]
        cvs.sort(key=lambda c: -c["best"]["score"])
        openings = []
        for op in OPENINGS:
            ranked = sorted(((c, next(f for f in c["fits"] if f["opening_id"] == op["id"])) for c in cvs), key=lambda x: -x[1]["score"])
            shortlist = [{"cv_id": c["cv_id"], "name": c["name"], "score": f["score"], "verdict": f["verdict"], "missing": f["missing"]}
                         for c, f in ranked if f["verdict"] != "not_fit"]
            gap = op["needed"] - op["filled"]
            openings.append(dict(op, gap=gap, must_labels=[SKILLS[s][0] for s in op["must"]],
                                 nice_labels=[SKILLS[s][0] for s in op["nice"]], shortlist=shortlist,
                                 covered=min(gap, sum(1 for s in shortlist if s["verdict"] == "interview")),
                                 probation_max_days=PROBATION_MAX_DAYS[op["level"]]))
        return {"openings": openings, "cvs": cvs, "budget": self.budget(cvs), "assumptions": ASSUMPTIONS,
                "synthetic": True}

    def budget(self, cvs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        cvs = cvs if cvs is not None else [self.view_cv(c) for c in self._cvs]
        contrib = ASSUMPTIONS["employer_contrib_pct"] / 100
        rows, monthly_total, year_total, one_off_total = [], 0, 0, 0
        for op in OPENINGS:
            gap = op["needed"] - op["filled"]
            if gap <= 0:
                continue
            picks = sorted((c for c in cvs if c["best"]["opening_id"] == op["id"] and c["best"]["verdict"] != "not_fit"),
                           key=lambda c: -c["best"]["score"])[:gap]
            salaries = [c["salary"]["recommended"]["point"] for c in picks]
            mid = _round_500k(sum(op["band_vnd"]) / 2)
            salaries += [mid] * (gap - len(salaries))  # unfilled seats use the band midpoint
            gross = sum(salaries)
            monthly = int(round(gross * (1 + contrib)))
            start = date.fromisoformat(op["start"])
            months = ASSUMPTIONS["months_in_first_year"]
            one_off = ASSUMPTIONS["recruiting_cost_per_hire_vnd"] * gap
            rows.append({"opening_id": op["id"], "title": op["title"], "title_en": op["title_en"], "seats": gap,
                         "from_candidates": len(picks), "gross_monthly_vnd": gross, "monthly_cost_vnd": monthly,
                         "first_year_vnd": monthly * months + one_off, "one_off_vnd": one_off, "start": op["start"],
                         "start_month": start.strftime("%m/%Y")})
            monthly_total += monthly
            year_total += monthly * months + one_off
            one_off_total += one_off
        return {"rows": rows, "monthly_vnd": monthly_total, "first_year_vnd": year_total, "one_off_vnd": one_off_total,
                "earliest_start": min((r["start"] for r in rows), default=None),
                "basis": f"recommended salaries + {ASSUMPTIONS['employer_contrib_pct']}% employer contributions (assumption) "
                         f"+ {ASSUMPTIONS['recruiting_cost_per_hire_vnd']:,} VND recruiting cost per hire"}

    # -------------------------------------------------------------- export (opens in Google Sheets / Excel)
    COLUMNS = [("cv_id", "Mã CV"), ("name", "Họ tên"), ("headline", "Vị trí hiện tại"), ("best_title", "Vị trí phù hợp nhất"),
               ("score", "Điểm (0-100)"), ("verdict", "Đánh giá"), ("matched", "Kỹ năng khớp"), ("missing_skills", "Còn thiếu"),
               ("years", "Năm kinh nghiệm"), ("education", "Học vấn"), ("expected", "Lương mong muốn (VND)"),
               ("rec_low", "Lương đề xuất từ"), ("rec_high", "Lương đề xuất đến"), ("salary_note", "So với khung"),
               ("email", "Email"), ("phone", "Điện thoại"), ("source", "Nguồn"), ("method", "Cách đọc")]
    VERDICT_VI = {"interview": "Phỏng vấn ngay", "consider": "Cân nhắc", "not_fit": "Chưa phù hợp"}
    NOTE_VI = {"within": "Trong khung", "above_recommendation": "Cao hơn đề xuất", "above_band": "Vượt khung", "below_band": "Dưới khung", None: ""}

    def rows(self, mask: bool = False) -> List[List[Any]]:
        out = []
        for c in self.overview(mask)["cvs"]:
            op = self.opening(c["best"]["opening_id"])
            rec = c["salary"]["recommended"]
            vals = {"cv_id": c["cv_id"], "name": c["name"], "headline": c["headline"], "best_title": op["title"],
                    "score": c["best"]["score"], "verdict": self.VERDICT_VI[c["best"]["verdict"]],
                    "matched": ", ".join(c["best"]["matched"]), "missing_skills": ", ".join(c["best"]["missing"]),
                    "years": c["years"], "education": c["education"], "expected": c["expected_salary_vnd"],
                    "rec_low": rec["low"], "rec_high": rec["high"], "salary_note": self.NOTE_VI.get(c["salary"]["expected_vs_band"], ""),
                    "email": c["email"], "phone": c["phone"], "source": c["source"], "method": c["method"]}
            # a leading = + - @ would run as a formula in a spreadsheet: neutralise it
            out.append([("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v for v in (vals[k] for k, _ in self.COLUMNS)])
        return out

    def csv_bytes(self, mask: bool = False) -> bytes:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([h for _, h in self.COLUMNS])
        w.writerows(self.rows(mask))
        return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM so Excel / Google Sheets read Vietnamese correctly

    def xlsx_bytes(self, mask: bool = False) -> bytes:
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Alignment, Font, PatternFill
        except ImportError as exc:
            raise ValueError("Excel export is not installed on this server; download the CSV (opens in Google Sheets)") from exc
        wb = Workbook()
        ws = wb.active
        ws.title = "HR master CV"
        ws.append([h for _, h in self.COLUMNS])
        for r in self.rows(mask):
            ws.append(r)
        head = PatternFill("solid", fgColor="0B4F36")
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        widths = [10, 24, 22, 24, 10, 16, 36, 28, 10, 12, 16, 16, 16, 16, 30, 14, 26, 12]
        for i, wdt in enumerate(widths, start=1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = wdt
        for row in ws.iter_rows(min_row=2, min_col=11, max_col=13):
            for cell in row:
                cell.number_format = "#,##0"
        ws.freeze_panes = "C2"
        ws.auto_filter.ref = ws.dimensions
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # -------------------------------------------------------------- contract draft
    def contract(self, body: Dict[str, Any]) -> Dict[str, Any]:
        cv = self.find(str(body.get("cv_id") or ""))
        op = self.opening(str(body.get("opening_id") or cv and self.view_cv(cv)["best"]["opening_id"]))
        start = date.fromisoformat(str(body.get("start_date") or op["start"]))
        salary = body.get("salary_vnd")
        if not isinstance(salary, int) or isinstance(salary, bool) or salary <= 0:
            raise ValueError("Salary must be a whole, positive amount in VND")
        probation_days = int(body.get("probation_days") if body.get("probation_days") is not None else PROBATION_MAX_DAYS[op["level"]])
        probation_pct = int(body.get("probation_pct") if body.get("probation_pct") is not None else 85)
        term = int(body.get("term_months") or 12)
        limit = PROBATION_MAX_DAYS[op["level"]]
        problems = []
        if probation_days < 0 or probation_days > limit:
            problems.append(f"Probation of {probation_days} days exceeds the {limit}-day limit for this job (Labour Code 2019, Art. 25)")
        if probation_pct < PROBATION_MIN_PAY_PCT or probation_pct > 100:
            problems.append(f"Probation pay must be {PROBATION_MIN_PAY_PCT}% to 100% of the salary (Labour Code 2019, Art. 26)")
        if term not in (0, 12, 24, 36):
            problems.append("Contract term must be 12, 24 or 36 months, or 0 for an indefinite-term contract")
        if salary > op["band_vnd"][1]:
            problems.append("Salary is above the internal band: the Director must approve it first")
        if problems:
            raise ValueError("; ".join(problems))
        name = cv.get("name") or "(họ tên)"
        prob_salary = _round_500k(salary * probation_pct / 100)
        term_txt = "Hợp đồng lao động không xác định thời hạn" if term == 0 else f"Hợp đồng lao động xác định thời hạn {term} tháng"
        fmt = lambda v: f"{v:,}".replace(",", ".") + " đồng"
        sections = [
            ("CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", "Độc lập - Tự do - Hạnh phúc"),
            ("HỢP ĐỒNG LAO ĐỘNG (BẢN NHÁP)", f"Số: HĐLĐ-{cv['cv_id']}  ·  Lập ngày {date.today().strftime('%d/%m/%Y')}"),
            ("Bên A: Người sử dụng lao động", "Công ty TNHH Binh Duong Timberworks (DỮ LIỆU GIẢ LẬP)\nĐại diện: Trần Văn Minh, Giám đốc"),
            ("Bên B: Người lao động", f"Họ tên: {name}\nEmail: {cv.get('email') or '…'}\nĐiện thoại: {cv.get('phone') or '…'}\nSố CCCD, ngày sinh, địa chỉ: (HR bổ sung khi ký)"),
            ("Điều 1. Loại hợp đồng và công việc", f"{term_txt}, bắt đầu từ ngày {start.strftime('%d/%m/%Y')}.\nChức danh: {op['title']}.\nĐịa điểm làm việc: trụ sở công ty tại Bình Dương."),
            ("Điều 2. Thử việc", f"Thời gian thử việc: {probation_days} ngày (tối đa {limit} ngày theo Điều 25 Bộ luật Lao động 2019).\n"
                                 f"Lương thử việc: {fmt(prob_salary)}/tháng, bằng {probation_pct}% mức lương chính thức (tối thiểu 85% theo Điều 26)."),
            ("Điều 3. Tiền lương", f"Mức lương chính thức: {fmt(salary)}/tháng, trả bằng chuyển khoản vào ngày 05 hằng tháng.\nPhụ cấp và thưởng: theo quy chế công ty."),
            ("Điều 4. Thời giờ làm việc", "8 giờ/ngày, không quá 48 giờ/tuần; làm thêm giờ theo quy định pháp luật."),
            ("Điều 5. Bảo hiểm và phúc lợi", "Bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp theo quy định hiện hành sau thời gian thử việc."),
            ("Điều 6. Điều khoản chung", "Các nội dung khác thực hiện theo Bộ luật Lao động 2019, nội quy lao động và thoả ước của công ty."),
            ("Lưu ý", "Đây là bản nháp do hệ thống tạo từ dữ liệu CV đã đọc. HR và bộ phận pháp chế phải kiểm tra, bổ sung thông tin cá nhân "
                      "và đối chiếu quy định hiện hành trước khi ký. Không phải tư vấn pháp lý."),
        ]
        return {"cv_id": cv["cv_id"], "opening_id": op["id"], "sections": sections,
                "text": "\n\n".join(f"{h}\n{b}" for h, b in sections),
                "checks": [f"Probation {probation_days}/{limit} days (Art. 25)", f"Probation pay {probation_pct}% >= 85% (Art. 26)",
                           f"Salary {'within' if salary <= op['band_vnd'][1] else 'above'} the internal band"]}

    def contract_docx(self, body: Dict[str, Any]) -> bytes:
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Pt
        draft = self.contract(body)
        doc = Document()
        style = doc.styles["Normal"]
        style.font.name = "Times New Roman"
        style.font.size = Pt(12)
        for i, (head, body_text) in enumerate(draft["sections"]):
            if i < 2:
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                r = p.add_run(head)
                r.bold = True
                r.font.size = Pt(14 if i == 1 else 12)
                p2 = doc.add_paragraph(body_text)
                p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
                continue
            h = doc.add_paragraph()
            h.add_run(head).bold = True
            for line in body_text.split("\n"):
                doc.add_paragraph(line)
        doc.add_paragraph()
        sig = doc.add_table(rows=2, cols=2)
        sig.cell(0, 0).text, sig.cell(0, 1).text = "NGƯỜI LAO ĐỘNG", "NGƯỜI SỬ DỤNG LAO ĐỘNG"
        sig.cell(1, 0).text, sig.cell(1, 1).text = "(Ký, ghi rõ họ tên)", "(Ký, đóng dấu)"
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()


def extract_cv_file(filename: str, data: bytes) -> Dict[str, Any]:
    """TXT / PDF / image via the shared bounded extractor (local OCR, Vietnamese + English), DOCX via python-docx."""
    name = (filename or "").lower()
    if name.endswith(".docx"):
        if not data or len(data) > 5_000_000:
            raise ValueError("File must be 1 byte to 5 MB")
        try:
            from docx import Document
            doc = Document(io.BytesIO(data))
        except Exception as exc:
            raise ValueError("This DOCX file could not be read") from exc
        text = "\n".join(p.text for p in doc.paragraphs)
        for t in doc.tables:
            for row in t.rows:
                text += "\n" + " | ".join(c.text for c in row.cells)
        return {"text": text, "method": "docx-text"}
    from contracts.extraction import extract_upload
    out = extract_upload(filename, data, lang="vie+eng")
    return {"text": out["text"], "method": out["method"]}
