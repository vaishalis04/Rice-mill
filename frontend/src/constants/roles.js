// Numeric role IDs from your backend
export const ROLE_ID = {
  owner: 1,
  manager: 2,
  admin: 3,
  purchase: 4,
  sales: 5,
  warehouse: 6,
  quality: 7,
  lab: 8,
  hr: 9,
  gate: 10,
  accountant: 12,
  transport: 13,
};

// role_id -> readable name
export const ROLE_NAME = {
  [ROLE_ID.owner]: "owner",
  [ROLE_ID.manager]: "manager",
  [ROLE_ID.admin]: "admin",
  [ROLE_ID.purchase]: "purchase",
  [ROLE_ID.sales]: "sales",
  [ROLE_ID.warehouse]: "warehouse",
  [ROLE_ID.quality]: "quality",
  [ROLE_ID.lab]: "lab",
  [ROLE_ID.hr]: "hr",
  [ROLE_ID.gate]: "gate",
  [ROLE_ID.accountant]: "accountant",
  [ROLE_ID.transport]: "transport",
};

// role_id -> landing page after login
export const ROLE_ROUTES = {
  [ROLE_ID.owner]: "/owner/dashboard",
  [ROLE_ID.manager]: "/manager/dashboard",
  [ROLE_ID.admin]: "/admin/dashboard",
  [ROLE_ID.purchase]: "/purchase/dashboard",
  [ROLE_ID.sales]: "/sales/dashboard",
  [ROLE_ID.warehouse]: "/warehouse/dashboard",
  [ROLE_ID.quality]: "/quality/dashboard",
  [ROLE_ID.lab]: "/quality/dashboard",
  [ROLE_ID.hr]: "/hr/dashboard",
  [ROLE_ID.gate]: "/gate/dashboard",
  [ROLE_ID.accountant]: "/accounts/dashboard",
  [ROLE_ID.transport]: "/transport/dashboard",
};

export const DEFAULT_ROUTE = "/login";