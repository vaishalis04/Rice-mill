import { useState, useEffect } from "react";
import {
  getLotsApi,
  createLotApi,
  updateLotApi,
  routeLotApi,
  deleteLotApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

const emptyForm = {
  gate_entry_id: "",
  warehouse_id: "",
  bin_id: "",
  qty: "",
  material_id: "",
  variety_id: "",
  parent_lot_id: "",
};

export default function LotsPage() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [materialFilter, setMaterialFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showOverrides, setShowOverrides] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = (material_id = materialFilter) => {
    setLoading(true);
    getLotsApi(material_id ? { material_id } : {})
      .then((res) => setLots(res.data.data ?? res.data))
      .catch(() => setError("Failed to load lots"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (editingId) {
        await updateLotApi(editingId, { qty: Number(form.qty) });
      } else {
        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          warehouse_id: Number(form.warehouse_id),
          bin_id: Number(form.bin_id),
        };
        if (form.qty) payload.qty = Number(form.qty);
        if (form.material_id) payload.material_id = Number(form.material_id);
        if (form.variety_id) payload.variety_id = Number(form.variety_id);
        if (form.parent_lot_id) payload.parent_lot_id = Number(form.parent_lot_id);
        const res = await createLotApi(payload);
        const body = res.data.data ?? res.data;
        setInfo(
          `Lot created: ${body?.lot?.lot_no || "(check response)"} — stack + inventory opened.`
        );
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowOverrides(false);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — gate entry may not be weighed (in_process) yet."
      );
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      warehouse_id: row.warehouse_id || "",
      bin_id: row.bin_id || "",
      qty: row.qty ?? "",
      material_id: row.material_id || "",
      variety_id: row.variety_id || "",
      parent_lot_id: row.parent_lot_id || "",
    });
    setShowOverrides(true);
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowOverrides(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lot?")) return;
    try {
      await deleteLotApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRoute = async (id, destination) => {
    setError("");
    setInfo("");
    try {
      await routeLotApi(id, destination);
      setInfo(`Lot routed to ${destination} — gate entry moved to unloaded.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Routing failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Lots / Unloading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={(id) => setForm({ ...form, gate_entry_id: id })}
          filter={(row) => row.gate_status === "in_process"}
          disabled={!!editingId}
          required={!editingId}
        />
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={form.warehouse_id}
          onChange={(id) => setForm({ ...form, warehouse_id: id, bin_id: "" })}
          disabled={!!editingId}
          required={!editingId}
        />
        <EntitySelect
          entity="bin"
          label="Bin"
          value={form.bin_id}
          onChange={(id) => setForm({ ...form, bin_id: id })}
          filter={(row) => String(row.warehouse_id) === String(form.warehouse_id)}
          disabled={!!editingId}
          required={!editingId}
        />
        <div className="sf-field">
          <label>Qty {!editingId && "(optional — defaults to net weight)"}</label>
          <input
            name="qty"
            type="number"
            value={form.qty}
            onChange={handleChange}
            required={!!editingId}
          />
        </div>

        {!editingId && (
          <>
            <button
              type="button"
              className="sf-cancel"
              style={{ gridColumn: "1 / -1", justifySelf: "start" }}
              onClick={() => setShowOverrides((v) => !v)}
            >
              {showOverrides ? "Hide" : "Show"} optional overrides
            </button>
            {showOverrides && (
              <>
                <EntitySelect
                  entity="material"
                  label="Material (override)"
                  value={form.material_id}
                  onChange={(id) => setForm({ ...form, material_id: id })}
                />
                <EntitySelect
                  entity="variety"
                  label="Variety (override)"
                  value={form.variety_id}
                  onChange={(id) => setForm({ ...form, variety_id: id })}
                />
                <EntitySelect
                  entity="lot"
                  label="Parent Lot (optional)"
                  value={form.parent_lot_id}
                  onChange={(id) => setForm({ ...form, parent_lot_id: id })}
                />
              </>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Lot" : "Create Lot"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="sf-form" style={{ gridTemplateColumns: "260px" }}>
        <EntitySelect
          entity="material"
          label="Filter by Material"
          value={materialFilter}
          onChange={(id) => {
            setMaterialFilter(id);
            load(id);
          }}
        />
      </div>

      <DataTable
        loading={loading}
        rows={lots}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "lot_no", label: "Lot No." },
          { key: "gate_entry_id", label: "Gate Entry ID" },
          { key: "warehouse_id", label: "Warehouse ID" },
          { key: "bin_id", label: "Bin ID" },
          { key: "qty", label: "Qty" },
          {
            key: "route",
            label: "Route",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="dt-btn" onClick={() => handleRoute(row.id, "warehouse")}>
                  To Warehouse
                </button>
                <button className="dt-btn" onClick={() => handleRoute(row.id, "production")}>
                  To Production
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
