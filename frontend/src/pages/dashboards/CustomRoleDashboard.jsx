import { useEffect, useState } from "react";
import { getMyPermissionsApi } from "../../api/api";
import DashboardLayout from "./DashboardLayout";

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

// Every page a built-in role dashboard can show, tagged with which
// Permission `module` unlocks it. A custom role sees whichever of these
// it's actually been granted (any action on that module is enough — the
// existing dashboards don't split by action either, "gate" role sees all
// of Gate Entry regardless of which specific action a request needs).
//
// Adding a new module/page to any of the real role dashboards later?
// Add the matching entry here too, or a custom role won't see it.
const TAB_CATALOG = [
  { module: "gate", key: "gate:entry", label: "Gate Entry", Component: GateEntryPage },
  { module: "lab", key: "lab:sampling", label: "Sampling", Component: SamplingPage },
  { module: "lab", key: "lab:tests", label: "Lab Tests", Component: LabTestPage },
  { module: "production", key: "production:batches", label: "Production Batches", Component: ProductionBatchPage },
  { module: "production", key: "production:machines", label: "Machines", Component: MachinesPage },
  { module: "production", key: "production:packing", label: "Packing", Component: PackingPage },
  { module: "sales", key: "sales:customers", label: "Customers", Component: CustomersPage },
  { module: "sales", key: "sales:orders", label: "Sales Orders", Component: SalesOrdersPage },
  { module: "warehouse", key: "warehouse:unloading", label: "Unloading", Component: UnloadingPage },
  { module: "warehouse", key: "warehouse:lots", label: "Lots", Component: LotsPage },
  { module: "warehouse", key: "warehouse:stock", label: "Warehouse / Stock", Component: WarehousePage },
  { module: "warehouse", key: "warehouse:inventory", label: "Inventory", Component: InventoryPage },
  { module: "warehouse", key: "warehouse:fg", label: "Finished Goods", Component: FinishedGoodsPage },
  { module: "warehouse", key: "warehouse:loading", label: "Loading", Component: LoadingPage },
  { module: "purchase", key: "purchase:vendors", label: "Vendors", Component: VendorsPage },
  { module: "purchase", key: "purchase:orders", label: "Purchase Orders", Component: PurchaseOrdersPage },
  { module: "purchase", key: "purchase:negotiations", label: "Negotiations", Component: NegotiationsPage },
  { module: "weighbridge", key: "weighbridge", label: "Weighbridge", Component: WeighbridgePage },
  { module: "dispatch", key: "dispatch", label: "Weighbridge (Dispatch)", Component: WeighbridgePage },
];

export default function CustomRoleDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roleName, setRoleName] = useState("");
  const [grantedModules, setGrantedModules] = useState([]);
  const [tab, setTab] = useState("");

  useEffect(() => {
    getMyPermissionsApi()
      .then((res) => {
        const data = res.data.data ?? res.data;
        setRoleName(data.role_name || "");
        const modules = [
          ...new Set((data.permissions || []).map((p) => p.module)),
        ];
        setGrantedModules(modules);
      })
      .catch(() => setError("Couldn't load your permissions — try refreshing."))
      .finally(() => setLoading(false));
  }, []);

  const visibleTabs = TAB_CATALOG.filter((t) => grantedModules.includes(t.module));

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

  const active = visibleTabs.find((t) => t.key === tab);

  return (
    <DashboardLayout
      title={roleName ? `${roleName} Dashboard` : "Dashboard"}
      tabs={visibleTabs.map((t) => ({ key: t.key, label: t.label }))}
      activeTab={tab}
      onTabChange={setTab}
    >
      {error && <div className="dt-error">{error}</div>}

      {!error && visibleTabs.length === 0 && (
        <div style={{ padding: 24 }}>
          Your role{roleName ? ` ("${roleName}")` : ""} doesn't have any modules
          granted yet. Ask an Admin to grant permissions on the Roles &amp;
          Permissions tab.
        </div>
      )}

      {active && <active.Component />}
    </DashboardLayout>
  );
}