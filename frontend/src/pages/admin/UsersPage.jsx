import { useState, useEffect } from "react";
import {
  getUsersApi,
  createUserApi,
  updateUserApi,
  deleteUserApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  username: "",
  email: "",
  phone: "",
  password: "",
  role_id: "",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const roles = useEntityLookup("role");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    getUsersApi()
      .then((res) => setUsers(res.data.data ?? res.data))
      .catch(() => setError("Failed to load users"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const setField = (name) => (id) => setForm({ ...form, [name]: id });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const payload = {
      username: form.username,
      email: form.email,
      phone: form.phone || undefined,
      role_id: Number(form.role_id),
    };
    // Password is required to create a user, but optional on edit — leaving
    // it blank while editing keeps the user's current password unchanged.
    if (form.password) payload.password = form.password;

    try {
      if (editingId) {
        await updateUserApi(editingId, payload);
        setInfo("User updated.");
      } else {
        if (!form.password) {
          setError("Password is required to create a new user.");
          return;
        }
        await createUserApi(payload);
        setInfo("User created.");
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      username: row.username || "",
      email: row.email || "",
      phone: row.phone || "",
      password: "",
      role_id: row.role_id || row.role?.id || "",
      employee_code: row.employee_code || "",
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user? They will no longer be able to log in.")) return;
    try {
      await deleteUserApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Delete failed");
    }
  };

  const handleToggleDisabled = async (row) => {
    try {
      await updateUserApi(row.id, { is_active: !row.is_active });
      setInfo(row.is_active ? "User disabled." : "User enabled.");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not change user status");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <p style={{ color: "#666", marginTop: -8 }}>
        Create logins for staff and control which role (and therefore which dashboard and permissions) each person has.
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>Username</label>
          <input name="username" value={form.username} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>Email</label>
          <input name="email" type="email" value={form.email} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>Phone (optional)</label>
          <input name="phone" value={form.phone} onChange={handleChange} />
        </div>
        <div className="sf-field">
          <label>{editingId ? "New Password (leave blank to keep current)" : "Password"}</label>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            required={!editingId}
          />
        </div>
        <EntitySelect
          entity="role"
          label="Role"
          value={form.role_id}
          onChange={setField("role_id")}
          required
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update User" : "Create User"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={users}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "username", label: "Username" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          {
            key: "role_id",
            label: "Role",
            render: (row) => (
              <span className="dt-badge">{row.role?.role_name || roles.getLabel(row.role_id)}</span>
            ),
          },
          { key: "employee_code", label: "Employee Code" },
          {
            key: "is_active",
            label: "Active",
            render: (row) => (row.is_active ? "Yes" : "No"),
          },
          {
            key: "user_status",
            label: "Actions",
            render: (row) => (
              <button className="dt-btn" onClick={() => handleToggleDisabled(row)}>
                {row.is_active ? "Disable" : "Enable"}
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}