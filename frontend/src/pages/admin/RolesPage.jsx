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

const emptyRoleForm = { role_name: "", description: "" };
const emptyPermissionForm = { module: "", action: "all" };
const ACTIONS = ["create", "read", "update", "delete", "approve"];

// Kept in sync with the modules actually wired into
// `authorizeRoleOrModule(...)` across the route files — a permission for
// a module that isn't in this list wouldn't unlock anything for a custom
// role, so the dropdown only offers ones that do something.
const MODULES = [
  "gate",
  "lab",
  "production",
  "purchase",
  "sales",
  "warehouse",
  "weighbridge",
  "dispatch",
];

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

  // Group the flat permission list by module, for the checklist UI.
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
        setInfo(`Role "${roleForm.role_name}" created — click "Permissions" below to grant it access.`);
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

  // ---------------- Permission checklist per role ----------------

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
      setInfo("Permissions saved.");
      setManagingRoleId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save permissions");
    } finally {
      setSavingPermissions(false);
    }
  };

  // ---------------- Permission catalog (add/remove definitions) ----------------

  const handlePermissionChange = (e) =>
    setPermissionForm({ ...permissionForm, [e.target.name]: e.target.value });

  const handleAddPermission = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!permissionForm.module.trim()) {
      setError("Choose a module.");
      return;
    }

    // "All" isn't a real action in the database (the Permission table's
    // action column doesn't have an "all" value) — it's a shortcut that
    // creates all 5 real actions for this module in one click, so the
    // module-level checkbox further up ("Permissions for <role>") can
    // then grant full create/read/update/delete/approve access in one
    // tick, instead of adding each action to the catalog by hand first.
    if (permissionForm.action === "all") {
      let added = 0;
      let alreadyExisted = 0;
      for (const action of ACTIONS) {
        try {
          await createPermissionApi({ module: permissionForm.module, action });
          added++;
        } catch (err) {
          if (err.response?.status === 409) {
            alreadyExisted++;
          } else {
            setError(err.response?.data?.message || `Could not add ${permissionForm.module}.${action}`);
            load();
            return;
          }
        }
      }
      setInfo(
        `Added ${added} permission(s) for "${permissionForm.module}"` +
          (alreadyExisted ? ` (${alreadyExisted} already existed).` : ".") +
          ` Tick the "${permissionForm.module}" checkbox under a role's Permissions to grant all of them at once.`
      );
      setPermissionForm(emptyPermissionForm);
      load();
      return;
    }

    try {
      await createPermissionApi(permissionForm);
      setInfo(`Permission "${permissionForm.module}.${permissionForm.action}" added.`);
      setPermissionForm(emptyPermissionForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add permission");
    }
  };

  const handleDeletePermission = async (id) => {
    if (!window.confirm("Delete this permission? It will be removed from every role that has it.")) return;
    try {
      await deletePermissionApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const managingRole = roles.find((r) => r.id === managingRoleId);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Roles & Permissions</h2>
      <p style={{ color: "#666", marginTop: -8 }}>
        Create custom roles and control exactly which permissions each one gets. Note: a brand-new
        role only actually restricts/unlocks pages that have been specifically wired up to check
        permissions — see the note in <code>auth.middleware.js</code> for which pages that covers
        today.
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
            label: "Permissions Granted",
            render: (row) => (row.permission_ids || []).length,
          },
          {
            key: "manage",
            label: "",
            render: (row) => (
              <button className="dt-btn" onClick={() => handleOpenPermissions(row)}>
                Permissions
              </button>
            ),
          },
        ]}
      />

      {/* ---- Permission checklist for the role currently being managed ---- */}
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
          <h3 style={{ marginTop: 0 }}>Permissions for "{managingRole.role_name}"</h3>
          {Object.keys(permissionsByModule).length === 0 && (
            <p className="field-hint">
              No permissions defined yet — add some in the catalog below first.
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
                  {moduleName}
                </label>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginLeft: 24, marginTop: 4 }}>
                  {modulePerms.map((p) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => handleTogglePermission(p.id)}
                      />
                      {p.action}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="sf-submit" onClick={handleSavePermissions} disabled={savingPermissions}>
              {savingPermissions ? "Saving..." : "Save Permissions"}
            </button>
            <button type="button" className="sf-cancel" onClick={() => setManagingRoleId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Permission catalog (defines what CAN be granted) ---- */}
      <h3 style={{ marginTop: 32 }}>Permission Catalog</h3>
      <p className="field-hint" style={{ marginTop: -8 }}>
        Define the individual permissions that can be granted to a role — e.g. module "warehouse",
        action "approve".
      </p>
      <form className="sf-form" onSubmit={handleAddPermission}>
        <div className="sf-field">
          <label>Module</label>
          <select name="module" value={permissionForm.module} onChange={handlePermissionChange} required>
            <option value="" disabled>
              Select module…
            </option>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-field">
          <label>Action</label>
          <select name="action" value={permissionForm.action} onChange={handlePermissionChange}>
            <option value="all">All (create, read, update, delete, approve)</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button className="sf-submit" type="submit">
          + Add Permission
        </button>
      </form>

      <DataTable
        rows={permissions}
        onDelete={handleDeletePermission}
        columns={[
          { key: "module", label: "Module" },
          { key: "action", label: "Action" },
          { key: "code", label: "Code" },
        ]}
      />
    </div>
  );
}