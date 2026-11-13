import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isUnauthorized } from "@/shared/api/client";
import { useSnapshotContext } from "@/entities/case";
import { clearSession, signInUrl } from "@/shared/api/session";
import { useI18n } from "@/shared/i18n";
import { useAuth } from "../auth";
import {
  askCfo, getCheckin, parseUpdate, reviewUpdate, runAutopilot, submitUpdate,
  type AutopilotRun, type Checkin, type CheckinQuestion, type Citation, type OperationalUpdate, type SubmitBody,
} from "./api";
import { moCopy, type CopyKey } from "./copy";
import { Mascot, type Pose } from "./Mascot";
import "./assistant.css";

/* ------------------------------------------------------------------ message model */
type Confirm = { body: SubmitBody; title: string; rows: Array<[string, string]>; foot: string };
type Msg =
  | { id: number; from: "mo" | "me"; kind: "text"; text: string; cites?: Citation[] }
  | { id: number; from: "mo"; kind: "invoice"; q: CheckinQuestion }
  | { id: number; from: "mo"; kind: "confirm"; c: Confirm; state: "open" | "sent" | "edited" }
  | { id: number; from: "mo"; kind: "queue" }
  | { id: number; from: "mo"; kind: "autopilot"; run: AutopilotRun };
type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> : never) : never;
type Chip = { label: string; run: () => void; primary?: boolean };
type Mode = "text" | "date" | "note" | "supplier" | "amount" | "pdate" | "pnote";
type Flow = "menu" | "checkin" | "purchase" | "free";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PEEK_KEY = "mo_peeked";

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "150tr", "150m", "1,5 tỷ", "150.000.000" → whole VND. Shown back to the person before anything is sent. */
function readVnd(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(\d+(?:[.,]\d+)?)(tr|triệu|trieu|m|tỷ|ty|b|k|nghìn|nghin)?(?:vnd|đ|d)?$/);
  if (m && m[2]) {
    const n = Number(m[1].replace(",", "."));
    const unit = /^(tr|triệu|trieu|m)$/.test(m[2]) ? 1e6 : /^(tỷ|ty|b)$/.test(m[2]) ? 1e9 : 1e3;
    const v = Math.round(n * unit);
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  }
  const digits = s.replace(/[.,](?=\d{3}(\D|$))/g, "").replace(/(vnd|đ|d)$/, "");
  if (!/^\d+$/.test(digits)) return null;
  const v = Number(digits);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

const AUTOPILOT_WORDS = /autopilot|chạy phân tích|đề xuất phương án|lập hồ sơ|phương án rẻ nhất|run the analysis|draft the pack|自动驾驶/i;
const UPDATE_WORDS = /\b(INV[-\s]?\d+)|trễ|tre |chậm|hẹn|tranh chấp|late|delay|promise|dispute|will pay/i;

