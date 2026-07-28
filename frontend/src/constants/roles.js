export const ROLE_ID = {
  admin: 9,
  purchase: 2,
  gate: 3,
  lab: 4,
  warehouse: 5,
  production: 10,
  sales: 7,
  dispatch: 8,
};

// role_id -> readable name (lowercase as in DB)
export const ROLE_NAME = {
  [ROLE_ID.admin]: "admin",
  [ROLE_ID.purchase]: "purchase",
  [ROLE_ID.gate]: "gate",
  [ROLE_ID.lab]: "lab",
  [ROLE_ID.warehouse]: "warehouse",
  [ROLE_ID.production]: "production",
  [ROLE_ID.sales]: "sales",
  [ROLE_ID.dispatch]: "dispatch",
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