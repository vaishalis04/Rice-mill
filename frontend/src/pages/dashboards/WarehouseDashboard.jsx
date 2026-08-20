import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import UnloadingPage from "../warehouse/UnloadingPage";
import LotsPage from "../warehouse/LotsPage";
import WarehousePage from "../warehouse/WarehousePage";
import InventoryPage from "../warehouse/InventoryPage";
import FinishedGoodsPage from "../warehouse/FinishedGoodsPage";
import LoadingPage from "../gate/LoadingPage";

const TABS = [
  { key: "unloading", label: "Unloading" },
  { key: "lots", label: "Lots" },
  { key: "warehouse", label: "Warehouse / Bin / Stack" },
  { key: "inventory", label: "Inventory" },
  { key: "finished_goods", label: "Finished Goods" },
  // Moved here from the Gate dashboard — this is where an outbound Sales
  // truck's actual loaded qty (and, for a multi-material Sales Order,
  // which material) gets recorded, once Gate has already checked it in.
  { key: "loading", label: "Loading" },
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
      {tab === "loading" && <LoadingPage />}
    </DashboardLayout>
  );
}