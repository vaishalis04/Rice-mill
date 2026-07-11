// Your backend returns a numeric `role_id`, not a role name string.
// EDIT this mapping to match your real roles table exactly
// (ask backend dev for the roles table, or hit an endpoint like
// GET /roles if one exists, and replace these guesses).

export const ROLE_ID = {
  ADMIN: 4,
  OWNER: 2,
  MANAGER: 3,
  ACCOUNTANT: 1,
  PURCHASE: 5,
  SALES: 6,
  WAREHOUSE: 7,
  QUALITY: 8,
  TRANSPORT: 9,
  HR: 10,
  GATE: 11, // EDIT: confirm real role_id for "gateman" with backend dev
};

// role_id -> readable name (used for display, e.g. "Signed in as ... (Manager)")
export const ROLE_NAME = {
  [ROLE_ID.ADMIN]: "Admin",
  [ROLE_ID.OWNER]: "Owner",
  [ROLE_ID.MANAGER]: "Manager",
  [ROLE_ID.ACCOUNTANT]: "Accountant",
  [ROLE_ID.PURCHASE]: "Purchase Officer",
  [ROLE_ID.SALES]: "Sales Officer",
  [ROLE_ID.WAREHOUSE]: "Warehouse Staff",
  [ROLE_ID.QUALITY]: "Quality Control",
  [ROLE_ID.TRANSPORT]: "Transport",
  [ROLE_ID.HR]: "HR",
  [ROLE_ID.GATE]: "Gateman",
};

// role_id -> where to land right after login
export const ROLE_ROUTES = {
  [ROLE_ID.ADMIN]: "/admin/dashboard",
  [ROLE_ID.OWNER]: "/owner/dashboard",
  [ROLE_ID.MANAGER]: "/manager/dashboard",
  [ROLE_ID.ACCOUNTANT]: "/accounts/dashboard",
  [ROLE_ID.PURCHASE]: "/purchase/dashboard",
  [ROLE_ID.SALES]: "/sales/dashboard",
  [ROLE_ID.WAREHOUSE]: "/warehouse/dashboard",
  [ROLE_ID.QUALITY]: "/quality/dashboard",
  [ROLE_ID.TRANSPORT]: "/transport/dashboard",
  [ROLE_ID.HR]: "/hr/dashboard",
  [ROLE_ID.GATE]: "/gate/dashboard",
};

export const DEFAULT_ROUTE = "/login";
