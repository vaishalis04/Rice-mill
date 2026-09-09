import { useState, useEffect, useMemo } from "react";
import {
  getWarehouseSettingsApi,
  createWarehouseSettingApi,
  updateWarehouseSettingApi,
  deleteWarehouseSettingApi,
  getWarehouseStockDetailApi,
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
  const [viewAllWarehouses, setViewAllWarehouses] = useState(false);
  const [stockDetail, setStockDetail] = useState(null);

  // Stock-tab filters (client-side, applied to whatever scope is loaded)
  const [materialNameFilter, setMaterialNameFilter] = useState("");
  const [packSizeFilter, setPackSizeFilter] = useState("");

  const hasScope = viewAllWarehouses || !!warehouseFilter;

  // Fetch stock detail whenever the scope (single warehouse vs all) changes
  useEffect(() => {
    if (!hasScope) {
      setStockDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    getWarehouseStockDetailApi(viewAllWarehouses ? null : warehouseFilter)
      .then((res) => {
        if (!cancelled) setStockDetail(res.data.data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.msg || err.response?.data?.message || "Failed to load stock details");
          setStockDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewAllWarehouses, warehouseFilter, hasScope]);

  const handleToggleAllWarehouses = () => {
    setViewAllWarehouses((prev) => {
      const next = !prev;
      if (next) setWarehouseFilter("");
      return next;
    });
  };

  // Distinct bag sizes present in the currently loaded raw_stock and
  // packed_stock combined, for the bag-size filter dropdown.
  const availablePackSizes = useMemo(() => {
    const rawSizes = (stockDetail?.raw_stock || []).map((m) => m.bag_size).filter((s) => s != null);
    const packedSizes = (stockDetail?.packed_stock || []).map((p) => p.pack_size);
    const sizes = [...new Set([...rawSizes, ...packedSizes])];
    return sizes.sort((a, b) => a - b);
  }, [stockDetail]);

  const filteredRawStock = useMemo(() => {
    if (!stockDetail?.raw_stock) return [];
    const q = materialNameFilter.trim().toLowerCase();
    return stockDetail.raw_stock.filter((m) => {
      const matchesName = !q || m.material_name?.toLowerCase().includes(q);
      const matchesBagSize = !packSizeFilter || String(m.bag_size) === String(packSizeFilter);
      return matchesName && matchesBagSize;
    });
  }, [stockDetail, materialNameFilter, packSizeFilter]);

  const filteredPackedStock = useMemo(() => {
    if (!stockDetail?.packed_stock) return [];
    const q = materialNameFilter.trim().toLowerCase();
    return stockDetail.packed_stock.filter((p) => {
      const matchesName = !q || p.material_name?.toLowerCase().includes(q);
      const matchesPackSize = !packSizeFilter || String(p.pack_size) === String(packSizeFilter);
      return matchesName && matchesPackSize;
    });
  }, [stockDetail, materialNameFilter, packSizeFilter]);

  // One card per material, combining every bag size it has — raw and
  // packed alike — plus a total across all of them.
  const materialGroups = useMemo(() => {
    const groups = new Map();

    const addRow = (materialId, materialName, materialCode, stage, bagSize, bagCount, qty) => {
      const existing = groups.get(materialId) || {
        material_id: materialId,
        material_name: materialName,
        material_code: materialCode,
        total_qty: 0,
        rows: [],
      };
      existing.total_qty += qty;
      existing.rows.push({ stage, bag_size: bagSize, bag_count: bagCount, qty });
      groups.set(materialId, existing);
    };

    filteredRawStock.forEach((m) =>
      addRow(m.material_id, m.material_name, m.material_code, "raw", m.bag_size, m.bag_count, m.qty)
    );
    filteredPackedStock.forEach((p) =>
      addRow(p.material_id, p.material_name, p.material_code, "packed", p.pack_size, p.bag_count, p.qty_tons)
    );

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        rows: g.rows.sort((a, b) => (a.bag_size ?? -1) - (b.bag_size ?? -1)),
      }))
      .sort((a, b) => b.total_qty - a.total_qty);
  }, [filteredRawStock, filteredPackedStock]);

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
            if (id) setViewAllWarehouses(false);
          }}
        />
        <div className="sf-field" style={{ marginBottom: 0, display: "flex", alignItems: "end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500, cursor: "pointer" }}>
            <input type="checkbox" checked={viewAllWarehouses} onChange={handleToggleAllWarehouses} />
            View all warehouses combined
          </label>
        </div>
      </form>

      {hasScope && (
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
          {loading && (
            <div style={{ color: "#64748b", textAlign: "center", padding: "20px 0" }}>
              Loading stock details…
            </div>
          )}

          {!loading && stockDetail && (
            <>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                  paddingBottom: 12,
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, color: "#1e293b" }}>{stockDetail.name}</h3>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                    {stockDetail.warehouse_code
                      ? `Code: ${stockDetail.warehouse_code} | Type: ${stockDetail.type}`
                      : "Combined across every warehouse"}
                  </div>
                </div>
                {stockDetail.warehouse_id && (
                  <div
                    style={{
                      padding: "4px 12px",
                      background: "#dbeafe",
                      borderRadius: 12,
                      fontSize: 13,
                      color: "#1e40af",
                    }}
                  >
                    ID: {stockDetail.warehouse_id}
                  </div>
                )}
              </div>

              {/* Capacity Stats */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div style={{ padding: "12px 16px", background: "white", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Total Capacity</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#0f172a" }}>
                    {stockDetail.capacity != null ? `${stockDetail.capacity.toFixed(2)} tons` : "Not set"}
                  </div>
                </div>
                <div style={{ padding: "12px 16px", background: "white", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Current Stock (raw + packed)</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#0f172a" }}>
                    {stockDetail.total_stock.toFixed(2)} tons
                  </div>
                </div>
                <div style={{ padding: "12px 16px", background: "white", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Remaining Capacity</div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: stockDetail.remaining_capacity <= 0 ? "#dc2626" : "#166534",
                    }}
                  >
                    {stockDetail.remaining_capacity != null ? `${stockDetail.remaining_capacity.toFixed(2)} tons` : "Unlimited"}
                  </div>
                </div>
              </div>

              {stockDetail.capacity != null && stockDetail.capacity > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                    <span>Used: {((stockDetail.total_stock / stockDetail.capacity) * 100).toFixed(1)}%</span>
                    <span>Free: {((stockDetail.remaining_capacity / stockDetail.capacity) * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.min((stockDetail.total_stock / stockDetail.capacity) * 100, 100)}%`,
                        height: "100%",
                        background: stockDetail.remaining_capacity <= 0 ? "#dc2626" : "#3b82f6",
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Filters */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 12,
                  marginBottom: 20,
                  padding: "12px",
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                }}
              >
                <div className="sf-field" style={{ marginBottom: 0 }}>
                  <label>Filter by material name</label>
                  <input
                    type="text"
                    placeholder="e.g. Paddy"
                    value={materialNameFilter}
                    onChange={(e) => setMaterialNameFilter(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14 }}
                  />
                </div>
                <div className="sf-field" style={{ marginBottom: 0 }}>
                  <label>Filter by bag size (kg)</label>
                  <select
                    value={packSizeFilter}
                    onChange={(e) => setPackSizeFilter(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14 }}
                  >
                    <option value="">All bag sizes</option>
                    {availablePackSizes.map((size) => (
                      <option key={size} value={size}>{`${size} kg`}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stock by Material — one box per material, all its bag
                  sizes (raw and packed) listed inside, plus a total. */}
              <div>
                <h4 style={{ margin: "0 0 12px 0", color: "#1e293b", fontSize: 15 }}>
                  Stock by Material
                </h4>
                {materialGroups.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                    {materialGroups.map((g) => (
                      <div
                        key={g.material_id}
                        style={{
                          background: "white",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          padding: "12px 16px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            marginBottom: 8,
                            paddingBottom: 8,
                            borderBottom: "1px solid #f1f5f9",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 14 }}>{g.material_name}</div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{g.material_code}</div>
                          </div>
                          <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 16 }}>
                            {g.total_qty.toFixed(2)} tons
                          </div>
                        </div>
                        {g.rows.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 13,
                              padding: "4px 0",
                              color: "#334155",
                            }}
                          >
                            <span>
                              {r.bag_size != null ? `${r.bag_size} kg` : "Bulk"}
                              {r.bag_count != null && ` × ${r.bag_count} bag${r.bag_count === 1 ? "" : "s"}`}
                              <span style={{ color: "#94a3b8" }}> ({r.stage === "raw" ? "raw" : "packed"})</span>
                            </span>
                            <span style={{ fontWeight: 500 }}>{r.qty.toFixed(3)} tons</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "16px", textAlign: "center", color: "#64748b", background: "white", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                    {stockDetail.raw_stock.length === 0 && stockDetail.packed_stock.length === 0
                      ? "No stock currently here."
                      : "No stock matches the current filter."}
                  </div>
                )}
              </div>
            </>
          )}

          {!loading && !stockDetail && hasScope && (
            <div style={{ color: "#dc2626", textAlign: "center", padding: "20px 0" }}>Could not load stock details.</div>
          )}
        </div>
      )}

      {!hasScope && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8", fontSize: 14 }}>
          Select a warehouse above, or check "View all warehouses combined", to see stock.
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
          "The Stock tab shows a live snapshot of what's actually sitting in each warehouse — one box per material, listing every bag size it has (raw and packed) with a total in tons.",
          "Select a warehouse, or check 'View all warehouses combined', to see its capacity, current stock, and breakdown.",
          "Use the material name and bag size filters on the Stock tab to narrow down what you're looking at.",
          "Raw stock bag counts are estimated from remaining tons ÷ bag size — production consumption is tracked in tons, not whole bags, so this drifts from the literal count once part of a lot has been used. Packed stock bag counts are exact.",
          "Warehouses are used during the unloading process to store accepted materials.",
        ]}
      />
    </div>
  );
}