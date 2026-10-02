import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getMyPermissionsApi } from "../../api/api";
import { builtinRoleIdFromName, ROLE_ROUTES, ROLE_HOME_MODULE } from "../../constants/roles";
import DashboardLayout from "./DashboardLayout";
import { permissionCode } from "../../config/pageCatalog";

import GateEntryPage from "../gate/GateEntryPage";
import SamplingPage from "../quality/SamplingPage";
import LabTestPage from "../quality/LabTestPage";
import ProductionBatchPage from "../production/ProductionBatchPage";
import MachinesPage from "../production/MachinesPage";
import PackingPage from "../production/PackingPage";
import CustomersPage from "../sales/CustomersPage";
import SalesOrdersPage from "../sales/SalesOrdersPage";
import UnloadingPage from "../warehouse/UnloadingPage";
import LotsPage from "../warehouse/LotsPage";
import WarehousePage from "../warehouse/WarehousePage";
import InventoryPage from "../warehouse/InventoryPage";
import FinishedGoodsPage from "../warehouse/FinishedGoodsPage";
import LoadingPage from "../gate/LoadingPage";
import VendorsPage from "../purchase/VendorsPage";
import PurchaseOrdersPage from "../purchase/PurchaseOrdersPage";
import NegotiationsPage from "../purchase/NegotiationsPage";
import WeighbridgePage from "../gate/WeighbridgePage";
import MasterSettingsPage from "../admin/MasterSettingsPage";
import VehiclesDriversPage from "../admin/VehiclesDriversPage";
import UsersPage from "../admin/UsersPage";
import UserApprovalsPage from "../admin/UserApprovalsPage";
import VisitorsPage from "../admin/VisitorsPage";
import ReportsPage from "../admin/ReportsPage";
import RolesPage from "../admin/RolesPage";
import PurchaseOrderApprovalPage from "../admin/PurchaseOrderApprovalPage";
import SalesOrderApprovalPage from "../admin/Salesorderapprovalpage";
import GateEntryAdminPage from "../admin/GateEntryAdminPage";
import AdvisoryTrucksPage from "../admin/AdvisoryTrucksPage";

// Every page a built-in role dashboard can show, tagged with the exact
// page-level permission `code` ("<module>.<page>", from
// config/pageCatalog.js) that unlocks it — a custom role/user sees exactly
// the individual pages it's been granted, same page-level granularity the
// named dashboards (Admin, Warehouse, etc.) now use via
// usePermissionFilteredTabs. This deliberately includes the Admin-only
// pages too (Advisory Trucks, Reports, PO/SO Approval, the admin Gate Entry
// view, Users, etc.) so a non-admin user/role can be handed just one of
// those specific admin pages without being made a full Admin.
//
// Adding a new page to any dashboard later? Add the matching entry both
// here and in config/pageCatalog.js, or it can never be granted.
const TAB_CATALOG = [
  { code: permissionCode("gate", "entry"), key: "gate:entry", label: "Gate Entry", Component: GateEntryPage },
  { code: permissionCode("lab", "sampling"), key: "lab:sampling", label: "Sampling", Component: SamplingPage },
  { code: permissionCode("lab", "tests"), key: "lab:tests", label: "Lab Tests", Component: LabTestPage },
  { code: permissionCode("production", "batches"), key: "production:batches", label: "Production Batches", Component: ProductionBatchPage },
  { code: permissionCode("production", "machines"), key: "production:machines", label: "Machines", Component: MachinesPage },
  { code: permissionCode("production", "packing"), key: "production:packing", label: "Packing", Component: PackingPage },
  { code: permissionCode("sales", "customers"), key: "sales:customers", label: "Customers", Component: CustomersPage },
  { code: permissionCode("sales", "orders"), key: "sales:orders", label: "Sales Orders", Component: SalesOrdersPage },
  { code: permissionCode("warehouse", "unloading"), key: "warehouse:unloading", label: "Unloading", Component: UnloadingPage },
  { code: permissionCode("warehouse", "lots"), key: "warehouse:lots", label: "Lots", Component: LotsPage },
  { code: permissionCode("warehouse", "stock"), key: "warehouse:stock", label: "Warehouse / Stock", Component: WarehousePage },
  { code: permissionCode("warehouse", "inventory"), key: "warehouse:inventory", label: "Inventory", Component: InventoryPage },
  { code: permissionCode("warehouse", "finished_goods"), key: "warehouse:fg", label: "Finished Goods", Component: FinishedGoodsPage },
  { code: permissionCode("warehouse", "loading"), key: "warehouse:loading", label: "Loading", Component: LoadingPage },
  { code: permissionCode("purchase", "vendors"), key: "purchase:vendors", label: "Vendors", Component: VendorsPage },
  { code: permissionCode("purchase", "orders"), key: "purchase:orders", label: "Purchase Orders", Component: PurchaseOrdersPage },
  { code: permissionCode("purchase", "negotiations"), key: "purchase:negotiations", label: "Negotiations", Component: NegotiationsPage },
  { code: permissionCode("weighbridge", "weighbridge"), key: "weighbridge", label: "Weighbridge", Component: WeighbridgePage },
  { code: permissionCode("dispatch", "weighbridge"), key: "dispatch", label: "Weighbridge (Dispatch)", Component: WeighbridgePage },
  // ---- Admin-only pages, grantable individually ----
  { code: permissionCode("admin", "master_settings"), key: "admin:master", label: "Master Settings", Component: MasterSettingsPage },
  { code: permissionCode("admin", "vehicles_drivers"), key: "admin:vehicles", label: "Vehicles & Drivers", Component: VehiclesDriversPage },
  { code: permissionCode("admin", "customers"), key: "admin:customers", label: "Customers (Admin)", Component: CustomersPage },
  { code: permissionCode("admin", "vendors"), key: "admin:vendors", label: "Vendors (Admin)", Component: VendorsPage },
  { code: permissionCode("admin", "po_approval"), key: "admin:po_approval", label: "PO Approval", Component: PurchaseOrderApprovalPage },
  { code: permissionCode("admin", "so_approval"), key: "admin:so_approval", label: "SO Approval", Component: SalesOrderApprovalPage },
  { code: permissionCode("admin", "users"), key: "admin:users", label: "Users", Component: UsersPage },
  { code: permissionCode("admin", "user_approvals"), key: "admin:user_approvals", label: "User Approvals", Component: UserApprovalsPage },
  { code: permissionCode("admin", "visitors"), key: "admin:visitors", label: "Visitors", Component: VisitorsPage },
  { code: permissionCode("admin", "reports"), key: "admin:reports", label: "Reports", Component: ReportsPage },
  { code: permissionCode("admin", "roles"), key: "admin:roles", label: "Roles & Permissions", Component: RolesPage },
  { code: permissionCode("admin", "gate_entry"), key: "admin:gate_entry", label: "Gate Entry (Admin)", Component: GateEntryAdminPage },
  { code: permissionCode("admin", "advisory_trucks"), key: "admin:advisory_trucks", label: "Advisory Trucks", Component: AdvisoryTrucksPage },
];

