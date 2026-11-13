import type { SessionUser } from "@/shared/api/session";

export type NavGroup = readonly [titleKey: string, items: readonly string[]];

const ACCOUNTANT: NavGroup[] = [
  ["grp.decide", ["overview", "updates", "evidence", "cash", "funding"]],
  ["grp.analyse", ["analytics", "project", "contracts", "green"]],
  ["grp.control", ["integrations", "trust", "workspace"]],
  ["grp.system", ["settings"]],
];
const DIRECTOR: NavGroup[] = [
  ["grp.decide", ["core", "updates", "funding", "cash"]],
  ["grp.analyse", ["hiring", "analytics", "project", "green"]],
  ["grp.control", ["integrations", "trust", "workspace"]],
  ["grp.system", ["settings"]],
];
const SME_ALL: NavGroup[] = [
  ["grp.decide", ["overview", "updates", "core", "cash", "evidence", "funding"]],
  ["grp.analyse", ["analytics", "project", "contracts", "green"]],
  ["grp.control", ["integrations", "trust", "workspace"]],
  ["grp.system", ["settings"]],
];
/** Sales and purchasing: only their own updates. No balances, forecast or funding. */
const HR: NavGroup[] = [
  ["grp.mywork", ["hiring", "updates"]],
  ["grp.system", ["settings"]],
];
const REPORTER: NavGroup[] = [
  ["grp.mywork", ["updates"]],
  ["grp.system", ["settings"]],
];
const BANK: NavGroup[] = [
  ["grp.review", ["inbox", "trust", "workspace"]],
  ["grp.system", ["settings"]],
];

/**
 * A task-focused projection of the permissions the SERVER issued. It is never the authorization boundary:
 * every API call is checked against the session again.
 */
export function navigationFor(user: SessionUser): NavGroup[] {
  if (user.portal === "bank") return BANK;
  if (user.permissions.includes("sme:hr")) return HR;
  if (!user.permissions.includes("sme:read")) return REPORTER;
  const approve = user.permissions.includes("sme:approve");
  const prepare = user.permissions.includes("sme:prepare");
  if (approve && !prepare) return DIRECTOR;
  if (prepare && !approve) return ACCOUNTANT;
  return SME_ALL;
}

/** Screens a person may open (a hidden link is not a permission, this just keeps the URL tidy). */
export function allowedScreens(user: SessionUser): string[] {
  if (user.portal === "bank") return ["inbox", "case", "workspace", "trust", "settings"];
  const screens = navigationFor(user).flatMap((g) => [...g[1]]);
  // The Autopilot runs inside Mo's chat; its full evidence view stays reachable from there, just not in the menu.
  if (user.permissions.includes("sme:analyze")) screens.push("autopilot");
  return screens;
}
