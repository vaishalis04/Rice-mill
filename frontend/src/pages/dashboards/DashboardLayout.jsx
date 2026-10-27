import { useEffect, useRef, useState } from "react";
import "../../styles/theme-teal.css";
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
 *
 * `theme` is purely visual and defaults to "teal" (the Cream Canvas look in
 * styles/theme-teal.css, used by every role). Pass `theme={null}` to render the
 * legacy look. When set (e.g. "teal") the shell
 * gets a `theme-<name>` class that a role-specific stylesheet can hook into
 * (see styles/theme-teal.css), plus a brand block at the top of the sidebar.
 * With `theme={null}` the shell renders exactly as it did before the redesign.
 */
export default function DashboardLayout({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
  roleLabel,
  theme = "teal",
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSidebar = Array.isArray(tabs) && tabs.length > 0;
  const sidebarRef = useRef(null);

  // Long menus: keep the active item in view inside the sidebar (it scrolls on
  // its own), and open it scrolled to that item on mobile.
  useEffect(() => {
    const nav = sidebarRef.current;
    const item = nav && nav.querySelector(".dash-sidebar-item.active");
    if (!nav || !item) return;
    const pad = 8;
    if (item.offsetTop < nav.scrollTop + pad) {
      nav.scrollTop = Math.max(0, item.offsetTop - pad);
    } else if (item.offsetTop + item.offsetHeight > nav.scrollTop + nav.clientHeight - pad) {
      nav.scrollTop = item.offsetTop + item.offsetHeight - nav.clientHeight + pad;
    }
  }, [activeTab, sidebarOpen]);

  // Switching tabs starts the new page at the top instead of mid-scroll.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeTab]);

  // While the mobile menu is open, the page behind it must not scroll.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const handleTabClick = (key) => {
    if (onTabChange) onTabChange(key);
    setSidebarOpen(false);
  };

  return (
    <div className={`dash-wrapper${theme ? ` theme-${theme}` : ""}${theme && !hasSidebar ? " no-sidebar" : ""}`}>
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
                {roleLabel || ROLE_NAME[user?.role_id] || "Unknown role"}
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
            <nav ref={sidebarRef} className={`dash-sidebar ${sidebarOpen ? "open" : ""}`}>
              {theme && (
                <div className="dash-brand">
                  <span className="dash-brand-mark">RM</span>
                  <span className="dash-brand-name">Rice Mill ERP</span>
                </div>
              )}
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