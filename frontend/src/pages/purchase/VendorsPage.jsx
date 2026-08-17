import { useState, useEffect } from "react";
import {
  getVendorsApi,
  createVendorApi,
  updateVendorApi,
  deleteVendorApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";

const emptyForm = {
  vendor_code: "",
  name: "",
  gstin: "",
  vendor_type: "supplier",
  credit_terms: "",
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    getVendorsApi()
      .then((res) => setVendors(res.data.data ?? res.data))
      .catch(() => setError("Failed to load vendors"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        await updateVendorApi(editingId, form);
      } else {
        await createVendorApi(form);
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
      vendor_code: row.vendor_code || "",
      name: row.name || "",
      gstin: row.gstin || "",
      vendor_type: row.vendor_type || "supplier",
      credit_terms: row.credit_terms || "",
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this vendor?")) return;
    try {
      await deleteVendorApi(id);
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
      <h2 style={{ marginTop: 0 }}>Vendors</h2>
      {error && <div className="dt-error">{error}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>Vendor Code (optional — auto-generated if left blank)</label>
          <input
            name="vendor_code"
            value={form.vendor_code}
            onChange={handleChange}
            placeholder="e.g. VEND0003"
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
          <label>Vendor Type</label>
          <select name="vendor_type" value={form.vendor_type} onChange={handleChange}>
            <option value="supplier">Supplier</option>
            <option value="transporter">Transporter</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="sf-field">
          <label>Credit Terms</label>
          <input
            name="credit_terms"
            value={form.credit_terms}
            onChange={handleChange}
            placeholder="e.g. 30 days"
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Vendor" : "Add Vendor"}
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
        rows={vendors}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "vendor_code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "vendor_type", label: "Type" },
          { key: "credit_terms", label: "Credit Terms" },
        ]}
      />
    </div>
  );
}