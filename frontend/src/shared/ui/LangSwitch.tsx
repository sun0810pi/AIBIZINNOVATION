import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LANGS, useI18n } from "../i18n";

const GLOBE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </svg>
);
const CARET = (
  <svg className="lang-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4.5L6 7.5L9 4.5" />
  </svg>
);

/** Compact language picker: a globe and the current code ("EN ▾") opening a small menu. New languages only need adding to LANGS. */
export function LangSwitch() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const current = LANGS.find((l) => l.id === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    // Focus the selected language so arrow keys work straight away.
    items.current[LANGS.findIndex((l) => l.id === lang)]?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, lang]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.current.findIndex((el) => el === document.activeElement);
    const go = (n: number) => {
      e.preventDefault();
      items.current[(n + LANGS.length) % LANGS.length]?.focus();
    };
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(LANGS.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={"lang-pick" + (open ? " open" : "")} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${current.name}`}
        title={current.name}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {GLOBE}
        <span lang={current.id}>{current.label}</span>
        {CARET}
      </button>
      {open && (
        <div className="lang-menu" role="menu" aria-label="Language" onKeyDown={onMenuKey}>
          {LANGS.map((l, i) => (
            <button
              key={l.id}
              ref={(el) => { items.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === lang}
              lang={l.id}
              onClick={() => { setLang(l.id); close(true); }}
            >
              <span className="lang-code">{l.label}</span>
              <span className="lang-name">{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
