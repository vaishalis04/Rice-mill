import { useState, useEffect } from "react";
import {
  getWarehouseEntitiesApi,
  createWarehouseEntityApi,
  updateWarehouseEntityApi,
  deleteWarehouseEntityApi,
  getWarehouseStockApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

// Each sub-type's own fields (besides `type`, which is added automatically).
// `filterBy` on an entity field narrows its dropdown using another field's
// current value — e.g. Bin only shows bins belonging to the picked Warehouse.
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
      {
        name: "bin_id",
        label: "Bin",
        type: "entity",
        entity: "bin",
        filterBy: "warehouse_id",
      },
      { name: "qty", label: "Qty", type: "number" },
      {
        name: "stacked_at",
        label: "Stacked At",
        placeholder: "e.g. 2026-07-11T12:00:00Z",
      },
    ],
  },
};

const TABS = [...Object.keys(TYPE_CONFIG), "stock"];

function emptyFormFor(type) {
  const form = {};
  TYPE_CONFIG[type].fields.forEach((f) => (form[f.name] = ""));
  return form;
}

export default function WarehousePage() {
  const [activeTab, setActiveTab] = useState("warehouse");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyFormFor("warehouse"));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  // Stock tab state (read-only)
  const [stockWarehouse, setStockWarehouse] = useState("");
  const [stockMaterial, setStockMaterial] = useState("");
  const [stock, setStock] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);

  const loadRows = (type) => {
    setLoading(true);
    getWarehouseEntitiesApi(type)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load ${TYPE_CONFIG[type].label}`))
      .finally(() => setLoading(false));
  };

  const loadStock = (warehouse_id = stockWarehouse, material_id = stockMaterial) => {
    setStockLoading(true);
    const params = {};
    if (warehouse_id) params.warehouse_id = warehouse_id;
    if (material_id) params.material_id = material_id;
    getWarehouseStockApi(params)
      .then((res) => setStock(res.data.data ?? res.data))
      .catch(() => setError("Failed to load stock"))
      .finally(() => setStockLoading(false));
  };

  useEffect(() => {
    setError("");
    if (activeTab === "stock") {
      loadStock();
    } else {
      loadRows(activeTab);
      setForm(emptyFormFor(activeTab));
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { type: activeTab, ...form };
    try {
      if (editingId) {
        await updateWarehouseEntityApi(editingId, payload);
      } else {
        await createWarehouseEntityApi(payload);
      }
      setForm(emptyFormFor(activeTab));
      setEditingId(null);
      loadRows(activeTab);
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    const next = emptyFormFor(activeTab);
    Object.keys(next).forEach((key) => {
      next[key] = row[key] ?? "";
    });
    setForm(next);
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyFormFor(activeTab));
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    try {
      await deleteWarehouseEntityApi(id, activeTab);
      loadRows(activeTab);
    } catch {
      setError("Delete failed");
    }
  };

  const config = activeTab === "stock" ? null : TYPE_CONFIG[activeTab];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Warehouse</h2>

      <div className="section-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`section-tab ${activeTab === t ? "active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t === "stock" ? "Current Stock" : TYPE_CONFIG[t].label}
          </button>
        ))}
      </div>

      {error && <div className="dt-error">{error}</div>}

      {activeTab === "stock" ? (
        <>
          <div className="sf-form">
            <EntitySelect
              entity="warehouse"
              label="Warehouse"
              value={stockWarehouse}
              onChange={(id) => {
                setStockWarehouse(id);
                loadStock(id, stockMaterial);
              }}
            />
            <EntitySelect
              entity="material"
              label="Material"
              value={stockMaterial}
              onChange={(id) => {
                setStockMaterial(id);
                loadStock(stockWarehouse, id);
              }}
            />
          </div>
          <DataTable
            loading={stockLoading}
            rows={stock}
            columns={[
              { key: "lot_id", label: "Lot ID" },
              { key: "warehouse_id", label: "Warehouse ID" },
              { key: "material_id", label: "Material ID" },
              { key: "stage", label: "Stage" },
              { key: "qty", label: "Qty" },
            ]}
          />
        </>
      ) : (
        <>
          <form className="sf-form" onSubmit={handleSubmit}>
            {config.fields.map((f) =>
              f.type === "entity" ? (
                <EntitySelect
                  key={f.name}
                  entity={f.entity}
                  label={f.label}
                  value={form[f.name] ?? ""}
                  onChange={(id) => setForm({ ...form, [f.name]: id })}
                  filter={
                    f.filterBy
                      ? (row) =>
                          String(row.warehouse_id) === String(form[f.filterBy])
                      : undefined
                  }
                  required
                />
              ) : (
                <div className="sf-field" key={f.name}>
                  <label>{f.label}</label>
                  <input
                    name={f.name}
                    type={f.type || "text"}
                    step={f.type === "number" ? "any" : undefined}
                    placeholder={f.placeholder}
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
        </>
      )}
    </div>
  );
}
