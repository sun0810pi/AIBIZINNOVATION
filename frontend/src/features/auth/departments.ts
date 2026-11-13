/** One model for departments, roles and accounts, in the order work flows between them. */
export interface Department { id: string; roles: string[]; step: number }

export const DEPARTMENTS: Department[] = [
  { id: "sales", roles: ["sme_sales"], step: 1 },
  { id: "buy", roles: ["sme_procurement"], step: 1 },
  { id: "hr", roles: ["sme_hr"], step: 1 },
  { id: "fin", roles: ["sme_accountant"], step: 2 },
  { id: "dir", roles: ["sme_director"], step: 3 },
  { id: "bank", roles: ["bank_reviewer"], step: 4 },
];

export const departmentOf = (role: string): Department | undefined => DEPARTMENTS.find((d) => d.roles.includes(role));

/** Group accounts by department, keeping the flow order; unknown roles go last. */
export function groupByDepartment<T extends { role: string }>(accounts: T[]): Array<{ dept: Department; people: T[] }> {
  return DEPARTMENTS.map((dept) => ({ dept, people: accounts.filter((a) => dept.roles.includes(a.role)) })).filter((g) => g.people.length > 0);
}
