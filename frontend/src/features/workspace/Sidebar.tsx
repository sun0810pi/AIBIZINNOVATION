import { Fragment, useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { useAuth, UserCard } from "../auth";
import { useSnapshotContext } from "@/entities/case";
import { navigationFor } from "./nav";

export function Sidebar({ current, open, onNavigate }: { current: string; open: boolean; onNavigate: () => void }) {
  const { t } = useI18n();
  const { user, can, signOut, switchAccount } = useAuth();
  const { snapshot } = useSnapshotContext();
  const [updates, setUpdates] = useState(0);
  useEffect(() => {
    const on = (e: Event) => setUpdates(Number((e as CustomEvent).detail) || 0);
    window.addEventListener("mo:counts", on);
    return () => window.removeEventListener("mo:counts", on);
  }, []);

  const pending = snapshot?.meta.case_state === "AWAITING_APPROVAL" && can("sme:approve") ? 1 : 0;
  const alerts = snapshot && can("sme:approve") ? snapshot.meta.director_alerts_open ?? 0 : 0;

  return (
    <nav className={"side glass" + (open ? " open" : "")} id="side" aria-label="Sections" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate()}>
      {navigationFor(user).map(([title, items]) => (
        <Fragment key={title}>
          <h4>{t(title)}</h4>
          {items.map((id) => (
            <a key={id} href={"#" + id} aria-current={current === id ? "page" : undefined}>
              {t("nav." + id)}
              {id === "funding" && pending > 0 && <span className="count" data-tip={t("next.approve")}>1</span>}
              {id === "core" && alerts > 0 && <span className="count" data-tip={t("core.inbox")}>{alerts}</span>}
              {id === "updates" && updates > 0 && <span className="count">{updates}</span>}
            </a>
          ))}
        </Fragment>
      ))}
      <h4>{t("grp.account")}</h4>
      <a href="/?stay=1">{t("nav.landing")}</a>
      <button type="button" className="side-btn" onClick={() => void switchAccount()}>{t("app.switch")}</button>
      <button type="button" className="side-btn" id="sideLogout" onClick={() => void signOut()}>{t("app.logout")}</button>
      <div className="side-user"><UserCard user={user} /></div>
    </nav>
  );
}
