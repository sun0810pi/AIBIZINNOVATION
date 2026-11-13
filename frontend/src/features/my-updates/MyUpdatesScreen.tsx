import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { useAct } from "@/shared/hooks";
import { Button, Empty, PageHead, Panel, Scroll } from "@/shared/ui";
import { RoleStrip, useAuth } from "../auth";
import { fetchCheckin, review, type Checkin, type Update } from "./api";

/** "My updates and actions": what Mo still needs from me, what I sent, and (for finance) what waits for review. */
export default function MyUpdatesScreen() {
  const { t, lang } = useI18n();
  const { user, can } = useAuth();
  const act = useAct();
  const [data, setData] = useState<Checkin | null>(null);
  const [failed, setFailed] = useState(false);
  const locale = lang === "vi" ? "vi-VN" : lang === "zh" ? "zh-CN" : "en-GB";
  const reviewer = can("sme:prepare");
  const reporter = !can("sme:read");
  const buyer = user.role === "sme_procurement";

  const load = useCallback(() => fetchCheckin().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true)), []);
  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener("focus", again);
    window.addEventListener("mo:updated", again);
    const id = setInterval(again, 8000); // Mo writes from the side panel; keep this list in step
    return () => { window.removeEventListener("focus", again); window.removeEventListener("mo:updated", again); clearInterval(id); };
  }, [load]);

  const money = (v?: number, cur = "VND") => {
    if (v == null) return "—";
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: cur === "USD" ? 2 : 0 }).format(v); } catch { return `${v} ${cur}`; }
  };
  const day = (iso?: string | null) => (iso ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")) : "—");
  const openMo = () => window.dispatchEvent(new CustomEvent("mo:open"));

  const decide = async (u: Update, accept: boolean) => {
    if (await act(() => review(u.update_id, accept), t(accept ? "upd.accepted" : "upd.rejected", { id: u.update_id }))) await load();
  };

  const questions = data?.questions ?? [];
  const mine = (data?.updates ?? []).filter((u) => u.author === user.user_id);
  const toReview = reviewer ? (data?.updates ?? []).filter((u) => u.status === "PENDING_REVIEW" && u.author !== user.user_id) : [];
  const status = (s: Update["status"]) => <span className={"pill " + (s === "ACCEPTED" ? "ok" : s === "REJECTED" ? "bad" : "warn")}>{t(`mo.status_${s}`)}</span>;
  const subject = (u: Update) => (u.subject_id === "NEW-PURCHASE" || u.subject_id === "HIRING-PLAN" ? u.counterparty ?? "—" : `${u.subject_id} · ${(u.counterparty ?? "").replace(" (SYNTHETIC)", "")}`);
  const amount = (u: Update) => (u.change_type === "PURCHASE_COMMITMENT" || u.change_type === "HIRING_PLAN" ? money(u.amount_vnd, "VND") + (u.change_type === "HIRING_PLAN" ? t("upd.perMonth") : "") : money(u.amount, u.currency));

  return (
    <>
      <PageHead title={t("nav.updates")} lede={t(reporter ? (buyer ? "upd.lede.buy" : "upd.lede.sales") : "upd.lede.fin")} />
      {reporter && <RoleStrip />}

      <section className="panel upd-hero">
        <img className="upd-mo" src={buyer ? "/mascot/coin.webp" : questions.length ? "/mascot/checklist.webp" : "/mascot/happy.webp"} alt="" />
        <div>
          <h2>{buyer ? t("upd.hero.buy") : questions.length ? t("upd.hero.q", { n: questions.length }) : t("upd.hero.none")}</h2>
          <p className="muted">{t("upd.hero.rule")}</p>
          <div className="row mt-2"><Button variant="bridge" onClick={openMo}>{t("upd.openMo")}</Button></div>
        </div>
      </section>

      {failed && <Empty title={t("upd.failed")} />}

      {!buyer && questions.length > 0 && (
        <Panel title={t("upd.waiting")} sub={t("upd.waiting.sub")}>
          <Scroll>
            <table>
              <thead><tr><th>{t("mo.invoiceLbl")}</th><th>{t("mo.customer")}</th><th className="num">{t("mo.amount")}</th><th>{t("mo.due")}</th><th /></tr></thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q.subject_id}>
                    <td className="mono">{q.subject_id}</td>
                    <td>{q.buyer.replace(" (SYNTHETIC)", "")}</td>
                    <td className="num">{money(q.amount, q.currency)}</td>
                    <td>{day(q.due_date)}</td>
                    <td className="num"><Button small variant="ghost" onClick={openMo}>{t("upd.answer")}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Panel>
      )}

      {reviewer && (
        <Panel title={t("upd.review")} sub={t("upd.review.sub")} className={toReview.length ? "primary" : ""}>
          {toReview.length === 0 ? <p className="muted">{t("mo.queueEmpty")}</p> : (
            <Scroll>
              <table>
                <thead><tr><th>{t("upd.col.what")}</th><th>{t("mo.kind")}</th><th className="num">{t("mo.amount")}</th><th>{t("mo.expected")}</th><th>{t("upd.col.contract")}</th><th>{t("upd.col.from")}</th><th /></tr></thead>
                <tbody>
                  {toReview.map((u) => (
                    <tr key={u.update_id}>
                      <td>{subject(u)}{u.note ? <div className="muted small">{u.note}</div> : null}</td>
                      <td>{t(`mo.type_${u.change_type}`)}</td>
                      <td className="num">{amount(u)}</td>
                      <td>{day(u.proposed_date)}</td>
                      <td>{day(u.contractual_due_date)}</td>
                      <td>{u.author}</td>
                      <td className="num"><span className="row" style={{ justifyContent: "flex-end" }}>
                        <Button small variant="bridge" onClick={() => void decide(u, true)}>{t("mo.accept")}</Button>
                        <Button small variant="ghost" onClick={() => void decide(u, false)}>{t("mo.reject")}</Button>
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          )}
        </Panel>
      )}

      <Panel title={t("upd.sent")} sub={t("upd.sent.sub")}>
        {mine.length === 0 ? <p className="muted">{t("upd.sent.none")}</p> : (
          <Scroll>
            <table>
              <thead><tr><th>{t("upd.col.what")}</th><th>{t("mo.kind")}</th><th className="num">{t("mo.amount")}</th><th>{t("mo.expected")}</th><th>{t("upd.col.status")}</th></tr></thead>
              <tbody>
                {mine.map((u) => (
                  <tr key={u.update_id}>
                    <td>{subject(u)}</td>
                    <td>{t(`mo.type_${u.change_type}`)}</td>
                    <td className="num">{amount(u)}</td>
                    <td>{day(u.proposed_date)}</td>
                    <td>{status(u.status)}{u.reviewed_by ? <div className="muted small">{u.reviewed_by}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Panel>

      {reporter && <p className="note">{t("upd.privacy")}</p>}
    </>
  );
}
