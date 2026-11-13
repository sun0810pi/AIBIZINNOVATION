# Đối chiếu Monetra với file "Feedback for Monetra"

Ngày kiểm: 13/11/2026 · Cách kiểm: đọc mã nguồn, chạy API + giao diện thật, chạy toàn bộ test (`pytest -m "not e2e and not slow"`: pass).

Ký hiệu: ✅ đạt · 🟡 một phần · ❌ chưa có · 🆕 vừa làm trong đợt này

## 1. Những thứ feedback bảo GIỮ và làm tốt hơn

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Dự báo dòng tiền 13 tuần | 🟡 | Có, nhưng theo **tuần**; spec R1 muốn chi tiết theo **ngày** |
| So sánh phương án (mua ngay / mua ít hơn / hoãn) | 🟡 | Có mô phỏng kịch bản và planner, nhưng xoay quanh vay/factoring, chưa có luồng "quyết định mua hàng" |
| Liên kết nguồn gốc từng con số | ✅ | `/api/provenance`, bảng bằng chứng |
| Kiểm soát phê duyệt + nhật ký thay đổi | 🟡 | OTP + audit chain tốt. Chưa gắn phê duyệt với **phiên bản**, chưa có trạng thái `APPROVED_CONDITIONAL` / `REVALIDATION_REQUIRED` |
| Giải thích hậu quả tài chính rõ ràng | ✅ | Trợ lý CFO + explainer, có trích nguồn |

## 2. Những thứ feedback bảo THÊM trước tiên

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Nhập dữ liệu kế toán CSV/XLSX có kiểm tra, đối chiếu, commit nguyên tử | ❌ | Chỉ có data-gate / quality check; chưa có luồng tải lên → ánh xạ → xác thực → đối chiếu → commit |
| Lịch thu khách hàng + lịch trả nhà cung cấp đầy đủ | 🟡 | AR có; AP có trong engine nhưng chưa thành lịch riêng trên giao diện |
| Khoản mua / đặt cọc dự kiến chưa vào sổ | 🟡 🆕 | **Mo** cho báo khoản mua mới (VND, ngày chi, ghi chú đặt cọc) dưới dạng đề xuất chờ duyệt. Chưa đẩy vào engine dự báo |
| Cập nhật thanh toán của khách từ bộ phận bán hàng | 🟡 🆕 | **Mo** hỏi từng hoá đơn sắp đến hạn (ưu tiên khách hay trễ), nhận tin nhắn tự do kiểu "INV-1003 trễ 10 ngày", gửi tài chính duyệt (tách người gửi / người duyệt). Hạn hợp đồng giữ nguyên, chỉ ghi ngày **dự kiến**. Bước còn thiếu: engine dự báo dùng các cập nhật đã duyệt |
| Cảnh báo khi tiền xuống dưới mức dự trữ tối thiểu | 🟡 | Có `buffer_usd` và cảnh báo, nhưng bằng USD |
| Theo dõi hành động + xuất Excel | ❌ | Chưa có xuất XLSX/CSV cho quyết định |

## 3. Những thứ feedback bảo BỎ khỏi sản phẩm chính

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Blockchain / anchor | ❌ | Vẫn còn trong Audit & trust |
| Tài chính xanh | ❌ | Vẫn nằm trên menu chính |
| Soạn hợp đồng đầy đủ | ❌ | Vẫn trên menu (Contracts) |
| Đấu thầu (Bid simulator) | ❌ | Vẫn trên menu |
| Cổng cho bên cho vay | ❌ | Cổng ngân hàng vẫn là một nửa sản phẩm (landing có nút "Open bank review") |

Gợi ý: gom các module này vào một mục "Phòng thí nghiệm / Demo" có nhãn rõ, ẩn khỏi menu mặc định.

## 4. Quy trình, phân quyền, Việt Nam

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Định vị: hỗ trợ quyết định vốn lưu động cho nhà phân phối B2B Việt Nam | ❌ | Landing vẫn ghi "For export SMEs and the banks that fund them" |
| Tổng quan nhấn: tiền hiện có + thời điểm, đáy tiền + ngày, khoảng trống trên dự trữ, cam kết chờ quyết định, ngoại lệ dữ liệu | 🟡 | Có "Cash today", "First negative week"; vẫn còn KPI "Cheapest cover 17.1%" kiểu CashBridge cũ |
| Vai trò bán hàng / mua hàng, mỗi người chỉ thấy phần mình cần | 🟡 🆕 | Hệ thống vẫn chỉ có Kế toán / Giám đốc / Ngân hàng. Mo đã là chỗ gửi cập nhật cho mọi vai trò SME (chỉ cần quyền đọc); thêm role Sales/Procurement là bước kế |
| VND gốc, hoá đơn điện tử | ❌ | Số liệu chính bằng USD, VND chỉ quy đổi |
| Không ghi "Đã kết nối MISA" khi chưa xác minh | ✅ | Không có chỗ nào khẳng định đã kết nối MISA |
| AI chỉ đề xuất, người duyệt; tính toán và quyền do phần mềm kiểm soát | ✅ 🆕 | Mo chỉ tạo đề xuất (L2 qua gatekeeper), parser dùng luật cố định, không tự đoán hoá đơn/ngày |
| Trạng thái màn hình (thiếu dữ liệu, cũ, lỗi nhập, bị từ chối quyền…) | 🟡 | Có loading/error; chưa đủ bộ trạng thái theo spec |

## 5. Thứ tự nên làm tiếp (theo feedback)

1. Cho engine dự báo dùng các cập nhật đã duyệt từ Mo (ngày thu dự kiến, khoản mua mới), có phiên bản.
2. Luồng nhập CSV/XLSX có xem trước, ánh xạ, đối chiếu, commit nguyên tử.
3. Đổi mô hình tiền sang VND gốc; thêm role Sales / Procurement.
4. Luồng "Kiểm tra đề xuất mua hàng" hoàn chỉnh với phê duyệt gắn phiên bản.
5. Xuất quyết định ra Excel; dọn các module ngoại vi khỏi menu chính.
