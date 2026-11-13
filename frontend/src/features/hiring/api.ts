import { download, post, request, get } from "@/shared/api/client";

export interface Fit { opening_id: string; score: number; verdict: "interview" | "consider" | "not_fit"; matched: string[]; missing: string[]; flags: string[]; parts: Record<string, number> }
export interface Cv {
  cv_id: string; name: string | null; headline: string | null; email: string | null; phone: string | null; years: number | null;
  education: string; skill_labels: string[]; expected_salary_vnd: number | null; source: string; method: string; missing: string[];
  fits: Fit[]; best: Fit;
  salary: { band: [number, number]; recommended: { low: number; high: number; point: number }; expected: number | null; expected_vs_band: string | null };
}
export interface Opening {
  id: string; title: string; title_en: string; needed: number; filled: number; gap: number; covered: number; level: string; min_years: number;
  start: string; band_vnd: [number, number]; must_labels: string[]; nice_labels: string[]; probation_max_days: number;
  shortlist: Array<{ cv_id: string; name: string; score: number; verdict: string; missing: string[] }>;
}
export interface BudgetRow { opening_id: string; title: string; seats: number; from_candidates: number; gross_monthly_vnd: number; monthly_cost_vnd: number; first_year_vnd: number; one_off_vnd: number; start_month: string }
export interface Overview {
  openings: Opening[]; cvs: Cv[];
  budget: { rows: BudgetRow[]; monthly_vnd: number; first_year_vnd: number; one_off_vnd: number; earliest_start: string | null };
  assumptions: { employer_contrib_pct: number; recruiting_cost_per_hire_vnd: number };
}
export interface ContractDraft { sections: Array<[string, string]>; checks: string[]; text: string }
export interface ContractBody { cv_id: string; opening_id: string; start_date: string; salary_vnd: number; probation_days: number; probation_pct: number; term_months: number }

export const fetchOverview = () => get<Overview>("/api/hr/overview");
export function uploadCv(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<Cv>("/api/hr/cvs/upload", { method: "POST", body: form });
}
export const addCvText = (text: string) => post<Cv>("/api/hr/cvs/text", { text });
export const removeCv = (id: string) => request<unknown>(`/api/hr/cvs/${encodeURIComponent(id)}`, { method: "DELETE" });
export const submitBudget = () => post<{ update_id: string }>("/api/hr/budget/submit");
export const draftContract = (b: ContractBody) => post<ContractDraft>("/api/hr/contract", b);
export const contractDocx = (b: ContractBody) => download("/api/hr/contract.docx", `HDLD_${b.cv_id}.docx`, { method: "POST", body: b });
export const exportCsv = () => download("/api/hr/cvs.csv", "HR_master_CV.csv");
export const exportXlsx = () => download("/api/hr/cvs.xlsx", "HR_master_CV.xlsx");
