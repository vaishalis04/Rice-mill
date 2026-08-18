import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { ROLE_NAME } from "../../constants/roles";
import KpiBar from "../../components/KpiBar";
import Footer from "../../components/Footer";
import "./Dashboard.css";

/**
 * Shared shell for every role dashboard.
 *
 * Each role's page (AdminDashboard.jsx etc.) wraps its own content with
 * this. If it has multiple sections, it passes `tabs` (the same
 * [{key,label}] list it used to render as a horizontal pill bar itself)
 * plus `activeTab`/`onTabChange` — DashboardLayout then renders those as a
 * left-hand sidebar (desktop) that collapses into a hamburger-triggered
 * slide-in drawer on mobile. Dashboards with only one section (e.g.
 * Dispatch) can omit `tabs` entirely and just pass `children`.
 */
export default function DashboardLayout({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSidebar = Array.isArray(tabs) && tabs.length > 0;

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const handleTabClick = (key) => {
    if (onTabChange) onTabChange(key);
    setSidebarOpen(false);
  };

  return (
    <div className="dash-wrapper">
      <header className="dash-header">
        <div className="dash-header-left">
          {hasSidebar && (
            <button
              className="dash-menu-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
          )}
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

      <div className="dash-body">
        {hasSidebar && (
          <>
            {sidebarOpen && (
              <div
                className="dash-sidebar-overlay"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            <nav className={`dash-sidebar ${sidebarOpen ? "open" : ""}`}>
              <div className="dash-sidebar-head">
                <span>Menu</span>
                <button
                  className="dash-sidebar-close"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close menu"
                >
                  ✕
                </button>
              </div>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className={`dash-sidebar-item ${activeTab === t.key ? "active" : ""}`}
                  onClick={() => handleTabClick(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </>
        )}

        <main className="dash-content">
          <KpiBar />
          {children ?? (
            <p style={{ color: "#64748b" }}>
              This dashboard is ready — start adding widgets here.
            </p>
          )}
        </main>
      </div>
      <Footer />
    </div>
  );
}