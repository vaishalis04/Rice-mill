import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "../components/ProtectedRoute";
import { ROLE_ID } from "../constants/roles";

import Login from "../pages/auth/Login";
import Unauthorized from "../pages/auth/Unauthorized";

import AdminDashboard from "../pages/dashboards/AdminDashboard";
import PurchaseDashboard from "../pages/dashboards/PurchaseDashboard";
import SalesDashboard from "../pages/dashboards/SalesDashboard";
import WarehouseDashboard from "../pages/dashboards/WarehouseDashboard";
import QualityDashboard from "../pages/dashboards/QualityDashboard";
import GateDashboard from "../pages/dashboards/GateDashboard";
import WeighbridgeDashboard from "../pages/dashboards/WeighbridgeDashboard";
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
          <ProtectedRoute allowedRoles={[ROLE_ID.admin]}>
            <AdminDashboard />
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
          <ProtectedRoute allowedRoles={[ROLE_ID.lab]}>
            <QualityDashboard />
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

      <Route
        path="/weighbridge/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.gate]}>
            <WeighbridgeDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/production/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.production]}>
            <ProductionDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/dispatch/dashboard"
        element={
          <ProtectedRoute allowedRoles={[ROLE_ID.dispatch]}>
            <DispatchDashboard />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}