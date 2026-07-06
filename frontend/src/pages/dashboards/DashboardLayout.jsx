import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

/**
 * Shared shell for every role dashboard.
 * Each role's page (AdminDashboard.jsx etc.) wraps its own
 * content with this, passing a title. Add role-specific
 * widgets/sections as children.
 */
export default function DashboardLayout({ title, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="dash-wrapper">
      <header className="dash-header">
        <div>
          <h1>{title}</h1>
          <p className="dash-user">
            Signed in as <strong>{user?.name}</strong> ({user?.role})
          </p>
        </div>
        <button className="dash-logout" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <main className="dash-content">
        {children ?? (
          <p style={{ color: "#7a6f60" }}>
            This dashboard is ready — start adding widgets here.
          </p>
        )}
      </main>
    </div>
  );
}
