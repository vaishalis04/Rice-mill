import { useState, useEffect } from "react";
import {
  getRoleListApi,
  createRoleApi,
  updateRoleApi,
  deleteRoleApi,
  setRolePermissionsApi,
  getPermissionsCatalogApi,
  createPermissionApi,
  deletePermissionApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import { PAGE_CATALOG, permissionCode } from "../../config/pageCatalog";

const emptyRoleForm = { role_name: "", description: "" };
const emptyPermissionForm = { module: "", page: "" };

const MODULES = [...new Set(PAGE_CATALOG.map((p) => p.module))];
const pagesForModule = (moduleName) => PAGE_CATALOG.filter((p) => p.module === moduleName);
const labelFor = (moduleName, page) =>
  PAGE_CATALOG.find((p) => p.module === moduleName && p.page === page)?.label || page;

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [editingRoleId, setEditingRoleId] = useState(null);

  const [permissionForm, setPermissionForm] = useState(emptyPermissionForm);

  // Which role's permission checklist is currently open, and the
  // (possibly edited but not yet saved) set of checked permission ids.
  const [managingRoleId, setManagingRoleId] = useState(null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [savingPermissions, setSavingPermissions] = useState(false);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([getRoleListApi(), getPermissionsCatalogApi()])
      .then(([rolesRes, permsRes]) => {
        setRoles(rolesRes.data.data ?? rolesRes.data);
        setPermissions(permsRes.data.data ?? permsRes.data);
      })
      .catch(() => setError("Failed to load roles/permissions"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Group the flat permission list by module (dashboard), for the
  // checklist UI — same grouping the page catalog uses.
  const permissionsByModule = permissions.reduce((acc, p) => {
    (acc[p.module] = acc[p.module] || []).push(p);
    return acc;
  }, {});

  // ---------------- Role create/edit ----------------

  const handleRoleChange = (e) => setRoleForm({ ...roleForm, [e.target.name]: e.target.value });

  const handleRoleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (editingRoleId) {
        await updateRoleApi(editingRoleId, roleForm);
        setInfo("Role updated.");
      } else {
        await createRoleApi(roleForm);
        setInfo(`Role "${roleForm.role_name}" created — click "Pages" below to grant it access.`);
      }
      setRoleForm(emptyRoleForm);
      setEditingRoleId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEditRole = (row) => {
    setEditingRoleId(row.id);
    setRoleForm({ role_name: row.role_name, description: row.description || "" });
  };

  const handleCancelRoleEdit = () => {
    setEditingRoleId(null);
    setRoleForm(emptyRoleForm);
  };

  const handleDeleteRole = async (id) => {
    if (!window.confirm("Delete this role? Only possible if no user currently holds it.")) return;
    try {
      await deleteRoleApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed — check that no user still has this role");
    }
  };

  // ---------------- Page-permission checklist per role ----------------

  const handleOpenPermissions = (row) => {
    setError("");
    setInfo("");
    setManagingRoleId(row.id);
    setCheckedIds(new Set(row.permission_ids || []));
  };

  const handleTogglePermission = (permId) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  const handleToggleModule = (modulePerms, allChecked) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      modulePerms.forEach((p) => (allChecked ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const handleSavePermissions = async () => {
    setSavingPermissions(true);
    setError("");
    try {
      await setRolePermissionsApi(managingRoleId, Array.from(checkedIds));
      setInfo("Pages saved.");
      setManagingRoleId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save pages");
    } finally {
      setSavingPermissions(false);
    }
  };

  // ---------------- Permission catalog (which module/page combos exist) ----------------
  // A role/user can only be granted a page once it exists here — this just
  // registers "warehouse.unloading" etc. as a real, grantable Permission
  // row; the checklists above then use it.

  const handlePermissionChange = (e) => {
    const { name, value } = e.target;
    setPermissionForm((prev) => ({ ...prev, [name]: value, ...(name === "module" ? { page: "" } : {}) }));
  };

  const handleAddPermission = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!permissionForm.module) {
      setError("Choose a dashboard/module.");
      return;
    }

    // "All pages" adds every catalog page for this module in one click, so
    // the role checklist below can then tick them individually (or the
    // whole module at once) without registering each page by hand first.
    if (permissionForm.page === "__all__") {
      const pages = pagesForModule(permissionForm.module);
      let added = 0;
      let alreadyExisted = 0;
      for (const p of pages) {
        try {
          await createPermissionApi({ module: permissionForm.module, action: p.page });
          added++;
        } catch (err) {
          if (err.response?.status === 409) {
            alreadyExisted++;
          } else {
            setError(err.response?.data?.message || `Could not add ${permissionForm.module}.${p.page}`);
            load();
            return;
          }
        }
      }
      setInfo(
        `Added ${added} page(s) for "${permissionForm.module}"` +
          (alreadyExisted ? ` (${alreadyExisted} already existed).` : ".") +
          ` Tick individual pages under a role's "Pages" to grant them.`
      );
      setPermissionForm(emptyPermissionForm);
      load();
      return;
    }

    if (!permissionForm.page) {
      setError("Choose a page.");
      return;
    }

    try {
      await createPermissionApi({ module: permissionForm.module, action: permissionForm.page });
      setInfo(`Page "${labelFor(permissionForm.module, permissionForm.page)}" added.`);
      setPermissionForm(emptyPermissionForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add permission");
    }
  };

  const handleDeletePermission = async (id) => {
    if (!window.confirm("Remove this page permission? It will be revoked from every role/user that has it.")) return;
    try {
      await deletePermissionApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const managingRole = roles.find((r) => r.id === managingRoleId);
  const availablePagesForForm = permissionForm.module ? pagesForModule(permissionForm.module) : [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Roles & Permissions</h2>
      <p style={{ color: "#666", marginTop: -8 }}>
        Create custom roles and control exactly which <strong>pages</strong> each one can see — e.g. give the
        Warehouse role just Unloading and Finished Goods, or hand one specific Admin page (like PO Approval) to a
        different role entirely. A role/user only sees pages it's actually been granted here; a dashboard with none
        granted yet shows everything, same as before.
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {/* ---- Create / edit a role ---- */}
      <form className="sf-form" onSubmit={handleRoleSubmit}>
        <div className="sf-field">
          <label>Role Name</label>
          <input name="role_name" value={roleForm.role_name} onChange={handleRoleChange} required />
        </div>
        <div className="sf-field">
          <label>Description (optional)</label>
          <input name="description" value={roleForm.description} onChange={handleRoleChange} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingRoleId ? "Update Role" : "Create Role"}
          </button>
          {editingRoleId && (
            <button type="button" className="sf-cancel" onClick={handleCancelRoleEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* ---- Roles table ---- */}
      <DataTable
        loading={loading}
        rows={roles}
        onEdit={handleEditRole}
        onDelete={handleDeleteRole}
        columns={[
          { key: "role_name", label: "Role Name" },
          { key: "description", label: "Description" },
          {
            key: "permission_count",
            label: "Pages Granted",
            render: (row) => (row.permission_ids || []).length,
          },
          {
            key: "manage",
            label: "",
            render: (row) => (
              <button className="dt-btn" onClick={() => handleOpenPermissions(row)}>
                Pages
              </button>
            ),
          },
        ]}
      />

      {/* ---- Page checklist for the role currently being managed ---- */}
      {managingRoleId && managingRole && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Pages for "{managingRole.role_name}"</h3>
          {Object.keys(permissionsByModule).length === 0 && (
            <p className="field-hint">
              No pages registered yet — add some in the catalog below first.
            </p>
          )}
          {Object.entries(permissionsByModule).map(([moduleName, modulePerms]) => {
            const allChecked = modulePerms.every((p) => checkedIds.has(p.id));
            return (
              <div key={moduleName} style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => handleToggleModule(modulePerms, allChecked)}
                  />
                  {PAGE_CATALOG.find((p) => p.module === moduleName)?.group || moduleName}
                </label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginLeft: 24, marginTop: 4 }}>
                  {modulePerms.map((p) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => handleTogglePermission(p.id)}
                      />
                      {labelFor(p.module, p.action)}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="sf-submit" onClick={handleSavePermissions} disabled={savingPermissions}>
              {savingPermissions ? "Saving..." : "Save Pages"}
            </button>
            <button type="button" className="sf-cancel" onClick={() => setManagingRoleId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Permission catalog (registers which module/page combos exist) ---- */}
      <h3 style={{ marginTop: 32 }}>Page Catalog</h3>
      <p className="field-hint" style={{ marginTop: -8 }}>
        Register the individual pages that can be granted to a role — e.g. dashboard "Warehouse", page "Unloading".
      </p>
      <form className="sf-form" onSubmit={handleAddPermission}>
        <div className="sf-field">
          <label>Dashboard</label>
          <select name="module" value={permissionForm.module} onChange={handlePermissionChange} required>
            <option value="" disabled>
              Select dashboard…
            </option>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {PAGE_CATALOG.find((p) => p.module === m)?.group || m}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-field">
          <label>Page</label>
          <select name="page" value={permissionForm.page} onChange={handlePermissionChange} disabled={!permissionForm.module}>
            <option value="" disabled>
              Select page…
            </option>
            <option value="__all__">All pages on this dashboard</option>
            {availablePagesForForm.map((p) => (
              <option key={p.page} value={p.page}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <button className="sf-submit" type="submit">
          + Add Page
        </button>
      </form>

      <DataTable
        rows={permissions}
        onDelete={handleDeletePermission}
        columns={[
          { key: "module", label: "Dashboard", render: (row) => PAGE_CATALOG.find((p) => p.module === row.module)?.group || row.module },
          { key: "action", label: "Page", render: (row) => labelFor(row.module, row.action) },
          { key: "code", label: "Code" },
        ]}
      />
    </div>
  );
}