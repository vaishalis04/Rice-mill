/**
 * Rice Mill ERP — Frontend Scaffold Generator
 * -------------------------------------------
 * Generates a feature-based src/ folder structure matching the 29 modules
 * defined in "Rice Mill ERP — Solution Architecture Document" (Section 5)
 * and the REST API structure (Section 18).
 *
 * USAGE:
 *   1. Copy this file into your frontend project root (same level as package.json)
 *   2. Run:  node generate-structure.mjs
 *
 * It will NOT overwrite existing files (safe to re-run).
 */

import fs from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "src");

// ---- 29 modules from Section 5 of the design doc ----
const MODULES = [
  "gate-management",
  "vendor-portal",
  "vendor-management",
  "purchase-management",
  "sampling",
  "laboratory",
  "negotiation",
  "weighbridge",
  "warehouse-management",
  "inventory",
  "production",
  "dryer-management",
  "machine-management",
  "quality-control",
  "by-product-management",
  "packing",
  "finished-goods",
  "sales-order",
  "dispatch",
  "vehicle-management",
  "gps-tracking",
  "accounts-finance",
  "reports-analytics",
  "dashboard",
  "master-settings",
  "user-management",
  "audit-logs",
  "notifications",
  "maintenance",
];

// slug -> API base path (aligned with Section 18 sample endpoints)
const API_PATHS = {
  "gate-management": "gate-entries",
  "vendor-portal": "vendor-portal",
  "vendor-management": "vendors",
  "purchase-management": "purchases",
  sampling: "sampling",
  laboratory: "lab-tests",
  negotiation: "negotiations",
  weighbridge: "weight-slips",
  "warehouse-management": "stacks",
  inventory: "inventory",
  production: "production-batches",
  "dryer-management": "production-batches", // dryer nested under batch
  "machine-management": "machine-logs",
  "quality-control": "production-batches", // quality-check nested
  "by-product-management": "by-products",
  packing: "packing",
  "finished-goods": "finished-goods",
  "sales-order": "sales-orders",
  dispatch: "dispatches",
  "vehicle-management": "vehicles",
  "gps-tracking": "gps",
  "accounts-finance": "invoices",
  "reports-analytics": "reports",
  dashboard: "dashboard/kpis",
  "master-settings": "settings",
  "user-management": "users",
  "audit-logs": "audit-logs",
  notifications: "webhooks/whatsapp/notify",
  maintenance: "maintenance",
};

