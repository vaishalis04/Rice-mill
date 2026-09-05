export const ROLE_ID = {
  purchase: 2,
  gate: 3,
  lab: 4,
  warehouse: 5,
  sales: 7,
  admin: 9,
  dispatch: 8,
  production: 10,
};

// role_id -> readable name (lowercase as in DB)
// dispatch shows as "weighbridge" here since that role's dashboard now
// does weighbridge work instead of the old dispatch-weight-entry page
// (see DispatchDashboard.jsx) — this is display text only, the actual
// role value used for auth/routing everywhere else is still "dispatch".
export const ROLE_NAME = {
  [ROLE_ID.admin]: "admin",
  [ROLE_ID.purchase]: "purchase",
  [ROLE_ID.gate]: "gate",
  [ROLE_ID.lab]: "lab",
  [ROLE_ID.warehouse]: "warehouse",
  [ROLE_ID.production]: "production",
  [ROLE_ID.sales]: "sales",
  [ROLE_ID.dispatch]: "weighbridge",
};

// role_id -> where to land right after login
export const ROLE_ROUTES = {
  [ROLE_ID.admin]: "/admin/dashboard",
  [ROLE_ID.purchase]: "/purchase/dashboard",
  [ROLE_ID.gate]: "/gate/dashboard",
  [ROLE_ID.lab]: "/quality/dashboard", // or "/lab/dashboard" if you have a separate lab dashboard
  [ROLE_ID.warehouse]: "/warehouse/dashboard",
  [ROLE_ID.production]: "/production/dashboard",
  [ROLE_ID.sales]: "/sales/dashboard",
  [ROLE_ID.dispatch]: "/dispatch/dashboard",
};

export const DEFAULT_ROUTE = "/login";