export function MascotAssistant({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const { lang, t: tr } = useI18n();
  const { user, can } = useAuth();
  const snap = useSnapshotContext();
  const m = useMemo(() => moCopy(tr), [tr]);
  const locale = lang === "vi" ? "vi-VN" : lang === "zh" ? "zh-CN" : "en-GB";
  const first = user.name.split(" ").slice(-1)[0];

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [chips, setChips] = useState<Chip[]>([]);
  const [typing, setTyping] = useState(false);
  const [pose, setPose] = useState<Pose>("wave");
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [checkin, setCheckinState] = useState<Checkin | null>(null);
  const checkinRef = useRef<Checkin | null>(null);
  const [peek, setPeek] = useState(false);
  const [busy, setBusy] = useState(false);

  const nextId = useRef(1);
  const run = useRef(0); // bumps on restart, so a late reply from an old conversation is dropped
  const started = useRef(false);
  const flow = useRef<Flow>("menu");
  const queue = useRef<CheckinQuestion[]>([]);
  const idx = useRef(0);
  const sentCount = useRef(0);
  const purchase = useRef<{ supplier?: string; amount?: number; date?: string }>({});
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const awaitingApproval = can("sme:approve") && snap.snapshot?.meta.case_state === "AWAITING_APPROVAL";
  const reviewCount = (data: Checkin | null) =>
    can("sme:prepare") ? (data?.updates ?? []).filter((u) => u.status === "PENDING_REVIEW" && u.author !== user.user_id).length : 0;

  /* ------------------------------------------------------------ formatting (display only) */
  const money = useCallback((v: number | undefined, cur = "VND") => {
    if (v == null) return "—";
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: cur === "VND" || cur === "JPY" ? 0 : 2 }).format(v);
    } catch {
      return `${v.toLocaleString(locale)} ${cur}`;
    }
  }, [locale]);
  const day = useCallback((iso?: string | null) => (iso ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")) : "—"), [locale]);

  /* ------------------------------------------------------------ conversation primitives */
  const push = useCallback((m: NewMsg) => {
    setMsgs((list) => [...list, { ...m, id: nextId.current++ } as Msg]);
  }, []);
  const me = useCallback((txt: string) => push({ from: "me", kind: "text", text: txt }), [push]);
  const mo = useCallback(async (items: Array<string | NewMsg>, p: Pose = "chat", wait = 520) => {
    const token = run.current;
    setChips([]);
    setTyping(true);
    setPose("laptop");
    for (const item of items) {
      await sleep(wait + Math.min(600, (typeof item === "string" ? item.length : 40) * 6));
      if (token !== run.current) return false;
      push(typeof item === "string" ? { from: "mo", kind: "text", text: item } : (item as Msg));
    }
    setTyping(false);
    setPose(p);
    return true;
  }, [push]);

  const fail = useCallback((e: unknown) => {
    if (isUnauthorized(e)) {
      clearSession();
      window.location.href = signInUrl();
      return;
    }
    setTyping(false);
    setPose("umbrella");
    push({ from: "mo", kind: "text", text: e instanceof Error ? e.message : String(e) });
  }, [push]);

  /* ------------------------------------------------------------ menus */
  const menu = (data: Checkin | null) => {
    flow.current = "menu";
    setMode("text");
    // Each department gets its own main job first; the rest stays one tap away.
    const out: Chip[] = [];
    const left = data?.questions.length ?? 0;
    const reviews = reviewCount(data);
    const role = user.role;
    const checkin: Chip = { label: m("startCheckin"), run: () => void startCheckin() };
    const purchaseChip: Chip = { label: m("newPurchase"), run: () => void startPurchase() };
    const apChip: Chip = { label: m("apRun"), run: () => void startAutopilot(false) };
    const reviewChip: Chip = { label: m("reviewQueue", { n: reviews }), run: () => void showQueue() };
    const approveChip: Chip = { label: m("openApproval"), run: () => { window.location.hash = "#funding"; onClose(); } };
    if (role === "sme_sales") out.push({ ...checkin, primary: left > 0 }, purchaseChip);
    else if (role === "sme_procurement") out.push({ ...purchaseChip, primary: true });
    else if (role === "sme_hr") out.push(
      { label: m("hrSheet"), primary: true, run: () => { window.location.hash = "#hiring/cvs"; onClose(); } },
      { label: m("hrBudget"), run: () => { window.location.hash = "#hiring/budget"; onClose(); } },
      { label: m("hrContract"), run: () => { window.location.hash = "#hiring/contract"; onClose(); } },
    );
    else if (role === "sme_accountant") {
      if (reviews > 0) out.push({ ...reviewChip, primary: true });
      out.push({ ...apChip, primary: reviews === 0 });
      if (left > 0) out.push(checkin);
      out.push(purchaseChip);
    } else if (role === "sme_director") {
      if (awaitingApproval) out.push({ ...approveChip, primary: true });
      out.push({ ...apChip, primary: !awaitingApproval });
      if (left > 0) out.push(checkin);
    } else {
      if (left > 0) out.push({ ...checkin, primary: true });
      out.push(purchaseChip);
    }
    if (can("sme:analyze")) out.push({ label: m("askOther"), run: () => void startFree() });
    setChips(out);
  };

  const refresh = useCallback(async () => {
    const data = await getCheckin();
    checkinRef.current = data;
    setCheckinState(data);
    return data;
  }, []);

  /* ------------------------------------------------------------ check-in flow */
  const askCurrent = async () => {
    const q = queue.current[idx.current];
    if (!q) {
      flow.current = "menu";
      const ok = await mo([sentCount.current > 0 ? m("done", { n: sentCount.current, name: first }) : m("doneNone")], "cheer");
      if (ok) menu(await refresh().catch(() => checkinRef.current));
      return;
    }
    const ok = await mo([{ from: "mo", kind: "invoice", q } as NewMsg], "checklist", 380);
    if (!ok) return;
    setMode("text");
    setChips([
      { label: m("onTime"), run: () => answer("onTime") },
      { label: m("late7"), run: () => answer("late7") },
      { label: m("late14"), run: () => answer("late14") },
      { label: m("pickDate"), run: () => answer("pick") },
      { label: m("dispute"), run: () => answer("dispute") },
      { label: m("unknown"), run: () => answer("unknown") },
      { label: m("skip"), run: () => answer("skip") },
    ]);
  };

  const confirm = async (body: SubmitBody, q?: CheckinQuestion) => {
    const rows: Array<[string, string]> = [];
    let title = m("confirmTitle");
    if (body.change_type === "PURCHASE_COMMITMENT") {
      title = m("purchase");
      rows.push([m("supplier"), body.counterparty ?? "—"], [m("amount"), money(body.amount_vnd, "VND")], [m("cashOut"), day(body.proposed_date)]);
    } else if (q) {
      rows.push([m("invoiceLbl"), q.subject_id], [m("customer"), q.buyer.replace(" (SYNTHETIC)", "")], [m("amount"), money(q.amount, q.currency)]);
      rows.push([m("kind"), m(("type_" + body.change_type) as CopyKey)]);
      if (body.proposed_date) rows.push([m("expected"), day(body.proposed_date)]);
      rows.push([m("contractStays"), day(q.due_date)]);
    }
    if (body.note) rows.push(["📝", body.note]);
    const ok = await mo([{ from: "mo", kind: "confirm", c: { body, title, rows, foot: m("willReview") }, state: "open" } as NewMsg], "idea", 360);
    if (!ok) return;
    setMode("text");
    setChips([
      { label: m("send"), primary: true, run: () => void send(body) },
      { label: m("edit"), run: () => void edit() },
    ]);
  };

  const markLastConfirm = (state: "sent" | "edited") =>
    setMsgs((list) => {
      const i = [...list].reverse().findIndex((m) => m.kind === "confirm" && m.state === "open");
      if (i < 0) return list;
      const at = list.length - 1 - i;
      const copy = list.slice();
      copy[at] = { ...(copy[at] as Extract<Msg, { kind: "confirm" }>), state };
      return copy;
    });

  const send = async (body: SubmitBody) => {
    setChips([]);
    setBusy(true);
    try {
      await submitUpdate(body);
      window.dispatchEvent(new CustomEvent("mo:updated"));
      markLastConfirm("sent");
      sentCount.current += 1;
      await mo([m("sent")], "happy", 300);
      if (flow.current === "checkin") {
        idx.current += 1;
        await sleep(350);
        if (queue.current[idx.current]) await mo([m("next")], "checklist", 200);
        await askCurrent();
      } else {
        menu(await refresh());
      }
    } catch (e) {
      fail(e);
      menu(checkinRef.current);
    } finally {
      setBusy(false);
    }
  };

  const edit = async () => {
    markLastConfirm("edited");
    if (flow.current === "checkin") await askCurrent();
    else if (flow.current === "purchase") await startPurchase();
    else {
      setMode("text");
      menu(checkinRef.current);
    }
  };

  const answer = (choice: "onTime" | "late7" | "late14" | "pick" | "dispute" | "unknown" | "skip") => {
    const q = queue.current[idx.current];
    if (!q) return;
    const go = async () => {
      if (choice === "skip") {
        me(m("saidSkip"));
        idx.current += 1;
        await mo([m("skipped")], "sit", 250);
        await askCurrent();
      } else if (choice === "onTime") {
        me(m("saidOnTime"));
        await confirm({ change_type: "ON_TIME", subject_id: q.subject_id }, q);
      } else if (choice === "late7" || choice === "late14") {
        const d = addDays(q.due_date, choice === "late7" ? 7 : 14);
        me(m("saidDate", { d: day(d) }));
        await confirm({ change_type: "PAYMENT_DELAY", subject_id: q.subject_id, proposed_date: d }, q);
      } else if (choice === "unknown") {
        me(m("saidUnknown"));
        await confirm({ change_type: "UNKNOWN", subject_id: q.subject_id }, q);
      } else if (choice === "pick") {
        me(m("pickDate"));
        if (await mo([m("whichDate")], "calc", 250)) {
          setMode("date");
          setText(q.due_date);
          setChips([{ label: m("skip"), run: () => answer("skip") }]);
        }
      } else if (choice === "dispute") {
        me(m("saidDispute"));
        if (await mo([m("whatDispute")], "search", 250)) {
          setMode("note");
          setText("");
          setChips([{ label: m("skip"), run: () => answer("skip") }]);
        }
      }
    };
    void go();
  };

  const startCheckin = async () => {
    flow.current = "checkin";
    me(m("startCheckin"));
    const data = await refresh().catch((e) => { fail(e); return null; });
    queue.current = data?.questions ?? [];
    idx.current = 0;
    sentCount.current = 0;
    await askCurrent();
  };

  /* ------------------------------------------------------------ autopilot in chat */
  const startAutopilot = async (execute: boolean, echo = true) => {
    flow.current = "menu";
    if (echo) me(m(execute ? "apExecute" : "apRun"));
    if (!(await mo([m(execute ? "apStartExec" : "apStart")], "laptop", 250))) return;
    setTyping(true);
    setPose("laptop");
    try {
      const run = await runAutopilot(execute);
      setTyping(false);
      void snap.refresh().catch(() => undefined); // tiles and badges elsewhere follow the new state
      push({ from: "mo", kind: "autopilot", run });
      const rec = run.recommendation;
      const line = run.mode === "execute" ? m("apDrafted") : rec ? m("apDone", { opt: rec.option_name.replace(" (Partner Factor, MOCK)", ""), apr: rec.apr_pct.toFixed(1) }) : m("apNoRec");
      await mo([line], run.mode === "execute" ? "cheer" : "idea", 300);
      const out: Chip[] = [];
      if (run.mode !== "execute" && rec && can("sme:prepare")) out.push({ label: m("apExecute"), primary: true, run: () => void startAutopilot(true) });
      if (rec) out.push({ label: m("apOpenFunding"), primary: run.mode === "execute", run: () => { window.location.hash = "#funding"; onClose(); } });
      out.push({ label: m("apDetail"), run: () => { window.location.hash = "#autopilot"; onClose(); } });
      out.push({ label: m("apMenu"), run: () => menu(checkinRef.current) });
      setChips(out);
    } catch (e) {
      fail(e);
      menu(checkinRef.current);
    }
  };

  // Other screens ask Mo to run things (e.g. "Next step: run the Autopilot") through a window event.
  const apRef = useRef(startAutopilot);
  apRef.current = startAutopilot;
  useEffect(() => {
    const onRun = (e: Event) => {
      if ((e as CustomEvent).detail !== "autopilot") return;
      onOpen();
      started.current = true;
      void apRef.current(false);
    };
    window.addEventListener("mo:run", onRun);
    return () => window.removeEventListener("mo:run", onRun);
  }, [onOpen]);

  /* ------------------------------------------------------------ purchase flow */
  const startPurchase = async () => {
    flow.current = "purchase";
    purchase.current = {};
    me(m("newPurchase"));
    if (await mo([m("supplierQ")], "coin", 300)) {
      setMode("supplier");
      setText("");
    }
  };

  /* ------------------------------------------------------------ free questions */
  const startFree = async () => {
    flow.current = "free";
    me(m("askOther"));
    if (await mo([m("freeIntro")], "headphones", 250)) {
      setMode("text");
      setChips(m("suggestions").split("|").map((s) => ({ label: s, run: () => void ask(s) })));
      input.current?.focus();
    }
  };

  const ask = async (question: string) => {
    if (AUTOPILOT_WORDS.test(question) && can("sme:analyze")) {
      me(question);
      await startAutopilot(/lập hồ sơ|draft/i.test(question) && can("sme:prepare"), false);
      return;
    }
    me(question);
    if (UPDATE_WORDS.test(question)) {
      flow.current = "free";
      setTyping(true);
      setPose("search");
      try {
        const r = await parseUpdate(question, checkinRef.current?.as_of);
        setTyping(false);
        if (r.draft) {
          await mo([m("parsedOk")], "idea", 250);
          const d = r.draft;
          await confirm({ change_type: d.change_type, subject_id: d.subject_id, proposed_date: d.proposed_date, note: d.note }, {
            subject_id: d.subject_id, buyer: d.buyer, amount: d.amount, currency: d.currency, due_date: d.due_date,
            days_to_due: 0, p_on_time: null, avg_days_late: null, why: "",
          });
          return;
        }
        const key = ("missing_" + (r.missing[0] ?? "invoice")) as CopyKey;
        await mo([m(key, { ids: r.ids_found.join(", ") })], "search", 250);
        menu(checkinRef.current);
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (!can("sme:analyze")) {
      await mo([m("cantAsk")], "shield", 250);
      menu(checkinRef.current);
      return;
    }
    setTyping(true);
    setPose("search");
    try {
      const reply = await askCfo(question);
      await mo([{ from: "mo", kind: "text", text: reply.text, cites: reply.citations } as NewMsg], "idea", 200);
      setChips(m("suggestions").split("|").filter((s) => s !== question).map((s) => ({ label: s, run: () => void ask(s) })));
    } catch (e) {
      fail(e);
    }
  };

  /* ------------------------------------------------------------ review queue (finance) */
  const showQueue = async () => {
    me(m("reviewQueue", { n: checkinRef.current?.updates.filter((u) => u.status === "PENDING_REVIEW").length ?? 0 }));
    await refresh().catch(() => undefined);
    await mo([{ from: "mo", kind: "queue" } as NewMsg], "book", 250);
    menu(checkinRef.current);
  };

  const decide = async (u: OperationalUpdate, accept: boolean) => {
    setBusy(true);
    try {
      await reviewUpdate(u.update_id, accept);
      window.dispatchEvent(new CustomEvent("mo:updated"));
      const data = await refresh();
      await mo([m(accept ? "accepted" : "rejected", { id: u.update_id })], accept ? "happy" : "sit", 200);
      menu(data);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ composer */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    setText("");
    const q = queue.current[idx.current];
    if (mode === "date" && q) {
      me(m("saidDate", { d: day(v) }));
      setMode("text");
      await confirm({ change_type: v > q.due_date ? "PAYMENT_DELAY" : "PAYMENT_PROMISE", subject_id: q.subject_id, proposed_date: v }, q);
    } else if (mode === "note" && q) {
      me(v);
      setMode("text");
      await confirm({ change_type: "DISPUTE", subject_id: q.subject_id, note: v }, q);
    } else if (mode === "supplier") {
      me(v);
      purchase.current.supplier = v;
      if (await mo([m("amountQ")], "calc", 250)) setMode("amount");
    } else if (mode === "amount") {
      me(v);
      const amount = readVnd(v);
      if (amount == null) {
        await mo([m("badAmount")], "umbrella", 200);
        return;
      }
      purchase.current.amount = amount;
      if (await mo([m("dateQ")], "calc", 250)) {
        setMode("pdate");
        setText(checkinRef.current?.as_of ?? "");
      }
    } else if (mode === "pdate") {
      me(day(v));
      purchase.current.date = v;
      if (await mo([m("noteQ")], "book", 250)) {
        setMode("pnote");
        setChips([{ label: m("send"), primary: true, run: () => void finishPurchase("") }]);
      }
    } else if (mode === "pnote") {
      me(v);
      await finishPurchase(v);
    } else {
      await ask(v);
    }
  };

  const finishPurchase = async (note: string) => {
    const p = purchase.current;
    setMode("text");
    await confirm({ change_type: "PURCHASE_COMMITMENT", counterparty: p.supplier, amount_vnd: p.amount, proposed_date: p.date, note });
  };

  /* ------------------------------------------------------------ lifecycle */
  const restart = async () => {
    run.current += 1;
    setMsgs([]);
    setChips([]);
    setMode("text");
    setTyping(false);
    flow.current = "menu";
    try {
      const data = await refresh();
      const n = data.questions.length;
      const r = reviewCount(data);
      const second =
        user.role === "sme_procurement" ? m("helloBuy")
        : user.role === "sme_hr" ? m("helloHr")
        : user.role === "sme_accountant" && r > 0 ? m("helloFin", { n: r })
        : user.role === "sme_director" && awaitingApproval ? m("helloDir")
        : n > 0 ? m("helloQ", { n }) : m("helloNone");
      const ok = await mo([m("hello", { name: first }), second], "wave", 380);
      if (ok) menu(data);
    } catch (e) {
      fail(e);
      menu(null);
    }
  };

  // Other screens (imports, reviews) tell Mo to reload what it knows.
  useEffect(() => {
    const again = () => void refresh().catch(() => undefined);
    window.addEventListener("mo:updated", again);
    return () => window.removeEventListener("mo:updated", again);
  }, [refresh]);

  // Load the check-in quietly so the button can show a badge and Mo can peek once per session.
  useEffect(() => {
    let alive = true;
    refresh()
      .then(() => {
        if (!alive) return;
        let seen = false;
        try { seen = sessionStorage.getItem(PEEK_KEY) === "1"; } catch { /* private mode */ }
        if (!seen) setTimeout(() => alive && setPeek(true), 1800);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [refresh]);

  const restartRef = useRef(restart);
  restartRef.current = restart;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    setPeek(false);
    try { sessionStorage.setItem(PEEK_KEY, "1"); } catch { /* ignore */ }
    if (!started.current) {
      started.current = true;
      void restartRef.current();
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    const focus = setTimeout(() => input.current?.focus({ preventScroll: true }), 320);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(focus); };
  }, [open]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typing, chips.length]);

  useEffect(() => {
    if (mode !== "text") input.current?.focus({ preventScroll: true });
  }, [mode]);

  const role = user.role;
  const badge = role === "sme_accountant" ? reviewCount(checkin)
    : role === "sme_director" ? (awaitingApproval ? 1 : 0)
    : role === "sme_procurement" || role === "sme_hr" ? 0
    : checkin?.questions.length ?? 0;
  // The side bar shows the same number next to "My updates".
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mo:counts", { detail: role === "sme_director" || role === "sme_hr" ? 0 : role === "sme_accountant" ? reviewCount(checkin) : checkin?.questions.length ?? 0 }));
  }, [checkin, role]);
  const placeholder = mode === "note" || mode === "pnote" ? m("placeholderNote") : mode === "supplier" ? m("supplier") : mode === "amount" ? "150000000" : m("placeholder");
  const dateMode = mode === "date" || mode === "pdate";

  return (
    <>
      {/* Floating Mo */}
      <div className={"mo-fab-wrap" + (open ? " hidden" : "")}>
        {peek && !open && (
          <div className="mo-peek glass" role="status">
            <button type="button" className="mo-peek-x" aria-label="×" onClick={() => { setPeek(false); try { sessionStorage.setItem(PEEK_KEY, "1"); } catch { /* ignore */ } }}>×</button>
            <button type="button" className="mo-peek-body" onClick={onOpen}>{role === "sme_accountant" && badge > 0 ? m("peekFin", { n: badge }) : role === "sme_director" && badge > 0 ? m("peekDir") : role === "sme_procurement" ? m("helloBuy") : role === "sme_hr" ? m("helloHr") : badge > 0 ? m("peek", { n: badge }) : m("peekNone")}</button>
          </div>
        )}
        <button type="button" className="mo-fab" onClick={onOpen} aria-label={m("open")} aria-expanded={open}>
          <span className="mo-fab-glass" aria-hidden="true" />
          <Mascot pose={peek ? "wave" : "idle"} className="mo-fab-img" />
          {badge > 0 && <span className="mo-badge">{badge}</span>}
        </button>
      </div>

      {/* Chat panel */}
      <section className={"mo-panel glass-strong" + (open ? " open" : "")} aria-label={m("role")} aria-hidden={!open}>
        <div className="mo-perch" aria-hidden="true"><Mascot pose={typing ? "laptop" : pose} className="mo-perch-img" /></div>
        <header className="mo-head">
          <div className="mo-id">
            <b>{m("name")}</b>
            <span><i className="mo-dot" />{typing ? m("typing") : m("role")}</span>
          </div>
          <div className="mo-head-actions">
            <button type="button" className="mo-icon" onClick={() => void restart()} aria-label={m("restart")} title={m("restart")} tabIndex={open ? 0 : -1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
            </button>
            <button type="button" className="mo-icon" onClick={onClose} aria-label={m("close")} title={m("close")} tabIndex={open ? 0 : -1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 15l6-6 6 6" transform="rotate(180 12 12)" /></svg>
            </button>
          </div>
        </header>

        <div className="mo-log" ref={log} aria-live="polite">
          {msgs.map((msg) => (
            <Bubble key={msg.id} m={msg} say={m} tr={tr} money={money} day={day} checkin={checkin} me={user.user_id} busy={busy} decide={decide} />
          ))}
          {typing && (
            <div className="mo-msg mo"><div className="mo-bubble mo-typing" aria-label={m("typing")}><i /><i /><i /></div></div>
          )}
        </div>

        {chips.length > 0 && (
          <div className="mo-chips" key={chips.map((c) => c.label).join("|")}>
            {chips.map((c, i) => (
              <button key={c.label} type="button" className={"mo-chip" + (c.primary ? " primary" : "")} style={{ animationDelay: i * 35 + "ms" }} onClick={c.run} disabled={busy} tabIndex={open ? 0 : -1}>{c.label}</button>
            ))}
          </div>
        )}

        <form className="mo-compose" onSubmit={(e) => void submit(e)}>
          <label className="sr-only" htmlFor="moInput">{m("placeholder")}</label>
          <input
            id="moInput" ref={input} className="mo-input" type={dateMode ? "date" : "text"} value={text}
            onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off" tabIndex={open ? 0 : -1}
            inputMode={mode === "amount" ? "numeric" : undefined}
          />
          <button type="submit" className="mo-send" aria-label={m("sendMsg")} disabled={!text.trim() || busy} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ bubbles */
function Bubble({ m, say, tr, money, day, checkin, me, busy, decide }: {
  m: Msg;
  say: ReturnType<typeof moCopy>;
  tr: (key: string, vars?: Record<string, string | number>) => string;
  money: (v: number | undefined, cur?: string) => string;
  day: (iso?: string | null) => string;
  checkin: Checkin | null;
  me: string;
  busy: boolean;
  decide: (u: OperationalUpdate, accept: boolean) => void;
}) {
  let body: ReactNode;
  if (m.kind === "text") {
    body = (
      <div className="mo-bubble">
        {m.text}
        {m.cites && m.cites.length > 0 && <small className="mo-cites">{say("sources")}: {m.cites.map((c) => c.label || c.source_id).join(" · ")}</small>}
      </div>
    );
  } else if (m.kind === "invoice") {
    const q = m.q;
    const dd = q.days_to_due;
    body = (
      <div className="mo-card">
        <div className="mo-card-top">
          <span className="mo-tag">{q.subject_id}</span>
          <span className={"mo-when" + (dd < 0 ? " late" : dd <= 7 ? " soon" : "")}>{dd < 0 ? say("overdue", { n: -dd }) : say("inDays", { n: dd })}</span>
        </div>
        <b className="mo-card-title">{q.buyer.replace(" (SYNTHETIC)", "")}</b>
        <div className="mo-card-amt">{money(q.amount, q.currency)}</div>
        <dl className="mo-kv">
          <div><dt>{say("due")}</dt><dd>{day(q.due_date)}</dd></div>
          {q.p_on_time != null && <div><dt>{say("onTimeRate", { p: Math.round(q.p_on_time * 100) })}</dt><dd><span className="mo-meter"><i style={{ width: Math.round(q.p_on_time * 100) + "%" }} /></span></dd></div>}
        </dl>
        <p className="mo-card-q">{say("askLine")}</p>
      </div>
    );
  } else if (m.kind === "confirm") {
    body = (
      <div className={"mo-card confirm " + m.state}>
        <div className="mo-card-top"><b>{m.c.title}</b>{m.state === "sent" && <span className="mo-stamp">✓ {say("status_PENDING_REVIEW")}</span>}</div>
        <dl className="mo-kv">
          {m.c.rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <small className="mo-foot">{m.c.foot}</small>
      </div>
    );
  } else if (m.kind === "autopilot") {
    const r = m.run;
    const rec = r.recommendation;
    const icon = (st: string) => (st === "completed" ? "✓" : st === "proposed" ? "•" : "!");
    body = (
      <div className="mo-card mo-ap">
        <div className="mo-card-top"><b>Autopilot</b><span className={"mo-tag soft" + (r.mode === "execute" ? " done" : "")}>{say(r.mode === "execute" ? "apModeExec" : "apModePlan")}</span></div>
        <ol className="mo-steps">
          {r.steps.map((st) => (
            <li key={st.n} className={st.status}>
              <i>{icon(st.status)}</i>
              <details>
                <summary>{tr(`mo.tool_${st.tool}`) === `mo.tool_${st.tool}` ? st.tool : tr(`mo.tool_${st.tool}`)}</summary>
                <p>{st.result}</p>
              </details>
            </li>
          ))}
        </ol>
        {rec && (
          <div className="mo-rec">
            <small>{say("apRec")}</small>
            <b>{rec.option_name.replace(" (SYNTHETIC)", "")}</b>
            <dl className="mo-kv">
              <div><dt>{say("amount")}</dt><dd>{money(rec.amount_usd, "USD")}</dd></div>
              <div><dt>{say("apApr")}</dt><dd>{rec.apr_pct.toFixed(2)}%</dd></div>
              <div><dt>{say("apCost")}</dt><dd>{money(rec.total_cost_usd, "USD")}</dd></div>
            </dl>
          </div>
        )}
        <small className="mo-foot"><b>{say("apNext")}</b> {r.human_handoff.who}: {r.human_handoff.action}</small>
      </div>
    );
  } else {
    const items = (checkin?.updates ?? []).filter((u) => u.status === "PENDING_REVIEW");
    body = (
      <div className="mo-card">
        <div className="mo-card-top"><b>{say("queueTitle")}</b></div>
        {items.length === 0 && <p className="mo-card-q">{say("queueEmpty")}</p>}
        <ul className="mo-queue">
          {items.map((u) => (
            <li key={u.update_id}>
              <div>
                <b>{u.subject_id === "NEW-PURCHASE" || u.subject_id === "HIRING-PLAN" ? u.counterparty : u.subject_id}</b>
                <span className="mo-tag soft">{say(("type_" + u.change_type) as CopyKey)}</span>
                <small>
                  {u.change_type === "PURCHASE_COMMITMENT" || u.change_type === "HIRING_PLAN" ? money(u.amount_vnd, "VND") : (u.counterparty ?? "").replace(" (SYNTHETIC)", "")}
                  {u.proposed_date ? " · " + day(u.proposed_date) : ""} · {u.author}
                </small>
              </div>
              {u.author === me ? (
                <small className="muted">{say("yours")}</small>
              ) : (
                <span className="mo-qa">
                  <button type="button" className="mo-chip primary sm" disabled={busy} onClick={() => decide(u, true)}>{say("accept")}</button>
                  <button type="button" className="mo-chip sm" disabled={busy} onClick={() => decide(u, false)}>{say("reject")}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <div className={"mo-msg " + m.from}>{body}</div>;
}
