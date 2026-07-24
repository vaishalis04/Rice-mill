import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import ProductionBatchPage from "../production/ProductionBatchPage";
import MachinesPage from "../production/MachinesPage";
import PackingPage from "../production/PackingPage";

const TABS = [
  { key: "batches", label: "Production Batches" },
  { key: "machines", label: "Machines" },
  { key: "packing", label: "Packing" },
];

export default function ProductionDashboard() {
  const [tab, setTab] = useState("batches");

  return (
    <DashboardLayout title="Production Dashboard">
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

      {tab === "batches" && <ProductionBatchPage />}
      {tab === "machines" && <MachinesPage />}
      {tab === "packing" && <PackingPage />}
    </DashboardLayout>
  );
}
