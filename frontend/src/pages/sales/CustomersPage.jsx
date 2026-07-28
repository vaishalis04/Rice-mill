import { useState, useEffect } from "react";
import {
  getCustomersApi,
  createCustomerApi,
  updateCustomerApi,
  deleteCustomerApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";

const emptyForm = {
  customer_code: "",
  name: "",
  gstin: "",
  address: "",
  customer_type: "fg",
  credit_limit: "",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    getCustomersApi()
      .then((res) => setCustomers(res.data.data ?? res.data))
      .catch(() => setError("Failed to load customers"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form };
      if (payload.credit_limit !== "") payload.credit_limit = Number(payload.credit_limit);
      if (editingId) {
        await updateCustomerApi(editingId, payload);
      } else {
        await createCustomerApi(payload);
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
      customer_code: row.customer_code || "",
      name: row.name || "",
      gstin: row.gstin || "",
      address: row.address || "",
      customer_type: row.customer_type || "fg",
      credit_limit: row.credit_limit ?? "",
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this customer?")) return;
    try {
      await deleteCustomerApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Customers</h2>
      {error && <div className="dt-error">{error}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>Customer Code</label>
          <input
            name="customer_code"
            value={form.customer_code}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Name</label>
          <input name="name" value={form.name} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>GSTIN</label>
          <input name="gstin" value={form.gstin} onChange={handleChange} />
        </div>
        <div className="sf-field">
          <label>Address</label>
          <input name="address" value={form.address} onChange={handleChange} />
        </div>
        <div className="sf-field">
          <label>Customer Type</label>
          <input
            name="customer_type"
            value={form.customer_type}
            onChange={handleChange}
            placeholder="fg"
          />
        </div>
        <div className="sf-field">
          <label>Credit Limit</label>
          <input
            name="credit_limit"
            type="number"
            value={form.credit_limit}
            onChange={handleChange}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Customer" : "Add Customer"}
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
        rows={customers}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "customer_code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "customer_type", label: "Type" },
          { key: "credit_limit", label: "Credit Limit" },
        ]}
      />
    </div>
  );
}
