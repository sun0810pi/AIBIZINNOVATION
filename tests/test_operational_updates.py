"""Mo the assistant collects operational updates in chat; finance reviews them (feedback: 'Cập nhật và hành động của tôi')."""

import pytest

from api.main import create_app
from scripts.run_demo_story import StoryClock
from tests.authed import RoleClient
from ui.backend_real import RealBackend
from ui.operational_updates import OperationalUpdates

INVOICES = [
    {"invoice_id": "INV-1003", "buyer": "Oakline", "amount": 23480.0, "currency": "USD", "due_date": "2026-10-28", "status": "ELIGIBLE"},
    {"invoice_id": "INV-1002", "buyer": "Kyoto", "amount": 22737.0, "currency": "USD", "due_date": "2026-10-28", "status": "ELIGIBLE"},
    {"invoice_id": "INV-1099", "buyer": "Kyoto", "amount": 1.0, "currency": "USD", "due_date": "2027-03-01", "status": "ELIGIBLE"},
]
RISK = [{"buyer": "Oakline", "p_on_time": 0.49, "avg_days_late": 1.6}, {"buyer": "Kyoto", "p_on_time": 0.98, "avg_days_late": 0.4}]


@pytest.fixture
def backend(tmp_path):
    return RealBackend(runtime_dir=tmp_path, clock=StoryClock())


@pytest.fixture
def client(backend, tmp_path):
    return RoleClient(create_app(lambda: backend, dist_dir=tmp_path / "no-dist"))


def test_checkin_asks_about_risky_invoices_due_soon_first():
    out = OperationalUpdates().checkin(INVOICES, RISK, "2026-10-19")
    ids = [q["subject_id"] for q in out["questions"]]
    assert ids == ["INV-1003", "INV-1002"]  # far-future invoice left out; low on-time buyer first


def test_parse_resolves_delay_and_relative_dates_without_guessing():
    u = OperationalUpdates()
    d = u.parse("Oakline báo INV-1003 trễ 10 ngày", INVOICES, "2026-10-19")["draft"]
    assert d["change_type"] == "PAYMENT_DELAY" and d["proposed_date"] == "2026-11-07"
    d = u.parse("INV-1003 hẹn chuyển khoản 5/11", INVOICES, "2026-10-19")["draft"]
    assert d["proposed_date"] == "2026-11-05"
    d = u.parse("INV-1003 will pay Friday", INVOICES, "2026-10-19")["draft"]  # 19 Oct 2026 is a Monday
    assert d["proposed_date"] == "2026-10-23"
    missing = u.parse("khách hẹn thứ 6 trả", INVOICES, "2026-10-19")
    assert missing["draft"] is None and "invoice" in missing["missing"]
    unknown = u.parse("INV-7777 trễ 3 ngày", INVOICES, "2026-10-19")
    assert unknown["draft"] is None and "known_invoice" in unknown["missing"]


def test_submit_keeps_contractual_date_and_blocks_duplicates_and_self_review():
    u = OperationalUpdates()
    item = u.submit({"change_type": "PAYMENT_DELAY", "subject_id": "INV-1003", "proposed_date": "2026-11-07"}, "sales.a", INVOICES)
    assert item["status"] == "PENDING_REVIEW" and item["contractual_due_date"] == "2026-10-28"
    assert item["applies_to_forecast"] is False
    with pytest.raises(ValueError):
        u.submit({"change_type": "PAYMENT_DELAY", "subject_id": "INV-1003", "proposed_date": "2026-11-09"}, "sales.a", INVOICES)
    with pytest.raises(ValueError):
        u.review(item["update_id"], True, "sales.a")
    done = u.review(item["update_id"], True, "fin.b")
    assert done["status"] == "ACCEPTED" and done["contractual_due_date"] == "2026-10-28"


def test_purchase_commitment_needs_whole_vnd_amount_and_date():
    u = OperationalUpdates()
    with pytest.raises(ValueError):
        u.submit({"change_type": "PURCHASE_COMMITMENT", "counterparty": "NCC", "amount_vnd": 0, "proposed_date": "2026-11-01"}, "a", [])
    item = u.submit({"change_type": "PURCHASE_COMMITMENT", "counterparty": "NCC Bao Bì", "amount_vnd": 150_000_000,
                     "proposed_date": "2026-11-01"}, "a", [])
    assert item["currency"] == "VND" and item["status"] == "PENDING_REVIEW"


def test_api_flow_director_reports_accountant_reviews(client):
    director = client.header("sme.minh")
    q = client.get("/api/updates/checkin", headers=director).json()
    assert q["questions"], q
    subject = q["questions"][0]["subject_id"]
    r = client.post("/api/updates", headers=director,
                    json={"change_type": "PAYMENT_DELAY", "subject_id": subject, "proposed_date": "2026-12-31", "note": "phone call"})
    assert r.status_code == 200, r.text
    uid = r.json()["update_id"]
    # the Director has no finance-review permission
    assert client.post(f"/api/updates/{uid}/review", headers=director, json={"accept": True}).status_code == 403
    r = client.post(f"/api/updates/{uid}/review", json={"accept": True})  # sme.lan
    assert r.status_code == 200 and r.json()["status"] == "ACCEPTED"
    # the bank cannot see SME updates
    assert client.get("/api/updates/checkin", headers=client.header("bank.lihua")).status_code == 403


def _login(client, user):
    r = client.post("/api/auth/demo-login", json={"user_id": user})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_sales_reports_without_seeing_cash_and_only_sees_own_updates(client):
    sales = _login(client, "sme.hung")
    # no bank balance, forecast or funding for another department
    for path in ("/api/snapshot", "/api/analytics/summary", "/api/intelligence"):
        assert client.get(path, headers=sales).status_code == 403, path
    assert client.post("/api/ask_cfo", headers=sales, json={"text": "cash?"}).status_code == 403
    q = client.get("/api/updates/checkin", headers=sales).json()
    assert q["questions"]
    subject = q["questions"][0]["subject_id"]
    r = client.post("/api/updates", headers=sales, json={"change_type": "PAYMENT_DELAY", "subject_id": subject, "proposed_date": "2026-12-31"})
    assert r.status_code == 200, r.text
    # someone else's update is not visible to sales
    director = client.header("sme.minh")
    other = next(x["subject_id"] for x in q["questions"][1:])
    assert client.post("/api/updates", headers=director, json={"change_type": "UNKNOWN", "subject_id": other}).status_code == 200
    mine = client.get("/api/updates/checkin", headers=sales).json()["updates"]
    assert {u["author"] for u in mine} == {"sme.hung"}
    # sales cannot review; finance (accountant) can
    uid = r.json()["update_id"]
    assert client.post(f"/api/updates/{uid}/review", headers=sales, json={"accept": True}).status_code == 403
    assert client.post(f"/api/updates/{uid}/review", json={"accept": True}).json()["status"] == "ACCEPTED"


def test_purchasing_gets_no_invoice_questions_but_can_report_a_purchase(client):
    buyer = _login(client, "sme.mai")
    assert client.get("/api/updates/checkin", headers=buyer).json()["questions"] == []
    r = client.post("/api/updates", headers=buyer, json={"change_type": "PURCHASE_COMMITMENT", "counterparty": "Bao Bì Sài Gòn",
                                                         "amount_vnd": 150_000_000, "proposed_date": "2026-11-02", "note": "đặt cọc 30%"})
    assert r.status_code == 200 and r.json()["currency"] == "VND"
