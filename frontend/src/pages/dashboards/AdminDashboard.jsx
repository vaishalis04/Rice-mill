import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import AdminAnalyticsPage from "../admin/AdminAnalyticsPage";
import MasterSettingsPage from "../admin/MasterSettingsPage";
import VehiclesDriversPage from "../admin/VehiclesDriversPage";
import UsersPage from "../admin/UsersPage";
import ReportsPage from "../admin/ReportsPage";
import CustomersPage from "../sales/CustomersPage";
import VendorsPage from "../purchase/VendorsPage";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "master", label: "Master Settings" },
  { key: "vehicles", label: "Vehicles & Drivers" },
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "users", label: "Users" },
  { key: "reports", label: "Reports" },
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
      {tab === "users" && <UsersPage />}
      {tab === "reports" && <ReportsPage />}
    </DashboardLayout>
  );
}