import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import UnloadingPage from "../warehouse/UnloadingPage";
import LotsPage from "../warehouse/LotsPage";
import WarehousePage from "../warehouse/WarehousePage";
import InventoryPage from "../warehouse/InventoryPage";
import FinishedGoodsPage from "../warehouse/FinishedGoodsPage";
import LoadingPage from "../gate/LoadingPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "unloading", label: "Unloading", code: permissionCode("warehouse", "unloading") },
  { key: "lots", label: "Lots", code: permissionCode("warehouse", "lots") },
  { key: "warehouse", label: "Warehouse / Stock", code: permissionCode("warehouse", "stock") },
  { key: "inventory", label: "Inventory", code: permissionCode("warehouse", "inventory") },
  { key: "finished_goods", label: "Finished Goods", code: permissionCode("warehouse", "finished_goods") },
  // Moved here from the Gate dashboard — this is where an outbound Sales
  // truck's actual loaded qty (and, for a multi-material Sales Order,
  // which material) gets recorded, once Gate has already checked it in.
  { key: "loading", label: "Loading", code: permissionCode("warehouse", "loading") },
];

export default function WarehouseDashboard() {
  const [tab, setTab] = useState("unloading");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Warehouse Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "unloading" && <UnloadingPage />}
      {tab === "lots" && <LotsPage />}
      {tab === "warehouse" && <WarehousePage />}
      {tab === "inventory" && <InventoryPage />}
      {tab === "finished_goods" && <FinishedGoodsPage />}
      {tab === "loading" && <LoadingPage />}
    </DashboardLayout>
  );
}