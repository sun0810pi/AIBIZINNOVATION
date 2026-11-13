import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useAct } from "@/shared/hooks";
import { useI18n } from "@/shared/i18n";
import { Button, PageHead, Panel, Scroll } from "@/shared/ui";
import { useAuth } from "../auth";
import { commit, exportForecast, fetchStatus, misaSync, previewFile, previewSample, previewSheet, template, type Preview, type Status } from "./api";

/** Accounting data in and out: MISA, Excel on this computer, Google Sheets, Google Docs. */
export default function IntegrationsScreen() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const act = useAct();
  const editor = can("sme:prepare");
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const excelIn = useRef<HTMLInputElement>(null);
  const misaIn = useRef<HTMLInputElement>(null);
  const locale = lang === "vi" ? "vi-VN" : lang === "zh" ? "zh-CN" : "en-GB";
  const num = (v?: number | null) => (v == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v));
  const when = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : null);

  const load = useCallback(() => fetchStatus().then(setStatus).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<Preview>) => {
    setBusy(key);
    const p = await act(fn);
    setBusy(null);
    if (p) { setPreview(p); setTimeout(() => document.getElementById("int-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
  };
  const onFile = (kind: "excel" | "misa") => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void run(kind, () => previewFile(f, kind));
  };
  const apply = async () => {
    if (!preview) return;
    const valid = preview.counts.new + preview.counts.changed;
    const res = await act(() => commit(preview.batch_id, preview.counts.errors > 0), t("int.applied", { n: valid }));
    if (res) {
      setPreview(null);
      window.dispatchEvent(new CustomEvent("mo:updated"));
      await load();
    }
  };

  const synced = (k: string) => status?.last_sync[k];
  const src = (s: string) => s.replace(/\s*\(sandbox\)/i, "");
  const ERR: Record<string, string> = {
    "missing invoice number": "int.e.noInvoice", "missing customer": "int.e.noCustomer", "missing due date": "int.e.noDue",
    "missing amount": "int.e.noAmount", "negative amount": "int.e.negative", "duplicate of an earlier row": "int.e.duplicate",
    "outstanding is larger than the invoice": "int.e.tooBig",
  };
  const err = (e: string) => (ERR[e] ? t(ERR[e]) : e.endsWith("is not a date") ? t("int.e.badDate", { v: e.split("'")[1] ?? "" }) : e);

  return (
    <>
      <PageHead title={t("nav.integrations")} lede={t("int.lede")} actions={<Button variant="ghost" onClick={() => void act(exportForecast)}>{t("int.exportXlsx")}</Button>} />

      <div className="int-grid">
        <Connector logo={<span className="int-logo misa">M</span>} name="MISA AMIS" state={synced("misa") ? "on" : "ready"}
          stateText={synced("misa") ? t("int.connected", { t: when(synced("misa")) ?? "" }) : t("int.ready")} desc={t("int.misa.d")}>
          {editor && <>
            <Button variant="bridge" small disabled={busy !== null} onClick={() => void run("misa-sync", misaSync)}>{busy === "misa-sync" ? t("int.syncing") : t("int.syncNow")}</Button>
            <input ref={misaIn} type="file" hidden accept=".xlsx,.csv" onChange={onFile("misa")} />
            <Button variant="ghost" small disabled={busy !== null} onClick={() => misaIn.current?.click()}>{t("int.misa.file")}</Button>
          </>}
        </Connector>

        <Connector logo={<span className="int-logo excel">X</span>} name={t("int.excel")} state={synced("excel") ? "on" : "ready"}
          stateText={synced("excel") ? t("int.lastImport", { t: when(synced("excel")) ?? "" }) : t("int.ready")} desc={t("int.excel.d")}>
          {editor && <>
            <input ref={excelIn} type="file" hidden accept=".xlsx,.csv" onChange={onFile("excel")} />
            <Button variant="bridge" small disabled={busy !== null} onClick={() => excelIn.current?.click()}>{busy === "excel" ? t("int.reading") : t("int.upload")}</Button>
            <Button variant="ghost" small onClick={() => void act(() => template("cong_no_excel_mau.csv"))}>{t("int.template")}</Button>
          </>}
        </Connector>

        <Connector logo={<span className="int-logo sheets">▦</span>} name="Google Sheets" state={synced("gsheet") ? "on" : "ready"}
          stateText={synced("gsheet") ? t("int.lastImport", { t: when(synced("gsheet")) ?? "" }) : t("int.ready")} desc={t("int.sheets.d")}>
          {editor && (
            <form className="int-link" onSubmit={(e) => { e.preventDefault(); if (link.trim()) void run("gsheet", () => previewSheet(link.trim())); }}>
              <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
              <Button small variant="bridge" type="submit" disabled={busy !== null || !link.trim()}>{busy === "gsheet" ? t("int.reading") : t("int.read")}</Button>
            </form>
          )}
        </Connector>

        <Connector logo={<span className="int-logo docs">≡</span>} name="Google Docs" state="on" stateText={t("int.docs.state")} desc={t("int.docs.d")}>
          <Button variant="ghost" small onClick={() => { window.location.hash = "#funding"; }}>{t("int.docs.pack")}</Button>
        </Connector>
      </div>

      {editor && !preview && (
        <p className="note">{t("int.tryHint")} <button type="button" className="linkish" onClick={() => void run("sample", () => previewSample("misa_so_cong_no_mau.xlsx", "misa"))}>{t("int.trySample")}</button></p>
      )}

      {preview && (
        <section className="panel primary" id="int-preview">
          <div className="row-between">
            <div>
              <h2>{t("int.preview", { s: src(preview.source) })}</h2>
              <p className="sub">{t("int.previewSub", { r: preview.header_row })}</p>
            </div>
            <div className="row">
              <Button variant="ghost" onClick={() => setPreview(null)}>{t("int.cancel")}</Button>
              <Button variant="bridge" disabled={preview.counts.new + preview.counts.changed === 0} onClick={() => void apply()}>
                {t("int.apply", { n: preview.counts.new + preview.counts.changed })}
              </Button>
            </div>
          </div>
          <div className="int-steps">
            {["read", "map", "check", "compare", "apply"].map((s, i) => <span key={s} className={"int-step" + (i < 4 ? " done" : "")}><i>{i < 4 ? "✓" : i + 1}</i>{t("int.step." + s)}</span>)}
          </div>
          <div className="int-counts">
            <span className="chip ok">{t("int.c.new", { n: preview.counts.new })}</span>
            <span className="chip warnc">{t("int.c.changed", { n: preview.counts.changed })}</span>
            <span className="chip">{t("int.c.same", { n: preview.counts.unchanged })}</span>
            <span className={"chip" + (preview.counts.errors ? " miss" : "")}>{t("int.c.err", { n: preview.counts.errors })}</span>
            {Object.entries(preview.control_totals).map(([c, v]) => <span key={c} className="chip must">{t("int.total")}: {num(v)} {c}</span>)}
          </div>
          <div className="hr-chips"><b>{t("int.mapping")}</b>{Object.entries(preview.mapping).map(([f, h]) => <span key={f} className="chip">{h} → {t("int.f." + f)}</span>)}</div>
          {preview.issues.length > 0 && (
            <div className="caution"><b>{t("int.issues")}</b>
              <ul className="list">{preview.issues.map((x) => <li key={x.row}>{t("int.row", { r: x.row })} · {x.invoice_id}: {x.errors.map(err).join("; ")}</li>)}</ul>
            </div>
          )}
          <Scroll>
            <table className="mt-2">
              <thead><tr><th>{t("int.f.row")}</th><th>{t("int.f.invoice_id")}</th><th>{t("int.f.customer")}</th><th>{t("int.f.due_date")}</th><th className="num">{t("int.f.outstanding")}</th><th>{t("int.f.status")}</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 40).map((r) => (
                  <tr key={r.row} className={r.status === "ERROR" ? "int-err" : ""}>
                    <td className="mono">{r.row}</td>
                    <td className="mono">{r.invoice_id || "—"}</td>
                    <td>{(r.customer ?? "—").replace(" (SYNTHETIC)", "")}</td>
                    <td>{r.due_date ?? "—"}</td>
                    <td className="num">{num(r.outstanding)} {r.currency}{r.status === "CHANGED" && r.was ? <div className="muted small">{t("int.was", { v: num(r.was.outstanding) })}</div> : null}</td>
                    <td><span className={"pill " + (r.status === "NEW" ? "ok" : r.status === "CHANGED" ? "warn" : r.status === "ERROR" ? "bad" : "")}>{t("int.s." + r.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          <p className="note">{t("int.atomic")}</p>
        </section>
      )}

      <Panel title={t("int.history")} sub={t("int.historySub", { n: status?.imported_invoices ?? 0 })}>
        {!status || status.batches.length === 0 ? <p className="muted">{t("int.none")}</p> : (
          <Scroll>
            <table>
              <thead><tr><th>{t("int.batch")}</th><th>{t("int.source")}</th><th className="num">{t("int.appliedCol")}</th><th>{t("int.by")}</th><th>{t("int.when")}</th></tr></thead>
              <tbody>{status.batches.map((b) => (
                <tr key={b.batch_id}><td className="mono">{b.batch_id}</td><td>{src(b.source)}</td><td className="num">{b.applied}</td><td>{b.committed_by}</td><td>{when(b.committed_at)}</td></tr>
              ))}</tbody>
            </table>
          </Scroll>
        )}
      </Panel>
    </>
  );
}

function Connector({ logo, name, state, stateText, desc, children }: { logo: ReactNode; name: string; state: "on" | "ready"; stateText: string; desc: string; children?: ReactNode }) {
  return (
    <section className="panel int-card">
      <div className="int-head">
        {logo}
        <div><b>{name}</b><span className={"int-state " + state}><i />{stateText}</span></div>
      </div>
      <p className="muted small">{desc}</p>
      <div className="row int-actions">{children}</div>
    </section>
  );
}
