import { get, post } from "@/shared/api/client";

export interface Question { subject_id: string; buyer: string; amount: number; currency: string; due_date: string; days_to_due: number; p_on_time: number | null }
export interface Update {
  update_id: string; change_type: string; subject_id: string; counterparty?: string; amount?: number; amount_vnd?: number; currency?: string;
  contractual_due_date?: string | null; proposed_date?: string | null; note: string; author: string;
  status: "PENDING_REVIEW" | "ACCEPTED" | "REJECTED"; reviewed_by?: string | null; created_at: string;
}
export interface Checkin { as_of: string; questions: Question[]; updates: Update[]; pending_count: number }

export const fetchCheckin = () => get<Checkin>("/api/updates/checkin");
export const review = (id: string, accept: boolean) => post<Update>(`/api/updates/${encodeURIComponent(id)}/review`, { accept, note: "" });
