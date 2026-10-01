import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import SamplingPage from "../quality/SamplingPage";
import LabTestPage from "../quality/LabTestPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "sampling", label: "Sampling", code: permissionCode("lab", "sampling") },
  { key: "lab-tests", label: "Lab Tests", code: permissionCode("lab", "tests") },
];

export default function QualityDashboard() {
  const [tab, setTab] = useState("sampling");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Quality Control Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "sampling" && <SamplingPage />}
      {tab === "lab-tests" && <LabTestPage />}
    </DashboardLayout>
  );
}