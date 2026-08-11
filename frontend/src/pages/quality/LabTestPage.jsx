import { useState, useEffect } from "react";
import {
  getLabTestsApi,
  createLabTestApi,
  updateLabTestApi,
  updateLabTestVerdictApi,
  deleteLabTestApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  sampling_id: "",
  moisture_pct: "",
  broken_pct: "",
  fm_pct: "",
  color: "",
  smell: "",
  variety_detected: "",
  grain_size: "long",
  verdict: "accepted",
};

const VERDICT_FILTERS = [
  { key: "", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "negotiation", label: "Negotiation" },
];

export default function LabTestPage() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verdictFilter, setVerdictFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const samplings = useEntityLookup("sampling");

  const load = (verdict = verdictFilter) => {
    setLoading(true);
    getLabTestsApi(verdict ? { verdict } : {})
      .then((res) => setTests(res.data.data ?? res.data))
      .catch(() => setError("Failed to load lab tests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (verdict) => {
    setVerdictFilter(verdict);
    load(verdict);
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    const payload = {
      ...form,
      moisture_pct: Number(form.moisture_pct),
      broken_pct: Number(form.broken_pct),
      fm_pct: Number(form.fm_pct),
      variety_detected: Number(form.variety_detected),
    };
    try {
      if (editingId) {
        await updateLabTestApi(editingId, payload);
      } else {
        await createLabTestApi(payload);
        setInfo(`Test submitted — verdict "${form.verdict}" applied to the gate entry.`);
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
      sampling_id: row.sampling_id || "",
      moisture_pct: row.moisture_pct ?? "",
      broken_pct: row.broken_pct ?? "",
      fm_pct: row.fm_pct ?? "",
      color: row.color || "",
      smell: row.smell || "",
      variety_detected: row.variety_detected || "",
      grain_size: row.grain_size || "long",
      verdict: row.verdict || "accepted",
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lab test?")) return;
    try {
      await deleteLabTestApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleReviseVerdict = async (id, verdict) => {
    setError("");
    setInfo("");
    try {
      await updateLabTestVerdictApi(id, verdict);
      setInfo(`Verdict revised to "${verdict}".`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Verdict update failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Lab Test</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="sampling"
          label="Sampling"
          value={form.sampling_id}
          onChange={(id) => setForm({ ...form, sampling_id: id })}
          required
        />
        <div className="sf-field">
          <label>Moisture %</label>
          <input
            name="moisture_pct"
            type="number"
            step="0.1"
            value={form.moisture_pct}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Broken %</label>
          <input
            name="broken_pct"
            type="number"
            step="0.1"
            value={form.broken_pct}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Foreign Matter %</label>
          <input
            name="fm_pct"
            type="number"
            step="0.1"
            value={form.fm_pct}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Color</label>
          <input name="color" value={form.color} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>Smell</label>
          <input name="smell" value={form.smell} onChange={handleChange} required />
        </div>
        <EntitySelect
          entity="variety"
          label="Variety Detected"
          value={form.variety_detected}
          onChange={(id) => setForm({ ...form, variety_detected: id })}
          required
          creatable
        />
        <div className="sf-field">
          <label>Grain Size</label>
          <select name="grain_size" value={form.grain_size} onChange={handleChange}>
            <option value="long">Long</option>
            <option value="medium">Medium</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div className="sf-field">
          <label>Verdict</label>
          <select name="verdict" value={form.verdict} onChange={handleChange}>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="negotiation">Negotiation</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Test" : "Submit Test"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="section-tabs">
        {VERDICT_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${verdictFilter === f.key ? "active" : ""}`}
            onClick={() => handleFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={tests}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          {
            key: "sampling_id",
            label: "Sampling",
            render: (row) => samplings.getLabel(row.sampling_id),
          },
          { key: "moisture_pct", label: "Moisture %" },
          { key: "broken_pct", label: "Broken %" },
          {
            key: "verdict",
            label: "Verdict",
            render: (row) => <span className="dt-badge">{row.verdict}</span>,
          },
          {
            key: "revise",
            label: "Revise Verdict",
            render: (row) => (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleReviseVerdict(row.id, e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Change to…
                </option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="negotiation">Negotiation</option>
              </select>
            ),
          },
        ]}
      />
      <ModuleGuide
        title="Lab Tests"
        steps={[
          "Pick a sample that's finished Sampling, run the quality checks, and record a verdict: accepted, rejected, or negotiation.",
          "Accepted moves the gate entry on to Weighbridge. Rejected stops the load there. Negotiation sends it to Sales for a rate discussion.",
          "You can revise a verdict afterwards using the dropdown in the Actions column if a mistake was made.",
        ]}
      />
    </div>
  );
}