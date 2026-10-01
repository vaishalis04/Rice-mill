import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import AdvisoryTrucksPage from "../admin/AdvisoryTrucksPage";
import PaymentSettlementPage from "../advisory/PaymentSettlementPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

// Advisory Trucks is unchanged on Admin > Advisory Trucks — this just also
// gives the new Advisory role its own home for the same page, plus the new
// Payment Settlement Advice feature.
const ALL_TABS = [
  { key: "advisoryTrucks", label: "Advisory Trucks", code: permissionCode("advisory", "advisory_trucks") },
  { key: "paymentSettlement", label: "Payment Settlement", code: permissionCode("advisory", "payment_settlement") },
];

export default function AdvisoryDashboard() {
  const [tab, setTab] = useState("advisoryTrucks");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Advisory Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "advisoryTrucks" && <AdvisoryTrucksPage />}
      {tab === "paymentSettlement" && <PaymentSettlementPage />}
    </DashboardLayout>
  );
}