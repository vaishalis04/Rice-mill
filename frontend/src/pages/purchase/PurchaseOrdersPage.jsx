import { useState, useEffect } from "react";
import {
  getPurchaseOrdersApi,
  createPurchaseOrderApi,
  updatePurchaseOrderApi,
  deletePurchaseOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  po_no: "",
  vendor_id: "",
  material_id: "",
  variety_id: "",
  qty: "",
  rate: "",
  po_date: "",
};

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const vendors = useEntityLookup("vendor");
  const materials = useEntityLookup("material");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    getPurchaseOrdersApi()
      .then((res) => setOrders(res.data.data ?? res.data))
      .catch(() => setError("Failed to load purchase orders"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  // Used by EntitySelect fields — they hand back the picked row's id directly.
  const setField = (name) => (id) => setForm({ ...form, [name]: id });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = {
      ...form,
      vendor_id: Number(form.vendor_id),
      material_id: Number(form.material_id),
      variety_id: Number(form.variety_id),
      qty: Number(form.qty),
      rate: Number(form.rate),
    };
    try {
      if (editingId) {
        await updatePurchaseOrderApi(editingId, payload);
      } else {
        await createPurchaseOrderApi(payload);
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
      po_no: row.po_no || "",
      vendor_id: row.vendor_id || "",
      material_id: row.material_id || "",
      variety_id: row.variety_id || "",
      qty: row.qty || "",
      rate: row.rate || "",
      po_date: row.po_date?.slice(0, 10) || "",
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this purchase order?")) return;
    try {
      await deletePurchaseOrderApi(id);
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
      <h2 style={{ marginTop: 0 }}>Purchase Orders</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>PO No.</label>
          <input name="po_no" value={form.po_no} onChange={handleChange} required />
        </div>
        <EntitySelect
          entity="vendor"
          label="Vendor"
          value={form.vendor_id}
          onChange={setField("vendor_id")}
          required
        />
        <EntitySelect
          entity="material"
          label="Material"
          value={form.material_id}
          onChange={setField("material_id")}
          required
          creatable
          onCreated={materials.refetch}
        />
        <EntitySelect
          entity="variety"
          label="Variety"
          value={form.variety_id}
          onChange={setField("variety_id")}
          required
          creatable
        />
        <div className="sf-field">
          <label>Qty</label>
          <input
            name="qty"
            type="number"
            value={form.qty}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Rate</label>
          <input
            name="rate"
            type="number"
            step="0.01"
            value={form.rate}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>PO Date</label>
          <input
            name="po_date"
            type="date"
            value={form.po_date}
            onChange={handleChange}
            required
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update PO" : "Create PO"}
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
        rows={orders}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "po_no", label: "PO No." },
          {
            key: "vendor_id",
            label: "Vendor",
            render: (row) => vendors.getLabel(row.vendor_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => materials.getLabel(row.material_id),
          },
          { key: "qty", label: "Qty" },
          { key: "rate", label: "Rate" },
          { key: "po_date", label: "PO Date" },
        ]}
      />

      <ModuleGuide
        title="a PO becoming a final Purchase"
        steps={[
          "There's no manual \"Convert\" step here anymore.",
          "Once a truck against this PO is gated in, sampled, and lab-accepted, it moves to Weighbridge.",
          "The Gate role weighs it on the Weighbridge tab — that action automatically creates the final Purchase record.",
          "You'll then see it reflected in Warehouse's Lots once it's stacked.",
        ]}
      />
    </div>
  );
}