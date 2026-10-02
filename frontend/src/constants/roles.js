export const ROLE_ID = {
  admin: 9,
  purchase: 2,
  gate: 3,
  lab: 4,
  warehouse: 5,
  production: 10,
  sales: 7,
  dispatch: 8,
  weighbridge: 6,
  // The old duplicate "weighbridgeLegacy" (role_id 11) is retired — role_id
  // 6 is now the only Weighbridge role. app.js does this cleanup
  // automatically on boot (soft-deletes role_id 11, only if unused).
  //
  // "advisory" is a NEW role (Advisory Trucks + Payment Settlement Advice).
  // app.js created it automatically on boot — confirmed from the server
  // log as id = 14 (there were already a couple of other custom roles
  // created earlier, e.g. via registration approval testing, before this
  // one was added — hence 14, not 12).
  advisory: 14,
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
  [ROLE_ID.weighbridge]: "weighbridge",
  [ROLE_ID.advisory]: "advisory",
};

// Built-in role lookup by NAME (lowercase). The role NAME is the stable
// identity of a built-in role — ids can drift between databases (e.g. an
// old duplicate "weighbridge" role with id 11 next to the real id 6), and
// the backend itself already authorizes by role name. Returns the
// canonical built-in role_id for a role name, or null for a custom role.
export const BUILTIN_ROLE_ID_BY_NAME = Object.fromEntries(
  Object.entries(ROLE_NAME).map(([id, name]) => [name, Number(id)])
);
export const builtinRoleIdFromName = (name) =>
  BUILTIN_ROLE_ID_BY_NAME[String(name || "").trim().toLowerCase()] ?? null;

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
  [ROLE_ID.weighbridge]: "/weighbridge/dashboard",
  [ROLE_ID.advisory]: "/advisory/dashboard",
};

// role_id -> the one permission `module` (config/pageCatalog.js) that
// role's fixed dashboard actually renders pages for. Used at login to spot
// when a user has been granted pages OUTSIDE their role's own dashboard
// (e.g. a "warehouse" role also handed Lab Tests and PO Approval) — a
// fixed dashboard like WarehouseDashboard only ever imports Warehouse
// pages, so those extras could never actually show up there no matter what
// they're granted. See Login.jsx: when that happens, send them to
// /dashboard (CustomRoleDashboard) instead, which renders any page from
// any module the user's actually been granted — including their role's
// own pages, so nothing is lost.
export const ROLE_HOME_MODULE = {
  [ROLE_ID.admin]: "admin",
  [ROLE_ID.purchase]: "purchase",
  [ROLE_ID.gate]: "gate",
  [ROLE_ID.lab]: "lab",
  [ROLE_ID.warehouse]: "warehouse",
  [ROLE_ID.production]: "production",
  [ROLE_ID.sales]: "sales",
  [ROLE_ID.dispatch]: "dispatch",
  [ROLE_ID.weighbridge]: "weighbridge",
  [ROLE_ID.advisory]: "advisory",
};

// A role_id not present in ROLE_ROUTES above is a custom role (created via
// Admin > Roles & Permissions) — it lands on the generic permission-driven
// dashboard instead of a dead-end back at /login.
export const DEFAULT_ROUTE = "/dashboard";