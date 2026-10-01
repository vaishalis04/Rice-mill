import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import ProductionBatchPage from "../production/ProductionBatchPage";
import MachinesPage from "../production/MachinesPage";
import PackingPage from "../production/PackingPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "batches", label: "Production Batches", code: permissionCode("production", "batches") },
  { key: "machines", label: "Machines", code: permissionCode("production", "machines") },
  { key: "packing", label: "Packing", code: permissionCode("production", "packing") },
];

export default function ProductionDashboard() {
  const [tab, setTab] = useState("batches");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Production Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "batches" && <ProductionBatchPage />}
      {tab === "machines" && <MachinesPage />}
      {tab === "packing" && <PackingPage />}
    </DashboardLayout>
  );
}