import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "@/shared/i18n";

/** Hero visual: just Mo the otter. It breathes, changes expression on its own, leans toward the pointer,
 *  and hops to the next pose when clicked. No chart, no floating cards. */
const POSES = ["wave", "idea", "laptop", "cheer", "happy", "growth", "headphones", "sit"] as const;

export function HeroMascot() {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const [hop, setHop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const still = useRef(false);

  useEffect(() => {
    still.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still.current) return;
    const id = setInterval(() => setI((n) => (n + 1) % POSES.length), 2800);
    return () => clearInterval(id);
  }, []);

  const next = () => {
    setI((n) => (n + 1) % POSES.length);
    setHop((h) => h + 1);
  };

  const lean = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el || still.current) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--rx", (x * 10).toFixed(2) + "deg");
    el.style.setProperty("--tx", (x * 14).toFixed(1) + "px");
    el.style.setProperty("--ty", (y * 8).toFixed(1) + "px");
  };
  const reset = () => {
    const el = box.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--tx", "0px");
    el.style.setProperty("--ty", "0px");
  };

  return (
    <figure className="hero-mo" aria-label={t("heroMo.alt")}>
      <div className="hm-otter-box" ref={box} onPointerMove={lean} onPointerLeave={reset} onClick={next} role="presentation">
        <div className="hm-lean">
          <div className="hm-breathe" key={hop}>
            {POSES.map((p, n) => (
              <img key={p} className={"hm-otter" + (n === i ? " on" : "")} src={`/mascot/${p}.webp`} alt="" draggable={false} />
            ))}
          </div>
        </div>
        <div className="hm-shadow" aria-hidden="true" />
      </div>
      <figcaption className="sr-only">{t("heroMo.alt")}</figcaption>
    </figure>
  );
}
