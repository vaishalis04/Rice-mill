// Your backend returns a numeric `role_id`, not a role name string.
// This mapping is taken directly from your real `roles` table
// (id / role_name), confirmed from a DB screenshot on 2026-07-16:
//   2 Manager   3 Admin   4 Purchase   5 Sales   6 Warehouse
//   7 Quality   8 lab     9 HR         10 Gate
//
// ⚠️ NOT CONFIRMED — please double-check with the backend/DB before relying
// on these two:
//   - OWNER: the screenshot started at id 2, so id 1 was never visible.
//     Left as 1 as a guess — confirm, or tell me the real value.
//   - ACCOUNTANT / TRANSPORT: these do NOT appear anywhere in your roles
//     table (2–10 above). Their dashboards exist in the code, but unless
//     there are more rows below id 10 that weren't in the screenshot,
//     these roles may not exist yet on the backend. Left as placeholder
//     ids (12, 13) so nothing crashes, but they won't match any real user
//     until you confirm real ids (or remove the roles if they're not used).
//   - production: same story — not in the roles screenshot. The Production
//     module's own API guide registers a test user with role_id: 6, but 6
//     is already confirmed as Warehouse from your screenshot, so that
//     example was almost certainly just a placeholder/copy-paste value in
//     their doc, not your real id. Left as another unconfirmed placeholder
//     (14) — confirm the real one with your backend dev.

export const ROLE_ID = {
  OWNER: 1, // UNCONFIRMED — see note above
  MANAGER: 2,
  ADMIN: 3,
  PURCHASE: 4,
  SALES: 5,
  WAREHOUSE: 6,
  QUALITY: 7,
  LAB: 8, // "Quality" (7) and "lab" (8) are two SEPARATE roles in your DB
  HR: 9,
  GATE: 10,
  ACCOUNTANT: 12, // UNCONFIRMED — not seen in roles table
  TRANSPORT: 13, // UNCONFIRMED — not seen in roles table
  production: 9, // UNCONFIRMED — not seen in roles table, see note above
};

// role_id -> readable name (used for display, e.g. "Signed in as ... (Manager)")
export const ROLE_NAME = {
  [ROLE_ID.OWNER]: "Owner",
  [ROLE_ID.MANAGER]: "Manager",
  [ROLE_ID.ADMIN]: "Admin",
  [ROLE_ID.PURCHASE]: "Purchase",
  [ROLE_ID.SALES]: "Sales",
  [ROLE_ID.WAREHOUSE]: "Warehouse",
  [ROLE_ID.QUALITY]: "Quality",
  [ROLE_ID.LAB]: "Lab",
  [ROLE_ID.HR]: "HR",
  [ROLE_ID.GATE]: "Gate",
  [ROLE_ID.ACCOUNTANT]: "Accountant",
  [ROLE_ID.TRANSPORT]: "Transport",
  [ROLE_ID.production]: "Production",
};

// role_id -> where to land right after login
export const ROLE_ROUTES = {
  [ROLE_ID.OWNER]: "/owner/dashboard",
  [ROLE_ID.MANAGER]: "/manager/dashboard",
  [ROLE_ID.ADMIN]: "/admin/dashboard",
  [ROLE_ID.PURCHASE]: "/purchase/dashboard",
  [ROLE_ID.SALES]: "/sales/dashboard",
  [ROLE_ID.WAREHOUSE]: "/warehouse/dashboard",
  [ROLE_ID.QUALITY]: "/quality/dashboard",
  [ROLE_ID.LAB]: "/quality/dashboard", // lab role lands on the same Quality area (Sampling/Lab Test pages)
  [ROLE_ID.HR]: "/hr/dashboard",
  [ROLE_ID.GATE]: "/gate/dashboard",
  [ROLE_ID.ACCOUNTANT]: "/accounts/dashboard",
  [ROLE_ID.TRANSPORT]: "/transport/dashboard",
  [ROLE_ID.production]: "/production/dashboard",
};

export const DEFAULT_ROUTE = "/login";
