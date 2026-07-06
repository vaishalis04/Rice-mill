import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "../components/ProtectedRoute";
import { ROLES } from "../constants/roles";

import Login from "../pages/auth/Login";
import Unauthorized from "../pages/auth/Unauthorized";

import AdminDashboard from "../pages/dashboards/AdminDashboard";
import OwnerDashboard from "../pages/dashboards/OwnerDashboard";
import ManagerDashboard from "../pages/dashboards/ManagerDashboard";
import AccountantDashboard from "../pages/dashboards/AccountantDashboard";
import PurchaseDashboard from "../pages/dashboards/PurchaseDashboard";
import SalesDashboard from "../pages/dashboards/SalesDashboard";
import WarehouseDashboard from "../pages/dashboards/WarehouseDashboard";
import QualityDashboard from "../pages/dashboards/QualityDashboard";
import TransportDashboard from "../pages/dashboards/TransportDashboard";
import HrDashboard from "../pages/dashboards/HrDashboard";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/owner/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.OWNER]}>
            <OwnerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/manager/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.MANAGER]}>
            <ManagerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/accounts/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.ACCOUNTANT]}>
            <AccountantDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchase/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.PURCHASE]}>
            <PurchaseDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.SALES]}>
            <SalesDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/warehouse/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.WAREHOUSE]}>
            <WarehouseDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quality/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.QUALITY]}>
            <QualityDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transport/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.TRANSPORT]}>
            <TransportDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hr/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLES.HR]}>
            <HrDashboard />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
