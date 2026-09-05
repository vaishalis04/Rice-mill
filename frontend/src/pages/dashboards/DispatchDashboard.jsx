import DashboardLayout from "./DashboardLayout";
import WeighbridgePage from "../gate/WeighbridgePage";

// Was DispatchPage — its own weight-entry step duplicated what Weighbridge
// already does when a loaded truck is weighed out, so this role's
// dashboard now points at Weighbridge instead. DispatchPage/its
// routes/controller are left in place (untouched) in case anything else
// still depends on them — this only changes what the `dispatch` role sees
// as their landing page.
export default function DispatchDashboard() {
  return (
    <DashboardLayout title="Weighbridge">
      <WeighbridgePage />
    </DashboardLayout>
  );
}