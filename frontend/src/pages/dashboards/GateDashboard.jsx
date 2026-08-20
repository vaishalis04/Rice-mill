import { useNavigate } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";

// Weighbridge moved out to its own dashboard (see WeighbridgeDashboard.jsx)
// — it's no longer a tab here. Loading also lives elsewhere now (Warehouse
// dashboard). This dashboard is just Gate Entry (tokening trucks in/out).
export default function GateDashboard() {
  const navigate = useNavigate();

  return (
    <DashboardLayout title="Gate Dashboard">
      <div style={{ marginBottom: 12 }}>
        <button className="dt-btn dt-ghost" onClick={() => navigate("/weighbridge/dashboard")}>
          Open Weighbridge →
        </button>
      </div>
      <GateEntryPage />
    </DashboardLayout>
  );
}