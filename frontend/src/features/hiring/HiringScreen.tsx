import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useAct } from "@/shared/hooks";
import { useI18n } from "@/shared/i18n";
import { Button, Empty, Kpi, Kpis, LoadingSkeleton, PageHead, Panel, Scroll } from "@/shared/ui";
import type { ScreenProps } from "@/shared/lib/screen";
import { useAuth } from "../auth";
import {
  addCvText, contractDocx, draftContract, exportCsv, exportXlsx, fetchOverview, removeCv, submitBudget, uploadCv,
  type ContractBody, type ContractDraft, type Cv, type Overview,
} from "./api";

type Tab = "cvs" | "positions" | "budget" | "contract";
const TABS: Tab[] = ["cvs", "positions", "budget", "contract"];

/** HR: read CVs (OCR), one master sheet, explainable scores against open positions, salary guidance, budget, contract draft. */
export default function HiringScreen({ arg }: ScreenProps) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const act = useAct();
  const hr = can("sme:hr");
  const tab: Tab = TABS.includes(arg as Tab) ? (arg as Tab) : "cvs";
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [contractFor, setContractFor] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const locale = lang === "vi" ? "vi-VN" : lang === "zh" ? "zh-CN" : "en-GB";

  const load = useCallback(() => fetchOverview().then((d) => { setData(d); setFailed(""); }).catch((e: Error) => setFailed(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const vnd = (v?: number | null) => (v == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v) + " ₫");
  const mil = (v?: number | null) => (v == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v / 1_000_000) + (lang === "vi" ? " tr" : "M"));
  const opTitle = (id: string) => { const o = data?.openings.find((x) => x.id === id); return o ? (lang === "vi" ? o.title : o.title_en) : id; };
  const go = (to: Tab) => { window.location.hash = "#hiring/" + to; };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of files) if (await act(() => uploadCv(f))) ok += 1;
    setBusy(false);
    if (ok) { await load(); await act(async () => undefined, t("hr.uploaded", { n: ok })); }
  };

  const copyTsv = async () => {
    if (!data) return;
    const head = [t("hr.col.name"), t("hr.col.fit"), t("hr.col.score"), t("hr.col.verdict"), t("hr.col.matched"), t("hr.col.missing"), t("hr.col.years"), t("hr.col.expected"), t("hr.col.rec"), "Email", t("hr.col.source")];
    const rows = data.cvs.map((c) => [c.name, opTitle(c.best.opening_id), c.best.score, t("hr.v." + c.best.verdict), c.best.matched.join(", "), c.best.missing.join(", "), c.years ?? "", c.expected_salary_vnd ?? "", `${c.salary.recommended.low}-${c.salary.recommended.high}`, c.email ?? "", c.source]);
    const tsv = [head, ...rows].map((r) => r.map((x) => String(x ?? "").replace(/[\t\n]/g, " ")).join("\t")).join("\n");
    await act(() => navigator.clipboard.writeText(tsv), t("hr.copied"));
  };

  if (failed) return <Empty title={t("hr.failed")}>{failed}</Empty>;
  if (!data) return <LoadingSkeleton />;

  const interview = data.cvs.filter((c) => c.best.verdict === "interview").length;
  const gap = data.openings.reduce((s, o) => s + o.gap, 0);
  const covered = data.openings.reduce((s, o) => s + o.covered, 0);

  return (
    <>
      <PageHead
        title={t("nav.hiring")}
        lede={t(hr ? "hr.lede" : "hr.lede.dir")}
        actions={hr ? (
          <>
            <input ref={file} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.docx" onChange={(e) => void onFiles(e)} />
            <Button variant="bridge" onClick={() => file.current?.click()} disabled={busy}>{busy ? t("hr.reading") : t("hr.upload")}</Button>
            <Button variant="ghost" onClick={() => void act(exportCsv)}>{t("hr.sheets")}</Button>
            <Button variant="ghost" onClick={() => void act(exportXlsx)}>{t("hr.excel")}</Button>
          </>
        ) : <Button variant="ghost" onClick={() => void act(exportCsv)}>{t("hr.sheets")}</Button>}
      />

      <Kpis>
        <Kpi label={t("hr.k.cvs")} value={data.cvs.length} foot={t("hr.k.cvsF")} />
        <Kpi label={t("hr.k.interview")} value={interview} tone="pos" foot={t("hr.k.interviewF")} />
        <Kpi label={t("hr.k.gap")} value={`${covered}/${gap}`} tone={covered < gap ? "warn" : "pos"} foot={t("hr.k.gapF")} />
        <Kpi label={t("hr.k.budget")} value={mil(data.budget.monthly_vnd)} highlight foot={t("hr.k.budgetF", { y: mil(data.budget.first_year_vnd) })} />
      </Kpis>

      <nav className="tabs" aria-label={t("nav.hiring")}>
        {TABS.filter((x) => hr || x !== "contract").map((x) => (
          <a key={x} href={"#hiring/" + x} className={tab === x ? "on" : ""} aria-current={tab === x ? "page" : undefined}>{t("hr.tab." + x)}</a>
        ))}
      </nav>

      {tab === "cvs" && (
        <Panel title={t("hr.sheet")} sub={t("hr.sheetSub")}>
          <div className="row mt-1 hr-sheet-actions">
            <Button small variant="ghost" onClick={() => void copyTsv()}>{t("hr.copy")}</Button>
            <span className="muted small">{t("hr.sheetHow")}</span>
          </div>
          <Scroll>
            <table className="hr-sheet">
              <thead>
                <tr>
                  <th>{t("hr.col.name")}</th><th>{t("hr.col.fit")}</th><th className="num">{t("hr.col.score")}</th><th>{t("hr.col.skills")}</th>
                  <th className="num">{t("hr.col.years")}</th><th className="num">{t("hr.col.salary")}</th><th>{t("hr.col.source")}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.cvs.map((c) => (
                  <CvRow key={c.cv_id} c={c} open={open === c.cv_id} onToggle={() => setOpen(open === c.cv_id ? null : c.cv_id)}
                    opTitle={opTitle} mil={mil} hr={hr}
                    onContract={() => { setContractFor(c.cv_id); go("contract"); }}
                    onRemove={async () => { if (await act(() => removeCv(c.cv_id))) await load(); }} />
                ))}
              </tbody>
            </table>
          </Scroll>
          {hr && (
            <details className="more mt-2">
              <summary>{t("hr.paste")}</summary>
              <div className="field mt-1">
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t("hr.pasteHint")} />
              </div>
              <div className="row mt-1">
                <Button small variant="bridge" disabled={paste.trim().length < 40} onClick={async () => { if (await act(() => addCvText(paste), t("hr.uploaded", { n: 1 }))) { setPaste(""); await load(); } }}>{t("hr.read")}</Button>
              </div>
            </details>
          )}
          <p className="note">{t("hr.note")}</p>
        </Panel>
      )}

      {tab === "positions" && (
        <div className="grid3">
          {data.openings.map((o) => (
            <section key={o.id} className="panel hr-op">
              <div className="row-between">
                <h2>{lang === "vi" ? o.title : o.title_en}</h2>
                <span className={"pill " + (o.covered >= o.gap ? "ok" : "warn")}>{t("hr.gapPill", { c: o.covered, g: o.gap })}</span>
              </div>
              <p className="muted small">{t("hr.opMeta", { y: o.min_years, s: o.start.split("-").reverse().join("/"), p: o.probation_max_days })}</p>
              <div className="hr-chips"><b>{t("hr.must")}</b>{o.must_labels.map((s) => <span key={s} className="chip must">{s}</span>)}</div>
              <div className="hr-chips"><b>{t("hr.nice")}</b>{o.nice_labels.map((s) => <span key={s} className="chip">{s}</span>)}</div>
              <p className="small mt-1">{t("hr.band")}: <b>{mil(o.band_vnd[0])} – {mil(o.band_vnd[1])}</b></p>
              <h3 className="mini">{t("hr.shortlist")}</h3>
              {o.shortlist.length === 0 ? <p className="muted small">{t("hr.noShort")}</p> : (
                <ol className="hr-short">
                  {o.shortlist.map((s) => (
                    <li key={s.cv_id}>
                      <span>{(s.name ?? "—").replace(" (SYNTHETIC)", "")}</span>
                      <span className="hr-bar"><i style={{ width: s.score + "%" }} className={s.verdict} /></span>
                      <b>{s.score}</b>
                      {s.missing.length > 0 && <small className="muted">{t("hr.lacks")}: {s.missing.join(", ")}</small>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === "budget" && <BudgetTab data={data} hr={hr} vnd={vnd} mil={mil} onSent={load} />}
      {tab === "contract" && hr && <ContractTab data={data} initial={contractFor} opTitle={opTitle} vnd={vnd} />}
    </>
  );
}

function CvRow({ c, open, onToggle, opTitle, mil, hr, onContract, onRemove }: {
  c: Cv; open: boolean; onToggle: () => void; opTitle: (id: string) => string; mil: (v?: number | null) => string; hr: boolean;
  onContract: () => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  const s = c.salary;
  const flag = s.expected_vs_band === "above_band" ? "bad" : s.expected_vs_band === "above_recommendation" ? "warn" : "";
  return (
    <>
      <tr className={"hr-row" + (open ? " sel" : "")} onClick={onToggle}>
        <td><b>{(c.name ?? t("hr.noName")).replace(" (SYNTHETIC)", "")}</b><div className="muted small">{c.headline ?? ""}</div></td>
        <td>{opTitle(c.best.opening_id)}<div><span className={"pill " + (c.best.verdict === "interview" ? "ok" : c.best.verdict === "consider" ? "warn" : "bad")}>{t("hr.v." + c.best.verdict)}</span></div></td>
        <td className="num"><span className="hr-score"><i style={{ width: c.best.score + "%" }} className={c.best.verdict} /></span><b>{c.best.score}</b></td>
        <td>
          <div className="hr-chips tight">{c.best.matched.map((x) => <span key={x} className="chip ok">{x}</span>)}{c.best.missing.map((x) => <span key={x} className="chip miss">− {x}</span>)}</div>
        </td>
        <td className="num">{c.years ?? "—"}</td>
        <td className="num">
          <div>{mil(s.recommended.low)} – {mil(s.recommended.high)}</div>
          <small className={"muted " + flag}>{t("hr.wants")} {mil(s.expected)}{s.expected_vs_band ? " · " + t("hr.sal." + s.expected_vs_band) : ""}</small>
        </td>
        <td><span className={"chip" + (c.method.includes("ocr") ? " ocr" : "")}>{t("hr.m." + (c.method.includes("ocr") ? "ocr" : c.method === "sample" ? "sample" : "text"))}</span></td>
        <td className="num" onClick={(e) => e.stopPropagation()}>
          {hr && <span className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
            <Button small variant="ghost" onClick={onContract}>{t("hr.toContract")}</Button>
            <button type="button" className="icon-btn sm" aria-label={t("hr.remove")} title={t("hr.remove")} onClick={onRemove}>×</button>
          </span>}
        </td>
      </tr>
      {open && (
        <tr className="hr-detail"><td colSpan={8}>
          <div className="hr-detail-grid">
            <div>
              <h3 className="mini">{t("hr.why")}</h3>
              <dl className="ratio-grid">
                {Object.entries(c.best.parts).map(([k, v]) => <div key={k}><dt>{t("hr.part." + k)}</dt><dd>{v}</dd></div>)}
              </dl>
            </div>
            <div>
              <h3 className="mini">{t("hr.others")}</h3>
              <ul className="hr-short">
                {c.fits.map((f) => <li key={f.opening_id}><span>{opTitle(f.opening_id)}</span><span className="hr-bar"><i style={{ width: f.score + "%" }} className={f.verdict} /></span><b>{f.score}</b></li>)}
              </ul>
              <p className="small muted mt-1">{c.email ?? ""} {c.phone ? "· " + c.phone : ""} · {t("hr.col.source")}: {c.source}</p>
              {c.missing.length > 0 && <p className="small err">{t("hr.unread")}: {c.missing.join(", ")}</p>}
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}

function BudgetTab({ data, hr, vnd, mil, onSent }: { data: Overview; hr: boolean; vnd: (v?: number | null) => string; mil: (v?: number | null) => string; onSent: () => void }) {
  const { t, lang } = useI18n();
  const act = useAct();
  const [sent, setSent] = useState(false);
  const b = data.budget;
  return (
    <Panel title={t("hr.budget")} sub={t("hr.budgetSub", { p: data.assumptions.employer_contrib_pct, c: mil(data.assumptions.recruiting_cost_per_hire_vnd) })} className="primary">
      <Scroll>
        <table>
          <thead><tr><th>{t("hr.col.fit")}</th><th className="num">{t("hr.seats")}</th><th className="num">{t("hr.gross")}</th><th className="num">{t("hr.monthly")}</th><th className="num">{t("hr.oneOff")}</th><th className="num">{t("hr.year")}</th><th>{t("hr.from")}</th></tr></thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.opening_id}>
                <td>{lang === "vi" ? r.title : data.openings.find((o) => o.id === r.opening_id)?.title_en}<div className="muted small">{t("hr.fromCand", { n: r.from_candidates, s: r.seats })}</div></td>
                <td className="num">{r.seats}</td>
                <td className="num">{vnd(r.gross_monthly_vnd)}</td>
                <td className="num">{vnd(r.monthly_cost_vnd)}</td>
                <td className="num">{vnd(r.one_off_vnd)}</td>
                <td className="num"><b>{vnd(r.first_year_vnd)}</b></td>
                <td>{r.start_month}</td>
              </tr>
            ))}
            <tr className="hr-total"><td><b>{t("hr.total")}</b></td><td className="num"><b>{b.rows.reduce((s, r) => s + r.seats, 0)}</b></td><td /><td className="num"><b>{vnd(b.monthly_vnd)}</b></td><td className="num">{vnd(b.one_off_vnd)}</td><td className="num"><b>{vnd(b.first_year_vnd)}</b></td><td /></tr>
          </tbody>
        </table>
      </Scroll>
      <div className="hr-bars mt-2" aria-hidden="true">
        {b.rows.map((r) => <div key={r.opening_id} style={{ flex: r.first_year_vnd }} title={r.title}><span>{lang === "vi" ? r.title : data.openings.find((o) => o.id === r.opening_id)?.title_en}</span></div>)}
      </div>
      {hr && (
        <div className="row mt-2">
          <Button variant="bridge" disabled={sent} onClick={async () => { if (await act(submitBudget, t("hr.sentOk"))) { setSent(true); onSent(); } }}>{sent ? t("hr.sent") : t("hr.send")}</Button>
          <span className="muted small">{t("hr.sendNote")}</span>
        </div>
      )}
    </Panel>
  );
}

function ContractTab({ data, initial, opTitle, vnd }: { data: Overview; initial: string | null; opTitle: (id: string) => string; vnd: (v?: number | null) => string }) {
  const { t } = useI18n();
  const act = useAct();
  const firstId = initial ?? data.cvs.find((c) => c.best.verdict === "interview")?.cv_id ?? data.cvs[0]?.cv_id ?? "";
  const [cvId, setCvId] = useState(firstId);
  const cv = data.cvs.find((c) => c.cv_id === cvId);
  const [opId, setOpId] = useState(cv?.best.opening_id ?? data.openings[0]?.id ?? "");
  const op = data.openings.find((o) => o.id === opId);
  const [form, setForm] = useState({ start: "", salary: 0, days: 0, pct: 85, term: 12 });
  const [draft, setDraft] = useState<ContractDraft | null>(null);

  useEffect(() => {
    const c = data.cvs.find((x) => x.cv_id === cvId);
    const o = data.openings.find((x) => x.id === (c?.best.opening_id ?? opId));
    if (c) setOpId(c.best.opening_id);
    setForm((f) => ({ ...f, start: o?.start ?? f.start, salary: c?.salary.recommended.point ?? f.salary, days: o?.probation_max_days ?? f.days }));
    setDraft(null);
  }, [cvId]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo<ContractBody>(() => ({ cv_id: cvId, opening_id: opId, start_date: form.start, salary_vnd: Math.round(form.salary), probation_days: form.days, probation_pct: form.pct, term_months: form.term }), [cvId, opId, form]);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.type === "date" ? e.target.value : Number(e.target.value) });

  return (
    <div className="grid2">
      <Panel title={t("hr.contract")} sub={t("hr.contractSub")}>
        <div className="inputs">
          <label className="field">{t("hr.col.name")}
            <select value={cvId} onChange={(e) => setCvId(e.target.value)}>
              {data.cvs.map((c) => <option key={c.cv_id} value={c.cv_id}>{(c.name ?? c.cv_id).replace(" (SYNTHETIC)", "")}</option>)}
            </select>
          </label>
          <label className="field">{t("hr.col.fit")}
            <select value={opId} onChange={(e) => setOpId(e.target.value)}>
              {data.openings.map((o) => <option key={o.id} value={o.id}>{opTitle(o.id)}</option>)}
            </select>
          </label>
          <label className="field">{t("hr.start")}<input type="date" value={form.start} onChange={set("start")} /></label>
          <label className="field">{t("hr.salary")}<input type="number" step={500000} min={0} value={form.salary} onChange={set("salary")} /></label>
          <label className="field">{t("hr.probDays", { m: op?.probation_max_days ?? 60 })}<input type="number" min={0} value={form.days} onChange={set("days")} /></label>
          <label className="field">{t("hr.probPct")}<input type="number" min={0} max={100} value={form.pct} onChange={set("pct")} /></label>
          <label className="field">{t("hr.term")}
            <select value={form.term} onChange={set("term")}>
              {[12, 24, 36, 0].map((m) => <option key={m} value={m}>{m ? t("hr.termM", { m }) : t("hr.termOpen")}</option>)}
            </select>
          </label>
        </div>
        {cv && op && <p className="small muted">{t("hr.recLine", { lo: vnd(cv.salary.recommended.low), hi: vnd(cv.salary.recommended.high), band: `${vnd(op.band_vnd[0])} – ${vnd(op.band_vnd[1])}` })}</p>}
        <div className="row mt-2">
          <Button variant="bridge" onClick={async () => { const d = await act(() => draftContract(body)); if (d) setDraft(d); }}>{t("hr.draft")}</Button>
          <Button variant="ghost" disabled={!draft} onClick={() => void act(() => contractDocx(body))}>{t("hr.docx")}</Button>
        </div>
        {draft && <ul className="checks mt-2">{draft.checks.map((c) => <li key={c}><span className="mark ok">✓</span><span>{c}</span></li>)}</ul>}
      </Panel>
      <Panel title={t("hr.preview")} sub={t("hr.previewSub")}>
        {draft ? (
          <article className="hr-doc">
            {draft.sections.map(([h, b], i) => (
              <section key={i} className={i < 2 ? "center" : ""}>
                <h4>{h}</h4>
                {b.split("\n").map((l, j) => <p key={j}>{l}</p>)}
              </section>
            ))}
          </article>
        ) : <p className="muted">{t("hr.previewEmpty")}</p>}
      </Panel>
    </div>
  );
}
