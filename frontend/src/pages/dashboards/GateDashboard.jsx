import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";

export default function GateDashboard() {
  return (
    <DashboardLayout title="Gate Dashboard">
      <GateEntryPage />
    </DashboardLayout>
  );
}
