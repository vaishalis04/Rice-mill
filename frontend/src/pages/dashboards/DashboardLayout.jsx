import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { ROLE_NAME } from "../../constants/roles";
import KpiBar from "../../components/KpiBar";
import Footer from "../../components/Footer";
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
        <div className="dash-header-left">
          <div className="dash-logo">RM</div>
          <div>
            <h1>{title}</h1>
            <p className="dash-user">
              <span className="dash-role-pill">
                {ROLE_NAME[user?.role_id] || "Unknown role"}
              </span>
              <strong>{user?.username}</strong>
              {user?.plant_id ? ` · Plant #${user.plant_id}` : ""}
            </p>
          </div>
        </div>
        <button className="dash-logout" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <main className="dash-content">
        <KpiBar />
        {children ?? (
          <p style={{ color: "#64748b" }}>
            This dashboard is ready — start adding widgets here.
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
}
