import { useState, useEffect } from "react";
import {
  getSamplingsApi,
  createSamplingApi,
  updateSamplingApi,
  deleteSamplingApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  gate_entry_id: "",
  sample_code: "",
  collected_at: "",
  sent_to_lab_at: "",
};

// datetime-local inputs need "YYYY-MM-DDTHH:mm"; API wants full ISO.
const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function SamplingPage() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const gateEntries = useEntityLookup("gate_entry");

  const load = () => {
    setLoading(true);
    getSamplingsApi()
      .then((res) => setSamples(res.data.data ?? res.data))
      .catch(() => setError("Failed to load samples"))
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
        // Only sent_to_lab_at is meant to be updated after creation.
        await updateSamplingApi(editingId, {
          sent_to_lab_at: toIso(form.sent_to_lab_at),
        });
      } else {
        await createSamplingApi({
          gate_entry_id: Number(form.gate_entry_id),
          sample_code: form.sample_code,
          collected_at: toIso(form.collected_at),
        });
        setInfo("Sample created — linked gate entry moved to sampling_done.");
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — gate entry may not be at waiting_sampling yet."
      );
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      sample_code: row.sample_code || "",
      collected_at: toLocal(row.collected_at),
      sent_to_lab_at: toLocal(row.sent_to_lab_at),
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this sample?")) return;
    try {
      await deleteSamplingApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Sampling</h2>
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
          filter={(row) => row.gate_status === "waiting_sampling"}
          required={!editingId}
        />
        <div className="sf-field">
          <label>Sample Code</label>
          <input
            name="sample_code"
            value={form.sample_code}
            onChange={handleChange}
            disabled={!!editingId}
            required={!editingId}
          />
        </div>
        <div className="sf-field">
          <label>Collected At</label>
          <input
            name="collected_at"
            type="datetime-local"
            value={form.collected_at}
            onChange={handleChange}
            disabled={!!editingId}
            required={!editingId}
          />
        </div>
        {editingId && (
          <div className="sf-field">
            <label>Sent to Lab At</label>
            <input
              name="sent_to_lab_at"
              type="datetime-local"
              value={form.sent_to_lab_at}
              onChange={handleChange}
              required
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Sample" : "Create Sample"}
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
        rows={samples}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "sample_code", label: "Sample Code" },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          { key: "collected_at", label: "Collected At" },
          { key: "sent_to_lab_at", label: "Sent to Lab At" },
        ]}
      />
      <ModuleGuide
        title="Sampling"
        steps={[
          "Only gate entries at 'waiting_sampling' show up in the picker — that means the truck has already checked out at the gate.",
          "Record when the sample was collected, then send it to the lab.",
          "Once sent, the entry moves on to Lab Tests for a verdict.",
        ]}
      />
    </div>
  );
}
