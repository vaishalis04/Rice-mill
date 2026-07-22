import { useState, useEffect } from "react";
import {
  getWeightSlipsApi,
  createWeightSlipApi,
  updateWeightSlipApi,
  deleteWeightSlipApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

const emptyForm = {
  gate_entry_id: "",
  slip_no: "",
  gross_weight: "",
  tare_weight: "",
  weighed_at: "",
  final_rate: "",
};

const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function WeightSlipsPage() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

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
        await updateWeightSlipApi(editingId, {
          gross_weight: Number(form.gross_weight),
          tare_weight: Number(form.tare_weight),
        });
      } else {
        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          slip_no: form.slip_no,
          gross_weight: Number(form.gross_weight),
          tare_weight: Number(form.tare_weight),
          weighed_at: toIso(form.weighed_at),
        };
        if (form.final_rate) payload.final_rate = Number(form.final_rate);
        const res = await createWeightSlipApi(payload);
        const body = res.data.data ?? res.data;
        const net =
          body?.weightSlip?.net_weight ??
          Number(payload.gross_weight) - Number(payload.tare_weight);
        setInfo(
          `Weight slip saved — net weight ${net}. Purchase finalized, gate entry moved to in_process.`
        );
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
      <h2 style={{ marginTop: 0 }}>Weighbridge / Weight Slips</h2>
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
          filter={(row) => row.gate_status === "accepted"}
          disabled={!!editingId}
          required={!editingId}
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
          <label>Gross Weight</label>
          <input
            name="gross_weight"
            type="number"
            value={form.gross_weight}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Tare Weight</label>
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
                required
              />
            </div>
            <div className="sf-field">
              <label>Final Rate (only if gate entry has no PO)</label>
              <input
                name="final_rate"
                type="number"
                step="0.01"
                value={form.final_rate}
                onChange={handleChange}
                placeholder="Optional — required if no linked PO"
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
          { key: "gate_entry_id", label: "Gate Entry ID" },
          { key: "gross_weight", label: "Gross Wt" },
          { key: "tare_weight", label: "Tare Wt" },
          {
            key: "net_weight",
            label: "Net Wt",
            render: (row) =>
              row.net_weight ?? row.gross_weight - row.tare_weight,
          },
          { key: "weighed_at", label: "Weighed At" },
        ]}
      />
    </div>
  );
}
