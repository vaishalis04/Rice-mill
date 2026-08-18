import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import UnloadingPage from "../warehouse/UnloadingPage";
import LotsPage from "../warehouse/LotsPage";
import WarehousePage from "../warehouse/WarehousePage";
import InventoryPage from "../warehouse/InventoryPage";
import FinishedGoodsPage from "../warehouse/FinishedGoodsPage";

const TABS = [
  { key: "unloading", label: "Unloading" },
  { key: "lots", label: "Lots" },
  { key: "warehouse", label: "Warehouse / Bin / Stack" },
  { key: "inventory", label: "Inventory" },
  { key: "finished_goods", label: "Finished Goods" },
];

export default function WarehouseDashboard() {
  const [tab, setTab] = useState("unloading");

  return (
    <DashboardLayout title="Warehouse Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "unloading" && <UnloadingPage />}
      {tab === "lots" && <LotsPage />}
      {tab === "warehouse" && <WarehousePage />}
      {tab === "inventory" && <InventoryPage />}
      {tab === "finished_goods" && <FinishedGoodsPage />}
    </DashboardLayout>
  );
}