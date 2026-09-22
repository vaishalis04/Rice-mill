import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import AdminAnalyticsPage from "../admin/AdminAnalyticsPage";
import MasterSettingsPage from "../admin/MasterSettingsPage";
import VehiclesDriversPage from "../admin/VehiclesDriversPage";
import UsersPage from "../admin/UsersPage";
import ReportsPage from "../admin/ReportsPage";
import CustomersPage from "../sales/CustomersPage";
import VendorsPage from "../purchase/VendorsPage";
import PurchaseOrderApprovalPage from "../admin/PurchaseOrderApprovalPage";
import SalesOrderApprovalPage from "../admin/Salesorderapprovalpage";
import RolesPage from "../admin/RolesPage";
import VisitorsPage from "../admin/VisitorsPage";
import GateEntryAdminPage from "../admin/GateEntryAdminPage";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "master", label: "Master Settings" },
  { key: "vehicles", label: "Vehicles & Drivers" },
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "purchaseApproval", label: "PO Approval" },
  { key: "salesApproval", label: "SO Approval" },
  { key: "users", label: "Users" },
  { key: "visitors", label: "Visitors" },
  { key: "reports", label: "Reports" },
  { key: "roles", label: "Roles & Permissions" },
  { key: "gateEntry", label: "Gate Entry" },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("dashboard");

  return (
    <DashboardLayout title="Admin Dashboard" tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {tab === "dashboard" && <AdminAnalyticsPage />}
      {tab === "master" && <MasterSettingsPage />}
      {tab === "vehicles" && <VehiclesDriversPage />}
      {tab === "customers" && <CustomersPage />}
      {tab === "vendors" && <VendorsPage />}
      {tab === "visitors" && <VisitorsPage />}
      {tab === "users" && <UsersPage />}
      {tab === "reports" && <ReportsPage />}
      {tab === "purchaseApproval" && <PurchaseOrderApprovalPage />}
      {tab === "salesApproval" && <SalesOrderApprovalPage />}
      {tab === "roles" && <RolesPage />}
      {tab === "gateEntry" && <GateEntryAdminPage />}
    </DashboardLayout>
  );
}