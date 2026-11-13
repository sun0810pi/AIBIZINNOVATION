"""Accounting imports (Excel / CSV / MISA layout / Google Sheets link) and the Excel export."""

import io

import pytest

from api.main import create_app
from integrations.importer import Integrations, google_sheet_csv_url, read_table
from scripts.run_demo_story import StoryClock
from tests.authed import RoleClient
from ui.backend_real import RealBackend


@pytest.fixture
def backend(tmp_path):
    return RealBackend(runtime_dir=tmp_path, clock=StoryClock())


@pytest.fixture
def client(backend, tmp_path):
    return RoleClient(create_app(lambda: backend, dist_dir=tmp_path / "no-dist"))


def test_misa_layout_is_detected_and_bad_rows_are_held_back():
    i = Integrations()
    name, data = i.sample("misa_so_cong_no_mau.xlsx")
    p = i.stage(read_table(name, data), name, "misa", [])
    assert p["header_row"] == 3 and p["mapping"]["outstanding"] == "Số còn phải thu"
    assert p["counts"]["errors"] == 2 and p["counts"]["new"] == 5
    with pytest.raises(ValueError):
        i.commit(p["batch_id"], "lan", skip_errors=False)  # all or nothing by default
    assert i.invoices() == []
    p = i.stage(read_table(name, data), name, "misa", [])
    assert i.commit(p["batch_id"], "lan", skip_errors=True)["applied"] == 5


def test_vietnamese_numbers_and_google_links():
    rows = [["Số hóa đơn", "Tên khách hàng", "Hạn thanh toán", "Số tiền"], ["HD1", "A", "05/11/2026", "1.250.000,50"]]
    p = Integrations().stage(rows, "x", "excel", [])
    assert p["rows"][0]["amount"] == 1250000.5 and p["rows"][0]["due_date"] == "2026-11-05"
    assert google_sheet_csv_url("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=42").endswith("format=csv&gid=42")
    with pytest.raises(ValueError):
        google_sheet_csv_url("https://evil.example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz")


def test_google_sheet_import_with_a_fake_network(backend):
    class Resp(io.BytesIO):
        headers = {"Content-Type": "text/csv"}
        def __enter__(self): return self
        def __exit__(self, *a): return False
    body = "Invoice No,Customer,Due date,Amount\nGS-1,Sheet Buyer,2026-11-01,1000\n".encode()
    p = backend.int_preview_gsheet("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit", opener=lambda req, timeout: Resp(body))
    assert p["counts"]["new"] == 1 and p["kind"] == "gsheet"


def test_api_flow_misa_sync_twice_then_mo_asks_about_imported_invoices(client):
    p = client.post("/api/integrations/misa/sync").json()
    assert client.post("/api/integrations/commit", json={"batch_id": p["batch_id"], "skip_errors": True}).json()["applied"] == 5
    again = client.post("/api/integrations/misa/sync").json()
    assert again["counts"]["changed"] == 1  # a partial payment since the first sync
    ids = [q["subject_id"] for q in client.get("/api/updates/checkin").json()["questions"]]
    status = client.get("/api/integrations/status").json()
    assert status["imported_invoices"] == 5 and "misa" in status["last_sync"]
    assert any(i.startswith("HD") for i in ids) or len(ids) == 4
    x = client.get("/api/integrations/export/forecast.xlsx")
    assert x.status_code == 200 and x.content[:2] == b"PK"
    # the Director can read the export but not import
    assert client.post("/api/integrations/misa/sync", headers=client.header("sme.minh")).status_code == 403
