# Monetra: tính năng, điểm mạnh và độ khớp với đề AI for Business Innovation

Mọi thứ dưới đây đã chạy thử trên bản demo ngày 13/11/2026. Các con số trên landing đã được đo lại từ đầu (`python eval/trust_scorecard.py`) và cho cùng kết quả.

## 1. Tính năng theo phòng ban (đổi tài khoản = đổi phòng ban)

| Tài khoản demo | Phòng ban | Thấy gì / làm gì |
|---|---|---|
| Lê Văn Hùng | **Kinh doanh** 🆕 | Chỉ thấy "Cập nhật của tôi". Mo hỏi từng hoá đơn sắp đến hạn (khách hay trả trễ hỏi trước), bấm 1 lần để báo "trễ 7 ngày" / "hẹn ngày…" / "tranh chấp". **Không** thấy số dư ngân hàng, dự báo, phương án vốn hay cập nhật của người khác (server chặn 403, có test) |
| Đỗ Thu Hà | **Nhân sự (HR)** 🆕 | Tải CV (PDF, ảnh chụp, bản scan, Word) → OCR tiếng Việt ngay trên máy chủ → bảng CV tổng hợp (xuất Google Sheets CSV / Excel, hoặc sao chép dán thẳng vào Google Sheet) → chấm điểm theo kỹ năng bắt buộc / cộng thêm của từng vị trí đang thiếu, giải thích vì sao → gợi ý khoảng lương trong khung nội bộ, cảnh báo nếu ứng viên đòi vượt khung → ngân sách tuyển dụng (lương + 21,5% bảo hiểm + chi phí tuyển) gửi Tài chính duyệt → soạn hợp đồng lao động (Word), chặn thử việc quá 60/30 ngày (Điều 25) hoặc lương thử việc dưới 85% (Điều 26). Giám đốc xem được điểm và ngân sách, không thấy thông tin liên hệ |
| Phạm Thị Mai | **Mua hàng** 🆕 | Báo khoản mua / đặt cọc chưa vào sổ (gõ "150tr" là hiểu 150.000.000 ₫). Cùng giới hạn quyền như Kinh doanh |
| Nguyễn Thị Lan, Olivia Bennett | **Kế toán** | Dự báo, đối chiếu, duyệt cập nhật của các phòng khác (không tự duyệt cái mình gửi), nhờ Mo chạy Autopilot và lập hồ sơ |
| Trần Văn Minh, Chen Wei | **Giám đốc** | Trung tâm quyết định, Autopilot chế độ lập kế hoạch, phê duyệt bằng mã OTP một lần |
| Li Hua, Daniel Hughes | **Ngân hàng** | Chỉ thấy hồ sơ đã phát hành, tự tính lại mọi mã băm, ghi quyết định tín dụng |

## 2. AI làm gì (và không làm gì)

| AI làm | Cụ thể | Bằng chứng |
|---|---|---|
| Trợ lý hội thoại Mo 🆕 | Chủ động hỏi các phòng ban, hiểu tin nhắn tự do ("Oakline báo INV-1003 trễ 10 ngày"), chạy Autopilot ngay trong chat, trả lời câu hỏi về dòng tiền có trích nguồn | 7 test API + chạy thật trên trình duyệt |
| Dự báo dòng tiền 13 tuần | Chỉ ra tuần âm tiền đầu tiên và **vì sao** (từng khoản cộng lại đúng bằng mức thiếu) | Màn Dự báo |
| Dự đoán khách trả trễ | Hồi quy logistic trên lịch sử thanh toán | **Brier 0,091 so với 0,146** của cách đoán theo tỷ lệ lịch sử, tốt hơn 37,8% trên 167 hoá đơn |
| Đối chiếu tự động | Khớp tiền về với nhiều hoá đơn cùng lúc (trừ phí ngân hàng), khớp 3 bên PO / hoá đơn / vận đơn, đọc chứng từ quét | Màn Khoản phải thu |
| Chống lừa đảo | Bắt email đổi số tài khoản, tên miền giả, che dữ liệu cá nhân trước khi đưa cho AI, phát hiện câu lệnh chèn | **28/28** tình huống tấn công bị chặn |
| Autopilot | 5 bước: tìm khoảng thiếu → kiểm hoá đơn → so sánh phương án theo lãi suất năm thật → thử kịch bản xấu → lập hồ sơ | **5/5** kịch bản kết thúc đúng, kể cả khi đúng là phải dừng lại |
| **Không** làm | Không chuyển tiền (bị cấm cứng). Không tự phê duyệt. Không đổi hạn hợp đồng. Mọi đề xuất của AI phải qua người duyệt, mỗi con số đều gắn nhãn đã kiểm / tính toán / giả định | Gatekeeper 4 cấp, nhật ký băm chuỗi |

## 3. Điểm mạnh khi chấm

- **Có prototype chạy thật** (đề cho điểm cộng): đăng nhập, 5 vai trò, cài được lên điện thoại (PWA), 3 ngôn ngữ, chế độ sáng / tối.
- **AI có mục đích rõ**, đúng yêu cầu "không chỉ thêm AI cho có": AI đọc, dự đoán, so sánh, đề xuất; con người quyết định.
- **Độ tin cậy đo được**, không chỉ nói: 28/28, 5/5, Brier 37,8%, và chạy lại được bằng một lệnh.
- **Bảo mật và rủi ro AI** (đề yêu cầu xem xét): phân quyền theo phòng ban, tách người lập / người duyệt, OTP, nhật ký không sửa được.

## 4. Khớp với ngân hàng ý tưởng của đề

| Nhóm trong đề | Monetra đã có |
|---|---|
| 7. Finance & Business Management | Phân tích dòng tiền và dự báo; đối chiếu hoá đơn – chứng từ; phát hiện khoản bất thường (email lừa đảo, hoá đơn tài trợ trùng); tổng hợp báo cáo dễ hiểu |
| 5. Data & Decision Intelligence | Hỏi bằng ngôn ngữ tự nhiên; so sánh kịch bản; dự báo dựa trên lịch sử |
| 4. Operations & Productivity | Trích xuất thông tin từ hoá đơn / hợp đồng; Mo gom cập nhật từ nhiều phòng ban thay vì gọi điện, nhắn Zalo |
| 1. Human Resources & Recruitment | Sàng lọc CV theo tiêu chí tuyển dụng (OCR + chấm điểm giải thích được), xác định vị trí còn thiếu, gợi ý lương, ngân sách tuyển dụng nối vào dòng tiền, soạn hợp đồng lao động |
| Trợ lý nội bộ | Mo là trợ lý nội bộ chủ động hỏi, không chỉ chờ người hỏi |

## 5. Còn yếu (nói trước để không bị giám khảo hỏi bất ngờ)

- Dự báo **chưa tự dùng** các cập nhật đã duyệt từ Mo (mới thu thập và duyệt).
- Số liệu gốc bằng USD (doanh nghiệp xuất khẩu mẫu); chưa nhập CSV/XLSX từ MISA; chưa xuất Excel.
- Menu vẫn còn các module phụ: Tài chính xanh, Mô phỏng dự thầu, Hợp đồng, Blockchain.
- Toàn bộ dữ liệu là giả lập; chưa có khách hàng thật để đo tiết kiệm thời gian.
