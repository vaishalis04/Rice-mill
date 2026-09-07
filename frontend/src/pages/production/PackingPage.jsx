import { useEffect, useState } from "react";
import { getPackingsApi, updatePackingApi, deletePackingApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const PACK_SIZE_PRESETS = ["5", "10", "25", "50"];
const CUSTOM_SENTINEL = "__custom__";

export default function PackingPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ bag_count: "", pack_size: "25", custom_pack_size: "" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const batches = useEntityLookup("production_batch");
  const materials = useEntityLookup("material");

  const load = () => {
    setLoading(true);
    getPackingsApi()
      .then((res) => setRecords(res.data.data ?? res.data))
      .catch(() => setError("Failed to load packing records"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleEdit = (row) => {
    setEditingId(row.id);
    const sizeStr = row.pack_size != null ? String(row.pack_size) : "25";
    const isPreset = PACK_SIZE_PRESETS.includes(sizeStr);
    setEditForm({
      bag_count: row.bag_count ?? "",
      pack_size: isPreset ? sizeStr : CUSTOM_SENTINEL,
      custom_pack_size: isPreset ? "" : sizeStr,
    });
  };

  const editResolvedPackSize =
    editForm.pack_size === CUSTOM_SENTINEL ? editForm.custom_pack_size : editForm.pack_size;

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (editForm.pack_size === CUSTOM_SENTINEL && !(Number(editForm.custom_pack_size) > 0)) {
        setError("Enter a valid custom pack size (kg per bag, greater than 0)");
        return;
      }
      await updatePackingApi(editingId, {
        bag_count: Number(editForm.bag_count),
        pack_size: Number(editResolvedPackSize),
      });
      setInfo("Packing record updated");
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
      {info && <div className="dt-success">{info}</div>}

      <p className="field-hint">
        Packing records are created automatically from the Production Batches page when you
        finalize a batch. Use this page to review past packing records, or make small corrections
        to pack size / bag count before the stock is dispatched.
      </p>

      {editingId && (
        <form className="sf-form" onSubmit={handleUpdate}>
          <div className="sf-field">
            <label>Bag Count</label>
            <input
              type="number"
              value={editForm.bag_count}
              onChange={(e) => setEditForm({ ...editForm, bag_count: e.target.value })}
              required
            />
          </div>
          <div className="sf-field">
            <label>Pack Size (kg)</label>
            <select
              value={editForm.pack_size}
              onChange={(e) => setEditForm({ ...editForm, pack_size: e.target.value })}
            >
              {PACK_SIZE_PRESETS.map((s) => (
                <option key={s} value={s}>{`${s} kg`}</option>
              ))}
              <option value={CUSTOM_SENTINEL}>Custom…</option>
            </select>
          </div>
          {editForm.pack_size === CUSTOM_SENTINEL && (
            <div className="sf-field">
              <label>Custom Pack Size (kg per bag)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editForm.custom_pack_size}
                onChange={(e) => setEditForm({ ...editForm, custom_pack_size: e.target.value })}
                required
                autoFocus
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Save Changes
            </button>
            <button type="button" className="sf-cancel" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
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
            label: "Production Batch",
            render: (row) => batches.getLabel(row.batch_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => (row.material_id ? materials.getLabel(row.material_id) : "—"),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) =>
              row.finishedGoodsRecords?.[0]?.warehouse
                ? `${row.finishedGoodsRecords[0].warehouse.name} (${row.finishedGoodsRecords[0].warehouse.warehouse_code})`
                : "—",
          },
          {
            key: "pack_size",
            label: "Pack Size",
            render: (row) => (row.pack_size != null ? `${row.pack_size} kg` : "—"),
          },
          { key: "bag_count", label: "Bags" },
          {
            key: "total_qty",
            label: "Total Qty",
            render: (row) => {
              const totalKg = Number(row.pack_size || 0) * Number(row.bag_count || 0);
              return `${totalKg} kg (${(totalKg / 1000).toFixed(3)} tons)`;
            },
          },
          { key: "barcode", label: "Barcode" },
        ]}
      />

      <ModuleGuide
        title="Packing"
        steps={[
          "Packing is created as part of finalizing a Production Batch, not from this page directly.",
          "Go to the Production Batches page, create a batch, then complete the packing step there.",
          "This page shows the resulting packing history and lets you correct pack size / bag count before dispatch.",
          "Once a packing record's finished goods have been dispatched, its pack size and bag count can no longer be changed.",
        ]}
      />
    </div>
  );
}