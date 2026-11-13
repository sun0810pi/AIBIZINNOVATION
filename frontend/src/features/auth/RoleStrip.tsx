import { Fragment } from "react";
import { useAct } from "@/shared/hooks";
import { useI18n } from "@/shared/i18n";
import { useAuth } from "./AuthProvider";
import { departmentOf, groupByDepartment } from "./departments";

/**
 * Who does what, in the order work moves between departments. The current department is highlighted;
 * in DEMO mode each person is one click away, so a judge can follow one update from Sales to the bank.
 */
export function RoleStrip() {
  const { t } = useI18n();
  const { user, config, viewAs } = useAuth();
  const act = useAct();
  const groups = groupByDepartment(config?.demo_accounts ?? []);
  const mine = departmentOf(user.role);
  const steps = [1, 2, 3, 4].map((n) => groups.filter((g) => g.dept.step === n)).filter((g) => g.length);

  return (
    <div className="role-strip flow-strip">
      <div className="rs-top">
        <span className="pill">{t("role." + user.role)}</span>
        <span className="rs-note">{t("role.note." + user.role)}</span>
      </div>
      {groups.length > 0 && (
        <ol className="flow" aria-label={t("flow.label")}>
          {steps.map((col, i) => (
            <Fragment key={i}>
              {i > 0 && <li className="flow-arrow" aria-hidden="true">→</li>}
              <li className="flow-step">
                {col.map(({ dept, people }) => (
                  <div key={dept.id} className={"flow-dept" + (mine?.id === dept.id ? " on" : "")}>
                    <b>{t("dept." + dept.id)}</b>
                    <span className="flow-verb">{t("dept." + dept.id + ".does")}</span>
                    <span className="flow-people">
                      {people.map((a) => (
                        <button key={a.user_id} type="button" className={"flow-person" + (a.user_id === user.user_id ? " me" : "")}
                          aria-pressed={a.user_id === user.user_id} data-tip={t("app.viewAs") + " " + a.name}
                          onClick={() => void act(() => viewAs(a.user_id))}>
                          <span className="av" aria-hidden="true">{a.initials}</span>{a.name.split(" ").slice(-1)[0]}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </li>
            </Fragment>
          ))}
        </ol>
      )}
    </div>
  );
}
