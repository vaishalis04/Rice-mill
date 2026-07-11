import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Wrap any route element with this to require login,
 * and optionally restrict it to specific roles.
 *
 * <ProtectedRoute allowedRoles={[ROLE_ID.ADMIN]}>
 *   <AdminDashboard />
 * </ProtectedRoute>
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role_id)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}
