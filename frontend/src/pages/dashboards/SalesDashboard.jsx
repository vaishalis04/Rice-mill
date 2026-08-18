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
    <DashboardLayout title="Sales Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "customers" && <CustomersPage />}
      {tab === "orders" && <SalesOrdersPage />}
    </DashboardLayout>
  );
}