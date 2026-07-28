import { useState, useEffect } from "react";
import {
  getWarehouseSettingsApi,
  createWarehouseSettingApi,
  updateWarehouseSettingApi,
  deleteWarehouseSettingApi,
  getWarehouseStockApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// Each sub-type's own fields (besides `type`, which is added automatically)
const TYPE_CONFIG = {
  warehouse: {
    label: "Warehouse",
    fields: [
      { name: "warehouse_code", label: "Warehouse Code" },
      { name: "name", label: "Name" },
      { name: "warehouse_type", label: "Warehouse Type" },
      { name: "capacity", label: "Capacity", type: "number" },
    ],
  },
  bin: {
    label: "Bin",
    fields: [
      { name: "bin_code", label: "Bin Code" },
      { name: "warehouse_id", label: "Warehouse", type: "entity", entity: "warehouse" },
      { name: "capacity", label: "Capacity", type: "number" },
    ],
  },
  stack: {
    label: "Stack",
    fields: [
      { name: "stack_code", label: "Stack Code" },
      { name: "lot_id", label: "Lot", type: "entity", entity: "lot" },
      { name: "warehouse_id", label: "Warehouse", type: "entity", entity: "warehouse" },
      { name: "bin_id", label: "Bin", type: "entity", entity: "bin" },
      { name: "qty", label: "Qty", type: "number" },
      { name: "stacked_at", label: "Stacked At", type: "datetime-local" },
    ],
  },
};

const TYPES = Object.keys(TYPE_CONFIG);

function emptyFormFor(type) {
  const form = {};
  TYPE_CONFIG[type].fields.forEach((f) => (form[f.name] = ""));
  return form;
}

function StockTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");

  const warehouses = useEntityLookup("warehouse");
  const materials = useEntityLookup("material");
  const lots = useEntityLookup("lot");

  const load = (warehouse_id = warehouseFilter, material_id = materialFilter) => {
    setLoading(true);
    const params = {};
    if (warehouse_id) params.warehouse_id = warehouse_id;
    if (material_id) params.material_id = material_id;
    getWarehouseStockApi(params)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load stock"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {error && <div className="dt-error">{error}</div>}
      <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={warehouseFilter}
          onChange={(id) => {
            setWarehouseFilter(id);
            load(id, materialFilter);
          }}
        />
        <EntitySelect
          entity="material"
          label="Material"
          value={materialFilter}
          onChange={(id) => {
            setMaterialFilter(id);
            load(warehouseFilter, id);
          }}
        />
      </form>

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          {
            key: "lot_id",
            label: "Lot",
            // Stock rows come back enriched with lot/material/warehouse
            // details per the API docs — fall back to a plain id lookup if
            // the backend ever returns bare ids instead.
            render: (row) => row.lot?.lot_no ?? lots.getLabel(row.lot_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => row.material?.name ?? materials.getLabel(row.material_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) => row.warehouse?.name ?? warehouses.getLabel(row.warehouse_id),
          },
          { key: "qty", label: "Qty" },
          { key: "stage", label: "Stage" },
        ]}
      />
    </div>
  );
}

export default function WarehousePage() {
  const [activeType, setActiveType] = useState("warehouse");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyFormFor("warehouse"));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [showStock, setShowStock] = useState(false);

  // Used to render entity-type columns (warehouse_id, bin_id, lot_id) as
  // names instead of raw ids in the table below.
  const lookups = {
    warehouse: useEntityLookup("warehouse"),
    bin: useEntityLookup("bin"),
    lot: useEntityLookup("lot"),
  };

  const load = (type) => {
    setLoading(true);
    getWarehouseSettingsApi(type)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load ${TYPE_CONFIG[type].label}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (showStock) return;
    load(activeType);
    setForm(emptyFormFor(activeType));
    setEditingId(null);
    setError("");
  }, [activeType, showStock]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { type: activeType, ...form };
    TYPE_CONFIG[activeType].fields
      .filter((f) => f.type === "number")
      .forEach((f) => {
        if (payload[f.name] !== "") payload[f.name] = Number(payload[f.name]);
      });
    try {
      if (editingId) {
        await updateWarehouseSettingApi(editingId, payload);
      } else {
        await createWarehouseSettingApi(payload);
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
      await deleteWarehouseSettingApi(id, activeType);
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
      <h2 style={{ marginTop: 0 }}>Warehouse / Bin / Stack</h2>

      <div className="section-tabs">
        {TYPES.map((t) => (
          <button
            key={t}
            className={`section-tab ${!showStock && activeType === t ? "active" : ""}`}
            onClick={() => {
              setShowStock(false);
              setActiveType(t);
            }}
          >
            {TYPE_CONFIG[t].label}
          </button>
        ))}
        <button
          className={`section-tab ${showStock ? "active" : ""}`}
          onClick={() => setShowStock(true)}
        >
          Stock
        </button>
      </div>

      {showStock ? (
        <StockTab />
      ) : (
        <>
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
                  creatable={f.entity === "warehouse"}
                  context={f.entity === "bin" ? { warehouse_id: form.warehouse_id } : undefined}
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
        </>
      )}
      <ModuleGuide
        title="Warehouse / Bin / Stack"
        steps={[
          "Set up your Warehouses and the Bins inside them once — after that they're just picked from a dropdown every time a Lot is unloaded.",
          "Stacks (the physical pile in a bin) are normally opened automatically when a Lot is created — manual entry here is only for corrections.",
          "The Stock tab shows a live snapshot of what's actually sitting in each warehouse right now.",
        ]}
      />
    </div>
  );
}
