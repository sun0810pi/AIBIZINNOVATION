"""HR: CV reading, scoring, salary guidance, budget hand-off to finance, and contract legal checks."""

from pathlib import Path

import pytest

from api.main import create_app
from hr.recruiting import Recruiting, fold, parse_cv
from scripts.run_demo_story import StoryClock
from tests.authed import RoleClient
from ui.backend_real import RealBackend

UPLOADS = Path(__file__).resolve().parent.parent / "data" / "sandbox_inputs" / "hr_cv_uploads"


@pytest.fixture
def backend(tmp_path):
    return RealBackend(runtime_dir=tmp_path, clock=StoryClock())


@pytest.fixture
def client(backend, tmp_path):
    return RoleClient(create_app(lambda: backend, dist_dir=tmp_path / "no-dist"))


def _login(client, user):
    r = client.post("/api/auth/demo-login", json={"user_id": user})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_accent_insensitive_matching_and_parsing():
    assert fold("Kế toán Công Nợ, Đàm phán") == "ke toan cong no, dam phan"
    cv = parse_cv("NGUYEN VAN A\nSales\nEmail: a@example.com\n3 năm kinh nghiệm\nKỹ năng: B2B, đàm phán, CRM\nMức lương mong muốn: 15 triệu")
    assert cv["years"] == 3 and cv["expected_salary_vnd"] == 15_000_000
    assert {"b2b", "negotiation", "crm"} <= set(cv["skills"])


def test_scores_explain_missing_skills_and_salary_flags():
    o = Recruiting().overview()
    by = {c["name"].split(" (")[0]: c for c in o["cvs"]}
    long_ = by["ĐẶNG HOÀNG LONG"]
    assert "CRM" in long_["best"]["missing"] and long_["best"]["verdict"] == "consider"
    assert long_["salary"]["expected_vs_band"] == "above_band"  # wants 18m, band tops at 17m
    assert by["LÊ THỊ HOA"]["best"]["verdict"] == "not_fit"
    assert all(op["gap"] >= 1 for op in o["openings"])


def test_contract_blocks_labour_code_breaches():
    r = Recruiting()
    cv = r.overview()["cvs"][0]
    op = cv["best"]["opening_id"]
    with pytest.raises(ValueError, match="Art. 26"):
        r.contract({"cv_id": cv["cv_id"], "opening_id": op, "salary_vnd": 13_000_000, "probation_pct": 80})
    with pytest.raises(ValueError, match="Art. 25"):
        r.contract({"cv_id": cv["cv_id"], "opening_id": op, "salary_vnd": 13_000_000, "probation_days": 90})
    ok = r.contract({"cv_id": cv["cv_id"], "opening_id": op, "salary_vnd": 13_000_000})
    assert "Điều 2. Thử việc" in ok["text"] and "85%" in ok["text"]
    assert r.contract_docx({"cv_id": cv["cv_id"], "opening_id": op, "salary_vnd": 13_000_000})[:2] == b"PK"


def test_csv_export_neutralises_spreadsheet_formulas():
    r = Recruiting()
    text = '=HYPERLINK("http://x")\nKe toan\nEmail: x@example.com\n2 nam kinh nghiem\nKy nang: MISA, Excel, ke toan cong no'
    r.add(text, "p", "text")
    data = r.csv_bytes().decode("utf-8-sig")
    assert "'=HYPERLINK" in data and "\n=HYPERLINK" not in data and ",=HYPERLINK" not in data


def test_hr_flow_through_the_api(client):
    hr = _login(client, "sme.ha")
    o = client.get("/api/hr/overview", headers=hr).json()
    assert o["cvs"][0]["email"] and "•••" not in o["cvs"][0]["email"]
    # OCR a scanned CV (local Tesseract) when it is installed on this machine
    png = (UPLOADS / "cv_scan_bui_thi_ngoc.png").read_bytes()
    r = client.post("/api/hr/cvs/upload", headers=hr, files={"file": ("cv_scan.png", png, "image/png")})
    if r.status_code == 200:
        assert r.json()["best"]["opening_id"] == "OP-AR"
    else:
        assert "OCR" in r.json()["detail"]
    assert client.get("/api/hr/cvs.csv", headers=hr).content.startswith("﻿".encode())
    # budget goes to finance as a reviewable update
    plan = client.post("/api/hr/budget/submit", headers=hr)
    assert plan.status_code == 200 and plan.json()["change_type"] == "HIRING_PLAN"
    assert client.post(f"/api/updates/{plan.json()['update_id']}/review", json={"accept": True}).json()["status"] == "ACCEPTED"
    # the Director sees scores but not contact details; HR pages are closed to sales and to the bank
    d = client.get("/api/hr/overview", headers=client.header("sme.minh")).json()
    assert "•••" in d["cvs"][0]["email"]
    assert client.get("/api/hr/overview", headers=_login(client, "sme.hung")).status_code == 403
    assert client.get("/api/hr/overview", headers=client.header("bank.lihua")).status_code == 403
    assert client.get("/api/snapshot", headers=hr).status_code == 403  # HR sees no bank balances
