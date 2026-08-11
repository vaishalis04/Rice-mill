import { useState, useEffect } from "react";
import {
  getWeightSlipsApi,
  createWeightSlipApi,
  updateWeightSlipApi,
  deleteWeightSlipApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  gate_entry_id: "",
  slip_no: "",
  gross_weight: "",
  tare_weight: "",
  weighed_at: "",
  final_rate: "", // only needed if the gate entry has no linked PO
};

// datetime-local inputs need "YYYY-MM-DDTHH:mm"; API wants full ISO.
const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function WeighbridgePage() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");

  // Weight slips only store gate_entry_id — resolve vehicle/driver by
  // looking that gate entry up first, then its vehicle_id/driver_id.
  const getGateEntryRow = (gate_entry_id) =>
    gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id));

  const load = () => {
    setLoading(true);
    getWeightSlipsApi()
      .then((res) => setSlips(res.data.data ?? res.data))
      .catch(() => setError("Failed to load weight slips"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (editingId) {
        // Only the weights are meant to be corrected after creation.
        await updateWeightSlipApi(editingId, {
          gross_weight: Number(form.gross_weight),
          tare_weight: Number(form.tare_weight),
        });
        setInfo("Weight slip updated.");
      } else {
        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          slip_no: form.slip_no,
          gross_weight: Number(form.gross_weight),
          tare_weight: Number(form.tare_weight),
        };
        if (form.weighed_at) payload.weighed_at = toIso(form.weighed_at);
        // final_rate is only relevant when the gate entry has no PO — leave
        // it out entirely rather than send an empty string.
        if (form.final_rate !== "") payload.final_rate = Number(form.final_rate);

        await createWeightSlipApi(payload);
        setInfo(
          "Weight slip created — net weight computed, purchase finalized, gate entry moved to in_process."
        );
        gateEntries.refetch();
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — gate entry may not be at 'accepted' yet."
      );
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      slip_no: row.slip_no || "",
      gross_weight: row.gross_weight ?? "",
      tare_weight: row.tare_weight ?? "",
      weighed_at: toLocal(row.weighed_at),
      final_rate: row.final_rate ?? "",
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this weight slip?")) return;
    try {
      await deleteWeightSlipApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Weighbridge</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={(id) => setForm({ ...form, gate_entry_id: id })}
          filter={(row) => row.gate_status === "accepted"}
          required={!editingId}
          disabled={!!editingId}
        />
        <div className="sf-field">
          <label>Slip No.</label>
          <input
            name="slip_no"
            value={form.slip_no}
            onChange={handleChange}
            disabled={!!editingId}
            required={!editingId}
          />
        </div>
        <div className="sf-field">
          <label>Gross Weight (truck + load)</label>
          <input
            name="gross_weight"
            type="number"
            value={form.gross_weight}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Tare Weight (empty truck — must be less than gross)</label>
          <input
            name="tare_weight"
            type="number"
            value={form.tare_weight}
            onChange={handleChange}
            required
          />
        </div>
        {!editingId && (
          <>
            <div className="sf-field">
              <label>Weighed At</label>
              <input
                name="weighed_at"
                type="datetime-local"
                value={form.weighed_at}
                onChange={handleChange}
              />
            </div>
            <div className="sf-field">
              <label>Final Rate (only if this entry has no PO)</label>
              <input
                name="final_rate"
                type="number"
                step="0.01"
                value={form.final_rate}
                onChange={handleChange}
              />
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Weight Slip" : "Generate Weight Slip"}
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
        rows={slips}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "slip_no", label: "Slip No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          {
            key: "vehicle",
            label: "Vehicle No.",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? vehicles.getLabel(ge.vehicle_id) : "—";
            },
          },
          {
            key: "driver",
            label: "Driver Name",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? drivers.getLabel(ge.driver_id) : "—";
            },
          },
          { key: "gross_weight", label: "Gross Wt." },
          { key: "tare_weight", label: "Tare Wt." },
          {
            key: "net_weight",
            label: "Net Wt.",
            render: (row) => (
              <strong style={{ color: "#1d4ed8" }}>
                {row.net_weight ?? row.gross_weight - row.tare_weight}
              </strong>
            ),
          },
          {
            key: "weighed_at",
            label: "Weighed At",
            render: (row) => (row.weighed_at ? new Date(row.weighed_at).toLocaleString() : "—"),
          },
          {
            key: "final_rate",
            label: "Final Rate",
            render: (row) => (row.final_rate != null ? `₹${row.final_rate}` : "— (from PO)"),
          },
        ]}
      />

      <ModuleGuide
        title="Weighbridge"
        steps={[
          "A truck must already be marked 'accepted' by Quality before it can be weighed — pick it from the Gate Entry dropdown above.",
          "Enter the gross weight (truck + load) and tare weight (empty truck) from the weighbridge readout.",
          "Net weight is calculated automatically (gross − tare) — you don't need to work it out yourself.",
          "Submitting finalizes the Purchase record and moves the gate entry on to 'in_process', ready for unloading in the Warehouse module.",
          "If this particular delivery has no linked Purchase Order, fill in Final Rate so the purchase can still be priced.",
        ]}
      />
    </div>
  );
}