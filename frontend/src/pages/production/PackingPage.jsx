import { useState, useEffect } from "react";
import {
  getPackingsApi,
  createPackingApi,
  updatePackingApi,
  deletePackingApi,
  getGradedOutputsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const PACK_SIZES = ["5", "10", "25", "50", "custom"];

const emptyForm = {
  batch_id: "",
  warehouse_id: "",
  pack_size: "25",
  bag_count: "",
  production_date: "",
  qty_override: "", // required only when pack_size === "custom"
  rack_id: "",
  pallet_id: "",
};

export default function PackingPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [editBagCount, setEditBagCount] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [gradedOutputs, setGradedOutputs] = useState(null);
  const [gradedLoading, setGradedLoading] = useState(false);
  const [gradedError, setGradedError] = useState("");

  const batches = useEntityLookup("production_batch");
  const warehouses = useEntityLookup("warehouse");

  const load = () => {
    setLoading(true);
    getPackingsApi()
      .then((res) => setRecords(res.data.data ?? res.data))
      .catch(() => setError("Failed to load packing records"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Step 1 of the doc's flow: picking a batch immediately shows its
  // length-grading breakdown + bags already packed so far.
  useEffect(() => {
    if (!form.batch_id) {
      setGradedOutputs(null);
      return;
    }
    setGradedLoading(true);
    setGradedError("");
    getGradedOutputsApi(form.batch_id)
      .then((res) => setGradedOutputs(res.data.data ?? res.data))
      .catch(() =>
        setGradedError(
          "Couldn't load graded outputs — this batch may not have finished Length Grading yet."
        )
      )
      .finally(() => setGradedLoading(false));
  }, [form.batch_id]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {
        batch_id: Number(form.batch_id),
        warehouse_id: Number(form.warehouse_id),
        pack_size: form.pack_size,
        bag_count: Number(form.bag_count),
      };
      if (form.production_date) payload.production_date = form.production_date;
      if (form.pack_size === "custom") {
        if (form.qty_override === "") {
          setError("Qty Override is required for a custom pack size");
          return;
        }
        payload.qty_override = Number(form.qty_override);
      }
      if (form.rack_id) payload.rack_id = form.rack_id;
      if (form.pallet_id) payload.pallet_id = form.pallet_id;

      const res = await createPackingApi(payload);
      const body = res.data.data ?? res.data;
      const packing = body.packing ?? body;
      setInfo(
        `Packing created${packing?.batch_no ? ` (${packing.batch_no})` : ""}` +
          `${packing?.barcode ? ` — barcode ${packing.barcode}` : ""}` +
          " — a matching Finished Goods record was opened with status 'ready'."
      );
      setForm(emptyForm);
      setGradedOutputs(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setEditBagCount(row.bag_count ?? "");
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await updatePackingApi(editingId, { bag_count: Number(editBagCount) });
      setEditingId(null);
      load();
    } catch {
      setError("Update failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this packing record?")) return;
    try {
      await deletePackingApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Packing</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {editingId ? (
        <form className="sf-form" onSubmit={handleUpdate}>
          <div className="sf-field">
            <label>Bag Count</label>
            <input
              type="number"
              value={editBagCount}
              onChange={(e) => setEditBagCount(e.target.value)}
              required
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Update Bag Count
            </button>
            <button type="button" className="sf-cancel" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form className="sf-form" onSubmit={handleSubmit}>
          <EntitySelect
            entity="production_batch"
            label="Production Batch"
            value={form.batch_id}
            onChange={(id) => setForm({ ...form, batch_id: id })}
            filter={(row) => row.batch_status === "completed"}
            required
          />
          <EntitySelect
            entity="warehouse"
            label="Warehouse"
            value={form.warehouse_id}
            onChange={(id) => setForm({ ...form, warehouse_id: id })}
            required
            creatable
          />
          <div className="sf-field">
            <label>Pack Size (kg)</label>
            <select name="pack_size" value={form.pack_size} onChange={handleChange}>
              {PACK_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s === "custom" ? "Custom" : `${s} kg`}
                </option>
              ))}
            </select>
          </div>
          <div className="sf-field">
            <label>Bag Count</label>
            <input
              name="bag_count"
              type="number"
              value={form.bag_count}
              onChange={handleChange}
              required
            />
          </div>
          {form.pack_size === "custom" && (
            <div className="sf-field">
              <label>Qty Override (total kg)</label>
              <input
                name="qty_override"
                type="number"
                value={form.qty_override}
                onChange={handleChange}
                required
              />
            </div>
          )}
          <div className="sf-field">
            <label>Production Date</label>
            <input
              name="production_date"
              type="date"
              value={form.production_date}
              onChange={handleChange}
            />
          </div>
          <div className="sf-field">
            <label>Rack ID (optional)</label>
            <input name="rack_id" value={form.rack_id} onChange={handleChange} />
          </div>
          <div className="sf-field">
            <label>Pallet ID (optional)</label>
            <input name="pallet_id" value={form.pallet_id} onChange={handleChange} />
          </div>

          {form.batch_id && (
            <div style={{ gridColumn: "1 / -1" }}>
              {gradedLoading && <p className="dt-msg">Loading graded outputs…</p>}
              {gradedError && <div className="dt-error">{gradedError}</div>}
              {gradedOutputs && (
                <div className="dt-wrapper" style={{ padding: 12 }}>
                  <strong>Graded output for this batch:</strong>
                  <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
                    <span>Long: {gradedOutputs.long_qty ?? "—"}</span>
                    <span>Medium: {gradedOutputs.medium_qty ?? "—"}</span>
                    <span>Broken: {gradedOutputs.broken_qty ?? "—"}</span>
                    <span>Small Broken: {gradedOutputs.small_broken_qty ?? "—"}</span>
                    {gradedOutputs.bags_packed_so_far != null && (
                      <span>Already packed: {gradedOutputs.bags_packed_so_far} bags</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <button className="sf-submit" type="submit" style={{ gridColumn: "1 / -1" }}>
            Create Packing Record
          </button>
        </form>
      )}

      <DataTable
        loading={loading}
        rows={records}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "batch_no", label: "Packing No." },
          {
            key: "batch_id",
            label: "Batch",
            render: (row) => batches.getLabel(row.batch_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) => warehouses.getLabel(row.warehouse_id),
          },
          { key: "pack_size", label: "Pack Size" },
          { key: "bag_count", label: "Bags" },
          { key: "barcode", label: "Barcode" },
        ]}
      />
    </div>
  );
}
