import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "../components/ProtectedRoute";
import { ROLE_ID } from "../constants/roles";

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
import GateDashboard from "../pages/dashboards/GateDashboard";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.admin]}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/owner/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.owner]}>
            <OwnerDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/manager/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.manager]}>
            <ManagerDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/accounts/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.accountant]}>
            <AccountantDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/purchase/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.purchase]}>
            <PurchaseDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/sales/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.sales]}>
            <SalesDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/warehouse/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.warehouse]}>
            <WarehouseDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/quality/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.quality, ROLE_ID.lab]}>
            <QualityDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/transport/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.transport]}>
            <TransportDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/hr/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.hr]}>
            <HrDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/gate/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.gate]}>
            <GateDashboard />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}