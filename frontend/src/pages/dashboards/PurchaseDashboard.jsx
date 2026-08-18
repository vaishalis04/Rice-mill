import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import VendorsPage from "../purchase/VendorsPage";
import PurchaseOrdersPage from "../purchase/PurchaseOrdersPage";
import NegotiationsPage from "../purchase/NegotiationsPage";

const TABS = [
  { key: "vendors", label: "Vendors" },
  { key: "orders", label: "Purchase Orders" },
  { key: "negotiations", label: "Negotiations" },
];

export default function PurchaseDashboard() {
  const [tab, setTab] = useState("vendors");

  return (
    <DashboardLayout title="Purchase Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "vendors" && <VendorsPage />}
      {tab === "orders" && <PurchaseOrdersPage />}
      {tab === "negotiations" && <NegotiationsPage />}
    </DashboardLayout>
  );
}