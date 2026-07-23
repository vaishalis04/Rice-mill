import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";
import WeighbridgePage from "../gate/WeighbridgePage";

const TABS = [
  { key: "entry", label: "Gate Entry" },
  { key: "weighbridge", label: "Weighbridge" },
];

export default function GateDashboard() {
  const [tab, setTab] = useState("entry");

  return (
    <DashboardLayout title="Gate Dashboard">
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

      {tab === "entry" && <GateEntryPage />}
      {tab === "weighbridge" && <WeighbridgePage />}
    </DashboardLayout>
  );
}
