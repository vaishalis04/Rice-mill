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
    <DashboardLayout title="Production Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "batches" && <ProductionBatchPage />}
      {tab === "machines" && <MachinesPage />}
      {tab === "packing" && <PackingPage />}
    </DashboardLayout>
  );
}