import { download, get, post, request } from "@/shared/api/client";

export interface PreviewRow { row: number; invoice_id: string; customer: string | null; due_date: string | null; currency: string; amount: number | null; outstanding: number | null; status: "NEW" | "CHANGED" | "UNCHANGED" | "ERROR"; was?: { due_date: string | null; outstanding: number | null } }
export interface Preview {
  batch_id: string; kind: string; source: string; header_row: number; mapping: Record<string, string>;
  rows: PreviewRow[]; issues: Array<{ row: number; invoice_id: string; errors: string[] }>;
  counts: { total: number; new: number; changed: number; unchanged: number; errors: number }; control_totals: Record<string, number>;
}
export interface Batch { batch_id: string; source: string; kind: string; applied: number; committed_at: string; committed_by: string; counts: Preview["counts"] }
export interface Status { batches: Batch[]; imported_invoices: number; last_sync: Record<string, string>; templates: string[] }

export const fetchStatus = () => get<Status>("/api/integrations/status");
export function previewFile(file: File, kind: "excel" | "misa") {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  return request<Preview>("/api/integrations/preview/file", { method: "POST", body: form });
}
export const previewSheet = (link: string) => post<Preview>("/api/integrations/preview/gsheet", { link });
export const previewSample = (name: string, kind: string) => post<Preview>("/api/integrations/preview/sample", { name, kind });
export const misaSync = () => post<Preview>("/api/integrations/misa/sync");
export const commit = (batch_id: string, skip_errors: boolean) => post<Batch>("/api/integrations/commit", { batch_id, skip_errors });
export const exportForecast = () => download("/api/integrations/export/forecast.xlsx", "Monetra_forecast.xlsx");
export const template = (name: string) => download(`/api/integrations/templates/${encodeURIComponent(name)}`, name);
