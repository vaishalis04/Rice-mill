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
import ProductionDashboard from "../pages/dashboards/ProductionDashboard";
import DispatchDashboard from "../pages/dashboards/DispatchDashboard";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.ADMIN]}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/owner/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.OWNER]}>
            <OwnerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/manager/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.MANAGER]}>
            <ManagerDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/accounts/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.ACCOUNTANT]}>
            <AccountantDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchase/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.PURCHASE]}>
            <PurchaseDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.Sales]}>
            <SalesDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/warehouse/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.WAREHOUSE]}>
            <WarehouseDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/quality/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.QUALITY, ROLE_ID.LAB]}>
            <QualityDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transport/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.TRANSPORT]}>
            <TransportDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hr/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.HR]}>
            <HrDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gate/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.GATE]}>
            <GateDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/production/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.PRODUCTION]}>
            <ProductionDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dispatch/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.DISPATCH]}>
            <DispatchDashboard />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
