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
import AdvisoryTrucksPage from "../admin/AdvisoryTrucksPage";
import UserApprovalsPage from "../admin/UserApprovalsPage";
import { usePermissionFilteredTabs } from "../../hooks/usePermissionFilteredTabs";
import { permissionCode } from "../../config/pageCatalog";

const ALL_TABS = [
  { key: "dashboard", label: "Dashboard" }, // no code — always visible, it's just the landing overview
  { key: "master", label: "Master Settings", code: permissionCode("admin", "master_settings") },
  { key: "vehicles", label: "Vehicles & Drivers", code: permissionCode("admin", "vehicles_drivers") },
  { key: "customers", label: "Customers", code: permissionCode("admin", "customers") },
  { key: "vendors", label: "Vendors", code: permissionCode("admin", "vendors") },
  { key: "purchaseApproval", label: "PO Approval", code: permissionCode("admin", "po_approval") },
  { key: "salesApproval", label: "SO Approval", code: permissionCode("admin", "so_approval") },
  { key: "users", label: "Users", code: permissionCode("admin", "users") },
  { key: "userApprovals", label: "User Approvals", code: permissionCode("admin", "user_approvals") },
  { key: "visitors", label: "Visitors", code: permissionCode("admin", "visitors") },
  { key: "reports", label: "Reports", code: permissionCode("admin", "reports") },
  { key: "roles", label: "Roles & Permissions", code: permissionCode("admin", "roles") },
  { key: "gateEntry", label: "Gate Entry", code: permissionCode("admin", "gate_entry") },
  { key: "advisoryTrucks", label: "Advisory Trucks", code: permissionCode("admin", "advisory_trucks") },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("dashboard");
  const tabs = usePermissionFilteredTabs(ALL_TABS);

  return (
    <DashboardLayout title="Admin Dashboard" tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === "dashboard" && <AdminAnalyticsPage />}
      {tab === "master" && <MasterSettingsPage />}
      {tab === "vehicles" && <VehiclesDriversPage />}
      {tab === "customers" && <CustomersPage />}
      {tab === "vendors" && <VendorsPage />}
      {tab === "visitors" && <VisitorsPage />}
      {tab === "users" && <UsersPage />}
      {tab === "userApprovals" && <UserApprovalsPage />}
      {tab === "reports" && <ReportsPage />}
      {tab === "purchaseApproval" && <PurchaseOrderApprovalPage />}
      {tab === "salesApproval" && <SalesOrderApprovalPage />}
      {tab === "roles" && <RolesPage />}
      {tab === "gateEntry" && <GateEntryAdminPage />}
      {tab === "advisoryTrucks" && <AdvisoryTrucksPage />}
    </DashboardLayout>
  );
}