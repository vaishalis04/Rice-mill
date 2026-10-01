// Every page a role or an individual user can be granted, grouped by
// `module` (roughly: which dashboard it lives on). A permission's `code` is
// always `${module}.${page}` — this is what gets stored as
// Permission.module/Permission.action (action now holds a PAGE key, not a
// CRUD verb — see the backend's permission.model.js) and what
// requirePermission() / the dashboards below match against.
//
// Adding a new tab to a dashboard later? Add the matching entry here too,
// or it can never be granted/hidden — and add it to CustomRoleDashboard's
// TAB_CATALOG if a custom role should be able to reach it.
export const PAGE_CATALOG = [
  // ---- Warehouse dashboard ----
  { module: "warehouse", page: "unloading", label: "Unloading", group: "Warehouse" },
  { module: "warehouse", page: "lots", label: "Lots", group: "Warehouse" },
  { module: "warehouse", page: "stock", label: "Warehouse / Stock", group: "Warehouse" },
  { module: "warehouse", page: "inventory", label: "Inventory", group: "Warehouse" },
  { module: "warehouse", page: "finished_goods", label: "Finished Goods", group: "Warehouse" },
  { module: "warehouse", page: "loading", label: "Loading", group: "Warehouse" },

  // ---- Purchase dashboard ----
  { module: "purchase", page: "vendors", label: "Vendors", group: "Purchase" },
  { module: "purchase", page: "orders", label: "Purchase Orders", group: "Purchase" },
  { module: "purchase", page: "negotiations", label: "Negotiations", group: "Purchase" },

  // ---- Sales dashboard ----
  { module: "sales", page: "customers", label: "Customers", group: "Sales" },
  { module: "sales", page: "orders", label: "Sales Orders", group: "Sales" },

  // ---- Quality (Lab) dashboard ----
  { module: "lab", page: "sampling", label: "Sampling", group: "Quality" },
  { module: "lab", page: "tests", label: "Lab Tests", group: "Quality" },

  // ---- Production dashboard ----
  { module: "production", page: "batches", label: "Production Batches", group: "Production" },
  { module: "production", page: "machines", label: "Machines", group: "Production" },
  { module: "production", page: "packing", label: "Packing", group: "Production" },

  // ---- Advisory dashboard ----
  { module: "advisory", page: "advisory_trucks", label: "Advisory Trucks", group: "Advisory" },
  { module: "advisory", page: "payment_settlement", label: "Payment Settlement Advice", group: "Advisory" },

  // ---- Single-page dashboards ----
  { module: "gate", page: "entry", label: "Gate Entry", group: "Gate" },
  { module: "weighbridge", page: "weighbridge", label: "Weighbridge", group: "Weighbridge" },
  { module: "dispatch", page: "weighbridge", label: "Weighbridge (Dispatch)", group: "Dispatch" },

  // ---- Admin dashboard ----
  // Grantable individually so a non-admin user/role can be handed just one
  // of these (e.g. PO Approval) without making them a full Admin.
  { module: "admin", page: "master_settings", label: "Master Settings", group: "Other Pages" },
  { module: "admin", page: "vehicles_drivers", label: "Vehicles & Drivers", group: "Other Pages" },
  { module: "admin", page: "customers", label: "Customers", group: "Other Pages" },
  { module: "admin", page: "vendors", label: "Vendors", group: "Other Pages" },
  { module: "admin", page: "po_approval", label: "PO Approval", group: "Other Pages" },
  { module: "admin", page: "so_approval", label: "SO Approval", group: "Other Pages" },
  { module: "admin", page: "users", label: "Users", group: "Other Pages" },
  { module: "admin", page: "user_approvals", label: "User Approvals", group: "Other Pages" },
  { module: "admin", page: "visitors", label: "Visitors", group: "Other Pages" },
  { module: "admin", page: "reports", label: "Reports", group: "Other Pages" },
  { module: "admin", page: "roles", label: "Roles & Permissions", group: "Other Pages" },
  { module: "admin", page: "gate_entry", label: "Gate Entry (Admin)", group: "Other Pages" },
  { module: "admin", page: "advisory_trucks", label: "Advisory Trucks", group: "Other Pages" },
];

export const permissionCode = (module, page) => `${module}.${page}`;

// Grouped by `group` for a nicer checkbox layout (RolesPage.jsx).
export const PAGE_CATALOG_BY_GROUP = PAGE_CATALOG.reduce((acc, entry) => {
  (acc[entry.group] = acc[entry.group] || []).push(entry);
  return acc;
}, {});