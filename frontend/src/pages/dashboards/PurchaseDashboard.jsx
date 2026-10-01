import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import VendorsPage from "../purchase/VendorsPage";
import PurchaseOrdersPage from "../purchase/PurchaseOrdersPage";
import NegotiationsPage from "../purchase/NegotiationsPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "vendors", label: "Vendors", code: permissionCode("purchase", "vendors") },
  { key: "orders", label: "Purchase Orders", code: permissionCode("purchase", "orders") },
  { key: "negotiations", label: "Negotiations", code: permissionCode("purchase", "negotiations") },
];

export default function PurchaseDashboard() {
  const [tab, setTab] = useState("vendors");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Purchase Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "vendors" && <VendorsPage />}
      {tab === "orders" && <PurchaseOrdersPage />}
      {tab === "negotiations" && <NegotiationsPage />}
    </DashboardLayout>
  );
}