import { useNavigate } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
import WeighbridgePage from "../gate/WeighbridgePage";

// Weighbridge used to be a tab inside Gate Dashboard, alongside Gate Entry.
// It's now its own dashboard (same "gate" role/login as before — nothing
// about who can use it changed, just where it lives), matching how Gate,
// Purchase, Lab etc. are each their own dashboard rather than sub-tabs of
// one another.
export default function WeighbridgeDashboard() {
  const navigate = useNavigate();

  return (
    <DashboardLayout title="Weighbridge Dashboard">
      <div style={{ marginBottom: 12 }}>
        <button className="dt-btn dt-ghost" onClick={() => navigate("/gate/dashboard")}>
          ← Back to Gate Entry
        </button>
      </div>
      <WeighbridgePage />
    </DashboardLayout>
  );
}