// Central place to define all roles and where each one lands after login.
// Edit ROLE names here if your backend uses different values (must match
// the `role` string your API returns on login exactly).

export const ROLES = {
  ADMIN: "admin",
  OWNER: "owner",
  MANAGER: "manager",
  ACCOUNTANT: "accountant",
  PURCHASE: "purchase",
  SALES: "sales",
  WAREHOUSE: "warehouse",
  QUALITY: "quality",
  TRANSPORT: "transport",
  HR: "hr",
};

// Where each role is sent immediately after a successful login.
export const ROLE_ROUTES = {
  [ROLES.ADMIN]: "/admin/dashboard",
  [ROLES.OWNER]: "/owner/dashboard",
  [ROLES.MANAGER]: "/manager/dashboard",
  [ROLES.ACCOUNTANT]: "/accounts/dashboard",
  [ROLES.PURCHASE]: "/purchase/dashboard",
  [ROLES.SALES]: "/sales/dashboard",
  [ROLES.WAREHOUSE]: "/warehouse/dashboard",
  [ROLES.QUALITY]: "/quality/dashboard",
  [ROLES.TRANSPORT]: "/transport/dashboard",
  [ROLES.HR]: "/hr/dashboard",
};

// Fallback if a role has no mapped route yet.
export const DEFAULT_ROUTE = "/login";
