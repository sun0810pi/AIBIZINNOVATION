import type { I18n } from "@/shared/i18n";

/** Mo's lines live in the shared locale files under "mo."; this keeps the call sites short. */
export type CopyKey = string;

export function moCopy(t: I18n["t"]) {
  return (key: CopyKey, vars?: Record<string, string | number>): string => t("mo." + key, vars);
}
