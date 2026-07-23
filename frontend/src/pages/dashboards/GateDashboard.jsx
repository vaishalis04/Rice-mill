import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";
import WeightSlipsPage from "../gate/WeightSlipsPage";

const TABS = [
  { key: "gate-entry", label: "Gate Entry" },
  { key: "weight-slips", label: "Weight Slips" },
];

export default function GateDashboard() {
  const [tab, setTab] = useState("gate-entry");

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

      {tab === "gate-entry" && <GateEntryPage />}
      {tab === "weight-slips" && <WeightSlipsPage />}
    </DashboardLayout>
  );
}
