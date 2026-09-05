import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";

// Weighbridge duty now belongs to the Dispatch role's dashboard (see
// DispatchDashboard.jsx) instead of being reachable from here — Gate no
// longer gets a shortcut button to it. This dashboard is just Gate Entry
// (tokening trucks in/out).
export default function GateDashboard() {
  return (
    <DashboardLayout title="Gate Dashboard">
      <GateEntryPage />
    </DashboardLayout>
  );
}