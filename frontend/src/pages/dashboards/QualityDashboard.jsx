import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import SamplingPage from "../quality/SamplingPage";
import LabTestPage from "../quality/LabTestPage";

const TABS = [
  { key: "sampling", label: "Sampling" },
  { key: "lab-tests", label: "Lab Tests" },
];

export default function QualityDashboard() {
  const [tab, setTab] = useState("sampling");

  return (
    <DashboardLayout title="Quality Control Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "sampling" && <SamplingPage />}
      {tab === "lab-tests" && <LabTestPage />}
    </DashboardLayout>
  );
}