function toPascalCase(slug) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileSafe(filePath, content) {
  if (fs.existsSync(filePath)) {
    console.log(`skip (exists): ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content);
  console.log(`created: ${filePath}`);
}

// ---------- Top-level shared folders ----------
const sharedDirs = [
  "api",
  "components/common",
  "components/layout",
  "context",
  "hooks",
  "layouts",
  "routes",
  "utils",
  "constants",
  "features",
];

sharedDirs.forEach((d) => ensureDir(path.join(ROOT, d)));

// ---------- src/api/axiosInstance.js ----------
writeFileSafe(
  path.join(ROOT, "api", "axiosInstance.js"),
  `import axios from "axios";

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  headers: { "Content-Type": "application/json" },
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

export default axiosInstance;
`
);

// ---------- src/constants ----------
writeFileSafe(
  path.join(ROOT, "constants", "roles.js"),
  `// Role-based scopes (see Section 11 - User Permission Matrix)
export const ROLES = {
  ADMIN: "admin",
  GATE_SECURITY: "gate_security",
  SAMPLING_OFFICER: "sampling_officer",
  LAB_TECHNICIAN: "lab_technician",
  PURCHASE_OFFICER: "purchase_officer",
  WEIGHBRIDGE_OPERATOR: "weighbridge_operator",
  WAREHOUSE_MANAGER: "warehouse_manager",
  QA_MANAGER: "qa_manager",
  PRODUCTION_OPERATOR: "production_operator",
  PACKING_OPERATOR: "packing_operator",
  STORE_MANAGER: "store_manager",
  SALES_OFFICER: "sales_officer",
  DISPATCH_MANAGER: "dispatch_manager",
  ACCOUNTANT: "accountant",
};
`
);

writeFileSafe(
  path.join(ROOT, "constants", "status.js"),
  `// Status flow enums (see Section 10 - Status Flow)
export const GATE_ENTRY_STATUS = ["pending", "accepted", "rejected"];
export const LAB_VERDICT = ["accepted", "negotiation", "rejected"];
export const PRODUCTION_STATUS = ["in_progress", "completed", "on_hold"];
export const DISPATCH_STATUS = ["pending", "loaded", "dispatched", "delivered"];
`
);

// ---------- src/context/AuthContext.jsx ----------
writeFileSafe(
  path.join(ROOT, "context", "AuthContext.jsx"),
  `import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const login = (userData) => setUser(userData);
  const logout = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
`
);

// ---------- src/hooks/useAuth.js ----------
writeFileSafe(
  path.join(ROOT, "hooks", "useAuth.js"),
  `import { useAuthContext } from "../context/AuthContext";

export default function useAuth() {
  return useAuthContext();
}
`
);

// ---------- src/layouts ----------
writeFileSafe(
  path.join(ROOT, "layouts", "MainLayout.jsx"),
  `import Sidebar from "../components/layout/Sidebar";
import Header from "../components/layout/Header";
import { Outlet } from "react-router-dom";

export default function MainLayout() {
  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <div style={{ flex: 1 }}>
        <Header />
        <main style={{ padding: "20px" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
`
);

writeFileSafe(
  path.join(ROOT, "layouts", "AuthLayout.jsx"),
  `import { Outlet } from "react-router-dom";

export default function AuthLayout() {
  return (
    <div className="auth-layout">
      <Outlet />
    </div>
  );
}
`
);

// ---------- src/components/layout ----------
writeFileSafe(
  path.join(ROOT, "components", "layout", "Sidebar.jsx"),
  `export default function Sidebar() {
  return <aside className="sidebar">{/* Nav links per module */}</aside>;
}
`
);

writeFileSafe(
  path.join(ROOT, "components", "layout", "Header.jsx"),
  `export default function Header() {
  return <header className="header">{/* Top bar */}</header>;
}
`
);

// keep common components folder tracked in git
writeFileSafe(path.join(ROOT, "components", "common", ".gitkeep"), "");

// ---------- Feature modules ----------
MODULES.forEach((slug) => {
  const pascal = toPascalCase(slug);
  const base = path.join(ROOT, "features", slug);
  ensureDir(path.join(base, "pages"));
  ensureDir(path.join(base, "components"));
  writeFileSafe(path.join(base, "components", ".gitkeep"), "");

  const apiPath = API_PATHS[slug];

  // api.js
  writeFileSafe(
    path.join(base, "api.js"),
    `import axiosInstance from "../../api/axiosInstance";

const BASE = "/${apiPath}";

export const get${pascal}List = (params) => axiosInstance.get(BASE, { params });
export const get${pascal}ById = (id) => axiosInstance.get(\`\${BASE}/\${id}\`);
export const create${pascal} = (data) => axiosInstance.post(BASE, data);
export const update${pascal} = (id, data) => axiosInstance.patch(\`\${BASE}/\${id}\`, data);
export const delete${pascal} = (id) => axiosInstance.delete(\`\${BASE}/\${id}\`);
`
  );

  // pages
  writeFileSafe(
    path.join(base, "pages", `${pascal}List.jsx`),
    `import { useEffect, useState } from "react";
import { get${pascal}List } from "../api";

export default function ${pascal}List() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    get${pascal}List().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>${pascal.replace(/([A-Z])/g, " $1").trim()}</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
`
  );

  writeFileSafe(
    path.join(base, "pages", `${pascal}Form.jsx`),
    `import { useState } from "react";
import { create${pascal} } from "../api";

export default function ${pascal}Form() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await create${pascal}(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
`
  );

  writeFileSafe(
    path.join(base, "pages", `${pascal}Detail.jsx`),
    `import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { get${pascal}ById } from "../api";

export default function ${pascal}Detail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    get${pascal}ById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
`
  );

  // index.js barrel export
  writeFileSafe(
    path.join(base, "index.js"),
    `export { default as ${pascal}List } from "./pages/${pascal}List";
export { default as ${pascal}Form } from "./pages/${pascal}Form";
export { default as ${pascal}Detail } from "./pages/${pascal}Detail";
`
  );
});

// ---------- src/routes/AppRoutes.jsx ----------
const routeImports = MODULES.map((slug) => {
  const pascal = toPascalCase(slug);
  return `import { ${pascal}List, ${pascal}Form, ${pascal}Detail } from "../features/${slug}";`;
}).join("\n");

const routeElements = MODULES.map((slug) => {
  const pascal = toPascalCase(slug);
  return `        <Route path="${slug}" element={<${pascal}List />} />
        <Route path="${slug}/new" element={<${pascal}Form />} />
        <Route path="${slug}/:id" element={<${pascal}Detail />} />`;
}).join("\n");

writeFileSafe(
  path.join(ROOT, "routes", "AppRoutes.jsx"),
  `import { Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
${routeImports}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
${routeElements}
      </Route>
    </Routes>
  );
}
`
);

writeFileSafe(
  path.join(ROOT, "routes", "PrivateRoute.jsx"),
  `import { Navigate, Outlet } from "react-router-dom";
import useAuth from "../hooks/useAuth";

export default function PrivateRoute() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
`
);

// ---------- src/utils ----------
writeFileSafe(
  path.join(ROOT, "utils", "formatDate.js"),
  `export default function formatDate(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
`
);

console.log("\n✅ Scaffold complete: " + MODULES.length + " feature modules generated under src/features/");
console.log("Next steps:\n  1. npm install axios react-router-dom\n  2. Wire <AppRoutes /> into your App.jsx wrapped in <BrowserRouter> and <AuthProvider>\n");
