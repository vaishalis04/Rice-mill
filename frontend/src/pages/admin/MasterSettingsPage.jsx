import { useState, useEffect } from "react";
import {
  getMasterSettingsApi,
  createMasterSettingApi,
  updateMasterSettingApi,
  deleteMasterSettingApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

// Each sub-type's own fields (besides `type`, which is added automatically)
const TYPE_CONFIG = {
  uom: {
    label: "UOM",
    fields: [
      { name: "uom_code", label: "UOM Code" },
      { name: "name", label: "Name" },
      { name: "conversion_factor", label: "Conversion Factor", type: "number" },
    ],
  },
  variety: {
    label: "Variety",
    fields: [
      { name: "variety_name", label: "Variety Name" },
      { name: "grain_type", label: "Grain Type" },
    ],
  },
  material: {
    label: "Material",
    fields: [
      { name: "material_code", label: "Material Code" },
      { name: "name", label: "Name" },
      { name: "category", label: "Category" },
      { name: "uom_id", label: "UOM", type: "entity", entity: "uom" },
      { name: "variety_id", label: "Variety", type: "entity", entity: "variety" },
    ],
  },
  plant: {
    label: "Plant",
    fields: [
      { name: "plant_code", label: "Plant Code" },
      { name: "name", label: "Name" },
      { name: "location", label: "Location" },
    ],
  },
  rate: {
    label: "Rate",
    fields: [
      { name: "material_id", label: "Material", type: "entity", entity: "material" },
      { name: "rate", label: "Rate", type: "number" },
      { name: "effective_date", label: "Effective Date", type: "date" },
    ],
  },
  quality_parameter: {
    label: "Quality Parameter",
    fields: [
      { name: "param_code", label: "Param Code" },
      { name: "name", label: "Name" },
      { name: "uom", label: "Unit" },
    ],
  },
  reason_code: {
    label: "Reason Code",
    fields: [
      { name: "code", label: "Code" },
      { name: "description", label: "Description" },
    ],
  },
};

// NOTE: `plant`, `rate`, `quality_parameter`, `reason_code` field lists above
// are guesses (the API docs only gave full examples for uom/variety/material
// and said "same pattern applies" for the rest) — adjust field names/types
// here if the backend expects different ones; everything else just works.

const TYPES = Object.keys(TYPE_CONFIG);

function emptyFormFor(type) {
  const form = {};
  TYPE_CONFIG[type].fields.forEach((f) => (form[f.name] = ""));
  return form;
}

export default function MasterSettingsPage() {
  const [activeType, setActiveType] = useState("uom");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyFormFor("uom"));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const load = (type) => {
    setLoading(true);
    getMasterSettingsApi(type)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load ${TYPE_CONFIG[type].label}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(activeType);
    setForm(emptyFormFor(activeType));
    setEditingId(null);
    setError("");
  }, [activeType]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { type: activeType, ...form };
    try {
      if (editingId) {
        await updateMasterSettingApi(editingId, payload);
      } else {
        await createMasterSettingApi(payload);
      }
      setForm(emptyFormFor(activeType));
      setEditingId(null);
      load(activeType);
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
      await deleteMasterSettingApi(id, activeType);
      load(activeType);
    } catch {
      setError("Delete failed");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyFormFor(activeType));
  };

  const config = TYPE_CONFIG[activeType];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Master Settings</h2>

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

      <DataTable
        loading={loading}
        rows={rows}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={config.fields.map((f) => ({ key: f.name, label: f.label }))}
      />
    </div>
  );
}
