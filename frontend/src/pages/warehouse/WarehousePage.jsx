import { useState, useEffect } from "react";
import {
  getWarehouseSettingsApi,
  createWarehouseSettingApi,
  updateWarehouseSettingApi,
  deleteWarehouseSettingApi,
  getWarehouseSummaryApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// Warehouse fields only
const WAREHOUSE_CONFIG = {
  label: "Warehouse",
  fields: [
    { name: "name", label: "Name" },
    { name: "warehouse_type", dbField: "type", label: "Warehouse Type" },
    { name: "capacity", label: "Capacity", type: "number" },
    { name: "location", label: "Location" },
  ],
};

function emptyForm() {
  const form = {};
  WAREHOUSE_CONFIG.fields.forEach((f) => (form[f.name] = ""));
  return form;
}

function StockTab() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [warehouseSummary, setWarehouseSummary] = useState(null);
  const [loadingWarehouseSummary, setLoadingWarehouseSummary] = useState(false);

  const warehouses = useEntityLookup("warehouse");

  // Fetch warehouse summary when warehouse changes
  useEffect(() => {
    if (!warehouseFilter) {
      setWarehouseSummary(null);
      return;
    }
    let cancelled = false;
    setLoadingWarehouseSummary(true);
    setError("");
    getWarehouseSummaryApi(warehouseFilter)
      .then((res) => {
        if (!cancelled) {
          setWarehouseSummary(res.data.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.msg || err.response?.data?.message || "Failed to load warehouse details");
          setWarehouseSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingWarehouseSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseFilter]);

  return (
    <div>
      {error && <div className="dt-error">{error}</div>}
      
      <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
        <EntitySelect
          entity="warehouse"
          label="Select Warehouse"
          value={warehouseFilter}
          onChange={(id) => {
            setWarehouseFilter(id);
          }}
          required
        />
      </form>

      {/* Warehouse Summary Display */}
      {warehouseFilter && (
        <div
          style={{
            padding: "16px 20px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            marginTop: 16,
            marginBottom: 16,
          }}
        >
          {loadingWarehouseSummary && (
            <div style={{ color: "#64748b", textAlign: "center", padding: "20px 0" }}>
              Loading warehouse details…
            </div>
          )}
          
          {!loadingWarehouseSummary && warehouseSummary && (
            <>
              {/* Warehouse Header */}
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: "1px solid #e2e8f0"
              }}>
                <div>
                  <h3 style={{ margin: 0, color: "#1e293b" }}>
                    {warehouseSummary.name}
                  </h3>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                    Code: {warehouseSummary.warehouse_code} | Type: {warehouseSummary.type}
                  </div>
                </div>
                <div style={{ 
                  padding: "4px 12px", 
                  background: "#dbeafe", 
                  borderRadius: 12,
                  fontSize: 13,
                  color: "#1e40af"
                }}>
                  ID: {warehouseSummary.warehouse_id}
                </div>
              </div>

              {/* Capacity Stats */}
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
                gap: 16,
                marginBottom: 16
              }}>
                <div style={{ 
                  padding: "12px 16px", 
                  background: "white", 
                  borderRadius: 6,
                  border: "1px solid #e2e8f0"
                }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Total Capacity</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#0f172a" }}>
                    {warehouseSummary.capacity != null ? `${(warehouseSummary.capacity ).toFixed(2)} tons` : "Not set"}
                  </div>
                </div>
                <div style={{ 
                  padding: "12px 16px", 
                  background: "white", 
                  borderRadius: 6,
                  border: "1px solid #e2e8f0"
                }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Current Stock</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#0f172a" }}>
                    {(warehouseSummary.total_stock ).toFixed(2)} tons
                  </div>
                </div>
                <div style={{ 
                  padding: "12px 16px", 
                  background: "white", 
                  borderRadius: 6,
                  border: "1px solid #e2e8f0"
                }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Remaining Capacity</div>
                  <div style={{ 
                    fontSize: 20, 
                    fontWeight: 600, 
                    color: warehouseSummary.remaining_capacity <= 0 ? "#dc2626" : "#166534"
                  }}>
                    {warehouseSummary.remaining_capacity != null 
                      ? `${(warehouseSummary.remaining_capacity ).toFixed(2)} tons`
                      : "Unlimited"}
                  </div>
                </div>
              </div>

              {/* Capacity Bar */}
              {warehouseSummary.capacity != null && warehouseSummary.capacity > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    fontSize: 12,
                    color: "#64748b",
                    marginBottom: 4
                  }}>
                    <span>Used: {((warehouseSummary.total_stock / warehouseSummary.capacity) * 100).toFixed(1)}%</span>
                    <span>Free: {((warehouseSummary.remaining_capacity / warehouseSummary.capacity) * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ 
                    width: "100%", 
                    height: 8, 
                    background: "#e2e8f0", 
                    borderRadius: 4,
                    overflow: "hidden"
                  }}>
                    <div style={{ 
                      width: `${Math.min((warehouseSummary.total_stock / warehouseSummary.capacity) * 100, 100)}%`,
                      height: "100%",
                      background: warehouseSummary.remaining_capacity <= 0 ? "#dc2626" : "#3b82f6",
                      borderRadius: 4,
                      transition: "width 0.3s ease"
                    }} />
                  </div>
                </div>
              )}

              {/* Materials Breakdown */}
              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: 15 }}>
                  Stock by Material
                </h4>
                {warehouseSummary.materials && warehouseSummary.materials.length > 0 ? (
                  <div style={{ 
                    display: "grid", 
                    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", 
                    gap: 8
                  }}>
                    {warehouseSummary.materials.map((m) => (
                      <div key={m.material_id} style={{ 
                        display: "flex", 
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        background: "white",
                        borderRadius: 6,
                        border: "1px solid #e2e8f0",
                        alignItems: "center"
                      }}>
                        <div>
                          <div style={{ fontWeight: 500, color: "#0f172a", fontSize: 14 }}>
                            {m.material_name}
                          </div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            {m.material_code}
                          </div>
                        </div>
                        <div style={{ 
                          fontWeight: 600, 
                          color: "#0f172a",
                          fontSize: 15
                        }}>
                          {(m.qty ).toFixed(2)} tons
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ 
                    padding: "20px", 
                    textAlign: "center", 
                    color: "#64748b",
                    background: "white",
                    borderRadius: 6,
                    border: "1px solid #e2e8f0"
                  }}>
                    No stock currently in this warehouse.
                  </div>
                )}
              </div>
            </>
          )}
          
          {!loadingWarehouseSummary && !warehouseSummary && warehouseFilter && (
            <div style={{ color: "#dc2626", textAlign: "center", padding: "20px 0" }}>
              Could not load warehouse details.
            </div>
          )}
        </div>
      )}

      {!warehouseFilter && (
        <div style={{ 
          textAlign: "center", 
          padding: "40px 20px", 
          color: "#94a3b8",
          fontSize: 14
        }}>
          Select a warehouse above to view its stock summary
        </div>
      )}
    </div>
  );
}

