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
    <DashboardLayout title="Purchase Dashboard">
      <div className="section-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`section-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "vendors" && <VendorsPage />}
      {tab === "orders" && <PurchaseOrdersPage />}
      {tab === "negotiations" && <NegotiationsPage />}
    </DashboardLayout>
  );
}
