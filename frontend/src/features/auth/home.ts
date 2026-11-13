import type { SessionUser } from "@/shared/api/session";

/** Role-based home screen: the lender reviews cases, the Director decides, the accountant works the queue. */
export function homeRoute(user: Pick<SessionUser, "portal" | "permissions">): string {
  if (user.portal === "bank") return "inbox";
  if (user.permissions.includes("sme:hr")) return "hiring";
  if (!user.permissions.includes("sme:read")) return "updates";
  return user.permissions.includes("sme:approve") ? "core" : "overview";
}
