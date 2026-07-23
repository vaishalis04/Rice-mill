import { useState, useEffect } from "react";
import {
  getVehiclesDriversApi,
  createVehicleDriverApi,
  updateVehicleDriverApi,
  deleteVehicleDriverApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const TYPE_CONFIG = {
  vehicle: {
    label: "Vehicle",
    fields: [
      { name: "vehicle_no", label: "Vehicle No." },
      { name: "vehicle_type", label: "Vehicle Type" },
      { name: "capacity", label: "Capacity", type: "number" },
      { name: "owner_vendor_id", label: "Owner Vendor", type: "entity", entity: "vendor" },
    ],
  },
  driver: {
    label: "Driver",
    fields: [
      { name: "name", label: "Name" },
      { name: "mobile", label: "Mobile" },
      { name: "license_no", label: "License No." },
    ],
  },
};

function emptyFormFor(type) {
  const form = {};
  TYPE_CONFIG[type].fields.forEach((f) => (form[f.name] = ""));
  return form;
}

export default function VehiclesDriversPage() {
  const [activeType, setActiveType] = useState("vehicle");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyFormFor("vehicle"));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  // NOTE: only "vendor" is looked up here because it's the only entity-type
  // field this page currently has (owner_vendor_id). If you add another
  // entity-type field to TYPE_CONFIG later, add another useEntityLookup()
  // call and branch on f.entity in the columns mapping below.
  const vendors = useEntityLookup("vendor");

  const load = (type) => {
    setLoading(true);
    getVehiclesDriversApi(type)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load ${TYPE_CONFIG[type].label}s`))
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
        await updateVehicleDriverApi(editingId, payload);
      } else {
        await createVehicleDriverApi(payload);
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
      await deleteVehicleDriverApi(id, activeType);
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
      <h2 style={{ marginTop: 0 }}>Vehicles & Drivers</h2>

      <div className="section-tabs">
        {Object.keys(TYPE_CONFIG).map((t) => (
          <button
            key={t}
            className={`section-tab ${activeType === t ? "active" : ""}`}
            onClick={() => setActiveType(t)}
          >
            {TYPE_CONFIG[t].label}s
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
        columns={config.fields.map((f) =>
          f.type === "entity"
            ? { key: f.name, label: f.label, render: (row) => vendors.getLabel(row[f.name]) }
            : { key: f.name, label: f.label }
        )}
      />
    </div>
  );
}
