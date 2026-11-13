import { get, post } from "@/shared/api/client";
import type { AutopilotRun } from "@/entities/autopilot";

export type { AutopilotRun };

export interface Citation { label?: string; source_id?: string }
export interface CfoReply { role: string; text: string; citations?: Citation[]; mode?: string }

export type ChangeType = "ON_TIME" | "PAYMENT_PROMISE" | "PAYMENT_DELAY" | "DISPUTE" | "UNKNOWN" | "PURCHASE_COMMITMENT" | "HIRING_PLAN";

export interface CheckinQuestion {
  subject_id: string;
  buyer: string;
  amount: number;
  currency: string;
  due_date: string;
  days_to_due: number;
  p_on_time: number | null;
  avg_days_late: number | null;
  why: string;
}

export interface OperationalUpdate {
  update_id: string;
  change_type: ChangeType;
  subject_id: string;
  counterparty?: string;
  amount?: number;
  amount_vnd?: number;
  currency?: string;
  contractual_due_date?: string | null;
  proposed_date?: string | null;
  note: string;
  author: string;
  status: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED";
  created_at: string;
  reviewed_by?: string | null;
  applies_to_forecast: boolean;
}

export interface Checkin {
  as_of: string;
  questions: CheckinQuestion[];
  pending_count: number;
  updates: OperationalUpdate[];
  rule: string;
}

export interface Draft {
  subject_id: string;
  buyer: string;
  amount: number;
  currency: string;
  due_date: string;
  change_type: ChangeType;
  proposed_date: string | null;
  note: string;
}

export interface ParseResult { draft: Draft | null; missing: string[]; ids_found: string[] }

export interface SubmitBody {
  change_type: ChangeType;
  subject_id?: string;
  proposed_date?: string | null;
  note?: string;
  counterparty?: string;
  amount_vnd?: number;
}

export const askCfo = (text: string) => post<CfoReply>("/api/ask_cfo", { text });
export const getCheckin = () => get<Checkin>("/api/updates/checkin");
export const parseUpdate = (text: string, message_date?: string) => post<ParseResult>("/api/updates/parse", { text, message_date });
export const submitUpdate = (body: SubmitBody) => post<OperationalUpdate>("/api/updates", body);
export const reviewUpdate = (id: string, accept: boolean, note = "") =>
  post<OperationalUpdate>(`/api/updates/${encodeURIComponent(id)}/review`, { accept, note });

/** execute=false only plans; execute=true (preparer) also drafts the funding pack up to the Director hand-off. */
export const runAutopilot = (execute: boolean) => post<AutopilotRun>("/api/autopilot/run", { execute, goal: "Close the forecast cash gap safely" });
