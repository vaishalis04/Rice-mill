import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import LotsPage from "../warehouse/LotsPage";
import WarehousePage from "../warehouse/WarehousePage";
import InventoryPage from "../warehouse/InventoryPage";
import FinishedGoodsPage from "../warehouse/FinishedGoodsPage";

const TABS = [
  { key: "lots", label: "Lots / Unloading" },
  { key: "warehouse", label: "Warehouse / Bin / Stack" },
  { key: "inventory", label: "Inventory" },
  { key: "finished_goods", label: "Finished Goods" },
];

export default function WarehouseDashboard() {
  const [tab, setTab] = useState("lots");

  return (
    <DashboardLayout title="Warehouse Dashboard">
      <div className="section-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`section-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lots" && <LotsPage />}
      {tab === "warehouse" && <WarehousePage />}
      {tab === "inventory" && <InventoryPage />}
      {tab === "finished_goods" && <FinishedGoodsPage />}
    </DashboardLayout>
  );
}
