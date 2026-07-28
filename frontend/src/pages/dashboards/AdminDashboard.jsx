import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import MasterSettingsPage from "../admin/MasterSettingsPage";
import VehiclesDriversPage from "../admin/VehiclesDriversPage";
import ReportsPage from "../admin/ReportsPage";

const TABS = [
  { key: "master", label: "Master Settings" },
  { key: "vehicles", label: "Vehicles & Drivers" },
  { key: "reports", label: "Reports" },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("master");

  return (
    <DashboardLayout title="Admin Dashboard">
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

      {tab === "master" && <MasterSettingsPage />}
      {tab === "vehicles" && <VehiclesDriversPage />}
      {tab === "reports" && <ReportsPage />}
    </DashboardLayout>
  );
}
