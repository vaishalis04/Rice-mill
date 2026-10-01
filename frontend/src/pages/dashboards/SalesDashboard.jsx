import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import CustomersPage from "../sales/CustomersPage";
import SalesOrdersPage from "../sales/SalesOrdersPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "customers", label: "Customers", code: permissionCode("sales", "customers") },
  { key: "orders", label: "Sales Orders", code: permissionCode("sales", "orders") },
];

export default function SalesDashboard() {
  const [tab, setTab] = useState("customers");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Sales Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "customers" && <CustomersPage />}
      {tab === "orders" && <SalesOrdersPage />}
    </DashboardLayout>
  );
}