export default function CustomRoleDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roleName, setRoleName] = useState("");
  const [grantedCodes, setGrantedCodes] = useState([]);
  const [tab, setTab] = useState("");

  useEffect(() => {
    getMyPermissionsApi()
      .then((res) => {
        const data = res.data.data ?? res.data;
        setRoleName(data.role_name || "");
        setGrantedCodes((data.permissions || []).map((p) => p.code));
      })
      .catch(() => setError("Couldn't load your permissions — try refreshing."))
      .finally(() => setLoading(false));
  }, []);

  // Built-in roles (weighbridge, warehouse, ...) already own their home
  // module's pages without needing any grant — page-level grants are only
  // REQUIRED for custom roles. So for a built-in role that reaches this
  // page (because an admin also handed it extra pages from other modules),
  // keep its own pages visible too, unless an admin has deliberately
  // curated the role's own pages — same rule usePermissionFilteredTabs
  // applies on the fixed dashboards.
  const builtinRoleId = builtinRoleIdFromName(roleName);
  const homeModule = builtinRoleId ? ROLE_HOME_MODULE[builtinRoleId] : null;
  const homeTabs = homeModule ? TAB_CATALOG.filter((t) => t.code.startsWith(`${homeModule}.`)) : [];
  const hasOwnGrant = homeTabs.some((t) => grantedCodes.includes(t.code));
  const effectiveCodes =
    homeModule && !hasOwnGrant ? [...grantedCodes, ...homeTabs.map((t) => t.code)] : grantedCodes;

  const visibleTabs = TAB_CATALOG.filter((t) => effectiveCodes.includes(t.code));

  useEffect(() => {
    if (!tab && visibleTabs.length > 0) setTab(visibleTabs[0].key);
  }, [visibleTabs, tab]);

  if (loading) {
    return (
      <DashboardLayout title="Dashboard">
        <div style={{ padding: 24 }}>Loading your dashboard…</div>
      </DashboardLayout>
    );
  }

  // A built-in role must never be stranded on the "no pages granted" screen
  // — send it straight to its own dashboard. (Only a custom role with no
  // grants sees that message.)
  if (!error && builtinRoleId && visibleTabs.length === 0 && ROLE_ROUTES[builtinRoleId]) {
    return <Navigate to={ROLE_ROUTES[builtinRoleId]} replace />;
  }

  const active = visibleTabs.find((t) => t.key === tab);

  return (
    <DashboardLayout
      title={roleName ? `${roleName} Dashboard` : "Dashboard"}
      roleLabel={roleName || undefined}
      tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
      activeTab={tab}
      onTabChange={setTab}
    >
      {error && <div className="dt-error">{error}</div>}

      {!error && visibleTabs.length === 0 && (
        <div style={{ padding: 24 }}>
          Your role{roleName ? ` ("${roleName}")` : ""} doesn't have any pages
          granted yet. Ask an Admin to grant permissions on the Roles &amp;
          Permissions tab.
        </div>
      )}

      {active && <active.Component />}
    </DashboardLayout>
  );
}