export default function WarehousePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [showStock, setShowStock] = useState(false);

  const lookups = {
    warehouse: useEntityLookup("warehouse"),
  };

  const load = () => {
    setLoading(true);
    getWarehouseSettingsApi("warehouse")
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError(`Failed to load warehouses`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (showStock) return;
    load();
    setForm(emptyForm());
    setEditingId(null);
    setError("");
  }, [showStock]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const payload = { type: "warehouse", ...form };
    WAREHOUSE_CONFIG.fields
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
      setForm(emptyForm());
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    const next = emptyForm();
    WAREHOUSE_CONFIG.fields.forEach((f) => {
      next[f.name] = row[f.dbField || f.name] ?? "";
    });
    setForm(next);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this warehouse?")) return;
    try {
      await deleteWarehouseSettingApi(id, "warehouse");
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Warehouse Management</h2>

      <div className="section-tabs">
        <button
          className={`section-tab ${!showStock ? "active" : ""}`}
          onClick={() => setShowStock(false)}
        >
          Warehouses
        </button>
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
            {WAREHOUSE_CONFIG.fields.map((f) => (
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
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="sf-submit" type="submit">
                {editingId ? `Update Warehouse` : `Add Warehouse`}
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
            columns={WAREHOUSE_CONFIG.fields.map((f) => ({
              key: f.dbField || f.name,
              label: f.label,
            }))}
          />
        </>
      )}
      
      <ModuleGuide
        title="Warehouse Management"
        steps={[
          "Set up your Warehouses with name, type, capacity, and location.",
          "The Stock tab shows a live snapshot of what's actually sitting in each warehouse.",
          "Select a warehouse to view its capacity, current stock, remaining space, and stock breakdown by material.",
          "Warehouses are used during the unloading process to store accepted materials.",
        ]}
      />
    </div>
  );
}