import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import SamplingPage from "../quality/SamplingPage";
import LabTestPage from "../quality/LabTestPage";
import WeighbridgePage from "../gate/WeighbridgePage";

const TABS = [
  { key: "sampling", label: "Sampling" },
  { key: "lab-tests", label: "Lab Tests" },
  { key: "weighbridge", label: "Weighbridge" },
];

export default function QualityDashboard() {
  const [tab, setTab] = useState("sampling");

  return (
    <DashboardLayout title="Quality Control Dashboard">
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

      {tab === "sampling" && <SamplingPage />}
      {tab === "lab-tests" && <LabTestPage />}
      {tab === "weighbridge" && <WeighbridgePage />}
    </DashboardLayout>
  );
}
