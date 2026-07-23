import { useState, useEffect } from "react";
import {
  getMachinesApi,
  createMachineApi,
  updateMachineApi,
  deleteMachineApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const TYPE_CONFIG = {
  master: {
    label: "Machine",
    readOnly: false,
    fields: [
      { name: "machine_code", label: "Machine Code" },
      { name: "name", label: "Name" },
      { name: "machine_type", label: "Machine Type" },
      { name: "capacity_per_hr", label: "Capacity / hr", type: "number" },
    ],
  },
  log: {
    label: "Run Log",
    readOnly: true, // written automatically by production stages
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine" },
      { name: "batch_id", label: "Batch", type: "entity", entity: "production_batch" },
      { name: "stage", label: "Stage" },
      { name: "start_time", label: "Start" },
      { name: "end_time", label: "End" },
    ],
  },
  maintenance: {
    label: "Maintenance",
    readOnly: false,
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine" },
      { name: "maintenance_type", label: "Maintenance Type" },
      { name: "start_time", label: "Start Time", type: "datetime-local" },
      { name: "end_time", label: "End Time", type: "datetime-local" },
      { name: "cost", label: "Cost", type: "number" },
      { name: "performed_by", label: "Performed By" },
    ],
  },
};

const TYPES = Object.keys(TYPE_CONFIG);

function emptyFormFor(type) {
  const form = {};
  TYPE_CONFIG[type].fields.forEach((f) => (form[f.name] = ""));
  return form;
}

export default function MachinesPage() {
  const [activeType, setActiveType] = useState("master");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyFormFor("master"));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [batchFilter, setBatchFilter] = useState("");

  const lookups = {
    machine: useEntityLookup("machine"),
    production_batch: useEntityLookup("production_batch"),
  };

  const config = TYPE_CONFIG[activeType];

  const load = (type = activeType, batch_id = batchFilter) => {
    setLoading(true);
    const params = { type };
    if (type === "log" && batch_id) params.batch_id = batch_id;
    getMachinesApi(params)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load ${TYPE_CONFIG[type].label}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(activeType, batchFilter);
    setForm(emptyFormFor(activeType));
    setEditingId(null);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { type: activeType, ...form };
    config.fields
      .filter((f) => f.type === "number")
      .forEach((f) => {
        if (payload[f.name] !== "") payload[f.name] = Number(payload[f.name]);
      });
    try {
      if (editingId) {
        await updateMachineApi(editingId, payload);
      } else {
        await createMachineApi(payload);
      }
      setForm(emptyFormFor(activeType));
      setEditingId(null);
      load(activeType, batchFilter);
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    const next = emptyFormFor(activeType);
    Object.keys(next).forEach((key) => {
      next[key] = row[key] ?? "";
    });
    setForm(next);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    try {
      await deleteMachineApi(id, activeType);
      load(activeType, batchFilter);
    } catch {
      setError("Delete failed");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyFormFor(activeType));
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Machines</h2>

      <div className="section-tabs">
        {TYPES.map((t) => (
          <button
            key={t}
            className={`section-tab ${activeType === t ? "active" : ""}`}
            onClick={() => setActiveType(t)}
          >
            {TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {error && <div className="dt-error">{error}</div>}

      {activeType === "log" && (
        <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
          <EntitySelect
            entity="production_batch"
            label="Filter by Batch (optional)"
            value={batchFilter}
            onChange={(id) => {
              setBatchFilter(id);
              load(activeType, id);
            }}
          />
        </form>
      )}

      {!config.readOnly && (
        <form className="sf-form" onSubmit={handleSubmit}>
          {config.fields.map((f) =>
            f.type === "entity" ? (
              <EntitySelect
                key={f.name}
                entity={f.entity}
                label={f.label}
                value={form[f.name] ?? ""}
                onChange={(id) => setForm({ ...form, [f.name]: id })}
                required
                creatable={f.entity === "machine"}
              />
            ) : (
              <div className="sf-field" key={f.name}>
                <label>{f.label}</label>
                <input
                  name={f.name}
                  type={f.type || "text"}
                  step={f.type === "number" ? "any" : undefined}
                  value={form[f.name] ?? ""}
                  onChange={handleChange}
                  required
                />
              </div>
            )
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              {editingId ? `Update ${config.label}` : `Add ${config.label}`}
            </button>
            {editingId && (
              <button type="button" className="sf-cancel" onClick={handleCancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <DataTable
        loading={loading}
        rows={rows}
        onEdit={config.readOnly ? undefined : handleEdit}
        onDelete={config.readOnly ? undefined : handleDelete}
        columns={config.fields.map((f) =>
          f.type === "entity"
            ? {
                key: f.name,
                label: f.label,
                render: (row) => lookups[f.entity].getLabel(row[f.name]),
              }
            : { key: f.name, label: f.label }
        )}
      />
    </div>
  );
}
