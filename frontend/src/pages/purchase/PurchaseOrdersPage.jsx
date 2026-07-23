import { useState, useEffect } from "react";
import {
  getPurchaseOrdersApi,
  createPurchaseOrderApi,
  updatePurchaseOrderApi,
  deletePurchaseOrderApi,
  convertPurchaseApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
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

  // Convert-to-purchase mini form (replaces the old window.prompt flow)
  const [convertingPO, setConvertingPO] = useState(null);
  const [convertForm, setConvertForm] = useState({
    gate_entry_id: "",
    weight_slip_id: "",
  });

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

  // Only works once a gate entry has been weighed (weighbridge module,
  // not built on the backend yet per the API docs) — this will show the
  // backend's "Invalid weight_slip_id" error until that exists.
  const openConvert = (po) => {
    setConvertingPO(po);
    setConvertForm({ gate_entry_id: "", weight_slip_id: "" });
    setError("");
    setInfo("");
  };

  const cancelConvert = () => {
    setConvertingPO(null);
    setConvertForm({ gate_entry_id: "", weight_slip_id: "" });
  };

  const handleConvertSubmit = async (e) => {
    e.preventDefault();
    if (!convertForm.gate_entry_id || !convertForm.weight_slip_id) return;

    setError("");
    setInfo("");
    try {
      await convertPurchaseApi({
        gate_entry_id: Number(convertForm.gate_entry_id),
        weight_slip_id: Number(convertForm.weight_slip_id),
        po_id: convertingPO.id,
        final_rate: convertingPO.rate,
        purchase_date: new Date().toISOString().slice(0, 10),
      });
      setInfo("Converted to final purchase.");
      cancelConvert();
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Convert failed — likely no weight slip yet (weighbridge module isn't built)."
      );
    }
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
        />
        <EntitySelect
          entity="variety"
          label="Variety"
          value={form.variety_id}
          onChange={setField("variety_id")}
          required
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

      {convertingPO && (
        <form className="sf-form" onSubmit={handleConvertSubmit}>
          <div className="sf-field" style={{ gridColumn: "1 / -1" }}>
            <label>Converting PO</label>
            <div style={{ padding: "8px 0", fontSize: "0.9rem" }}>
              {convertingPO.po_no} — Rate {convertingPO.rate}
            </div>
          </div>
          <EntitySelect
            entity="gate_entry"
            label="Gate Entry"
            value={convertForm.gate_entry_id}
            onChange={(id) =>
              setConvertForm({ ...convertForm, gate_entry_id: id })
            }
            required
          />
          <div className="sf-field">
            <label>Weight Slip ID</label>
            <input
              type="number"
              value={convertForm.weight_slip_id}
              onChange={(e) =>
                setConvertForm({
                  ...convertForm,
                  weight_slip_id: e.target.value,
                })
              }
              placeholder="Not available until weighbridge module exists"
              required
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Convert
            </button>
            <button
              type="button"
              className="sf-cancel"
              onClick={cancelConvert}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
          {
            key: "convert",
            label: "Convert",
            render: (row) => (
              <button className="dt-btn" onClick={() => openConvert(row)}>
                To Purchase
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
