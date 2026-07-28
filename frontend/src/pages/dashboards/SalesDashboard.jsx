import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import CustomersPage from "../sales/CustomersPage";
import SalesOrdersPage from "../sales/SalesOrdersPage";

const TABS = [
  { key: "customers", label: "Customers" },
  { key: "orders", label: "Sales Orders" },
];

export default function SalesDashboard() {
  const [tab, setTab] = useState("customers");

  return (
    <DashboardLayout title="Sales Dashboard">
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

      {tab === "customers" && <CustomersPage />}
      {tab === "orders" && <SalesOrdersPage />}
    </DashboardLayout>
  );
}
