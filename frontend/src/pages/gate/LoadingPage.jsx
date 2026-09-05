import { useState, useEffect } from "react";
import {
  getLoadingsApi,
  createLoadingApi,
  updateLoadingApi,
  deleteLoadingApi,
  updateSalesOrderApi,
  getGateEntryByIdApi,
  getSalesOrderByIdApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = { gate_entry_id: "", loaded_qty: "", remarks: "" };

export default function LoadingPage() {
  const [loadings, setLoadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [selectedItems, setSelectedItems] = useState([]);
  const [materialQuantities, setMaterialQuantities] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [completingSoId, setCompletingSoId] = useState(null);
  const [gateEntryMaterials, setGateEntryMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  // When editing an existing loading, this holds its ORIGINAL per-material
  // breakdown (material_id -> qty) so remaining capacity can be computed
  // correctly — this load's own prior contribution should count back
  // towards what's available to re-assign, not be treated as already gone.
  const [editingOwnQuantities, setEditingOwnQuantities] = useState({});
  // The Sales Order id this specific loading record belongs to (from
  // row.so_id) — used so editing can pull materials straight from the SO
  // itself instead of depending on the Gate Entry's own junction rows,
  // which aren't always populated for older/manually-created entries.
  const [editingSoId, setEditingSoId] = useState(null);

  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const salesOrders = useEntityLookup("sales_order");
  const materials = useEntityLookup("material");

  const getGateEntryRow = (gate_entry_id) =>
    gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id));

  const selectedGateEntry = getGateEntryRow(form.gate_entry_id);

  // Fetch gate entry details with sales orders when selected
  useEffect(() => {
    const fetchGateEntryDetails = async () => {
      if (!form.gate_entry_id) {
        setGateEntryMaterials([]);
        return;
      }

      setLoadingMaterials(true);
      try {
        let materialsWithDetails = [];

        if (editingId && editingSoId) {
          // EDIT MODE: source materials straight from the Sales Order
          // itself, not the gate entry's junction rows — the loading
          // record's own so_id + material_quantities are all we need,
          // and this works even for gate entries whose junction data
          // wasn't populated (older entries, manual test data, etc).
          const soRes = await getSalesOrderByIdApi(editingSoId);
          const so = soRes.data.data || soRes.data;
          const items = Array.isArray(so.items) ? so.items : [];

          materialsWithDetails = items.map((item) => {
            const orderedQty = Number(item.qty || 0);
            const dispatchedQty = Number(item.dispatched_qty || 0);
            const ownQtyForThisMaterial = Number(
              editingOwnQuantities[item.material_id] || 0
            );
            const remainingQty = orderedQty - dispatchedQty + ownQtyForThisMaterial;
            const uniqueKey = `${so.id}-${item.material_id}`;

            return {
              id: uniqueKey,
              so_id: so.id,
              material_id: item.material_id,
              material_name:
                item.material?.name ||
                materials.rows.find((m) => String(m.id) === String(item.material_id))?.name ||
                `Material ${item.material_id}`,
              so_no: so.so_no,
              ordered_qty: orderedQty,
              dispatched_qty: dispatchedQty,
              remaining_qty: Math.max(remainingQty, 0),
              is_fully_loaded: remainingQty <= 0,
              so_status: so.so_status || "pending",
            };
          });
        } else {
          // CREATE MODE: source materials from the gate entry's own
          // sales_orders junction, same as before.
          const response = await getGateEntryByIdApi(form.gate_entry_id);
          const gateEntry = response.data.data || response.data;

          if (gateEntry && gateEntry.sales_orders && gateEntry.sales_orders.length > 0) {
            materialsWithDetails = gateEntry.sales_orders.map((so) => {
              const material = materials.rows.find((m) => String(m.id) === String(so.material_id));

              const orderedQty = Number(so.ordered_qty || so.qty || 0);
              const dispatchedQty = Number(so.dispatched_qty || 0);
              const remainingQty = orderedQty - dispatchedQty;

              const uniqueKey = `${so.so_id}-${so.material_id}`;

              return {
                id: uniqueKey,
                so_id: so.so_id,
                material_id: so.material_id,
                material_name: material?.name || `Material ${so.material_id}`,
                so_no: so.sales_order?.so_no || `SO-${so.so_id}`,
                ordered_qty: orderedQty,
                dispatched_qty: dispatchedQty,
                remaining_qty: Math.max(remainingQty, 0),
                is_fully_loaded: remainingQty <= 0,
                so_status: so.sales_order?.so_status || "pending",
              };
            });
          }
        }

        setGateEntryMaterials(materialsWithDetails);
      } catch (err) {
        console.error("Failed to fetch gate entry details:", err);
        setGateEntryMaterials([]);
      } finally {
        setLoadingMaterials(false);
      }
    };

    fetchGateEntryDetails();
  }, [form.gate_entry_id, salesOrders.rows, materials.rows, editingId, editingSoId, editingOwnQuantities]);

  const availableMaterials = gateEntryMaterials;
  const isAnyMaterialAvailable = availableMaterials.some(m => {
    const available =
      m.remaining_qty > 0 &&
      (editingId || !['dispatched', 'closed', 'cancelled'].includes(m.so_status));
    return available;
  });
  
  // Calculate total remaining quantity
  const totalRemainingQty = availableMaterials.reduce((sum, m) => {
    if (selectedItems.includes(m.id) && m.remaining_qty > 0) {
      return sum + m.remaining_qty;
    }
    return sum;
  }, 0);
  
  // Calculate total loaded quantity from material quantities
  const totalLoadedQty = Object.values(materialQuantities).reduce((sum, val) => {
    return sum + (Number(val) || 0);
  }, 0);

  const load = () => {
    setLoading(true);
    getLoadingsApi()
      .then((res) => setLoadings(res.data.data ?? res.data))
      .catch(() => setError("Failed to load loading records"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const handleGateEntryChange = (gate_entry_id) => {
    setForm({ ...form, gate_entry_id });
    setSelectedItems([]);
    setMaterialQuantities({});
    setGateEntryMaterials([]);
  };

  const toggleItemSelection = (materialId) => {
    console.log("Toggling selection for:", materialId);
    setSelectedItems(prev => {
      const newSelection = prev.includes(materialId)
        ? prev.filter(id => id !== materialId)
        : [...prev, materialId];
      
      // Clean up quantities for deselected items
      const newQuantities = { ...materialQuantities };
      if (!newSelection.includes(materialId)) {
        delete newQuantities[materialId];
      }
      setMaterialQuantities(newQuantities);
      
      return newSelection;
    });
  };

  const handleQuantityChange = (materialId, value) => {
    const material = availableMaterials.find(m => m.id === materialId);
    if (!material) return;
    
    const numValue = Number(value) || 0;
    
    if (numValue > material.remaining_qty) {
      setError(`Cannot exceed remaining quantity of ${material.remaining_qty} for ${material.material_name}`);
      return;
    }
    
    setMaterialQuantities(prev => ({
      ...prev,
      [materialId]: numValue
    }));
    setError("");
  };

  // Shared by both create and edit: turn the current selectedItems +
  // materialQuantities state into a validated material_quantities[]
  // payload, and return it together with the computed total.
  const buildMaterialQuantitiesPayload = () => {
    if (selectedItems.length === 0) {
      throw new Error("Please select at least one material to load");
    }

    const quantities = [];
    let totalQty = 0;

    for (const materialId of selectedItems) {
      const qty = Number(materialQuantities[materialId] || 0);
      const material = availableMaterials.find((m) => m.id === materialId);

      if (qty <= 0) {
        throw new Error(`Please enter quantity for ${material?.material_name || "material"}`);
      }
      if (!material) {
        throw new Error(`Material not found`);
      }
      if (qty > material.remaining_qty) {
        throw new Error(`Quantity for ${material.material_name} exceeds remaining (${material.remaining_qty})`);
      }

      quantities.push({
        so_id: Number(material.so_id),
        material_id: Number(material.material_id),
        qty,
      });
      totalQty += qty;
    }

    if (Math.abs(totalQty - Number(form.loaded_qty || 0)) > 0.01) {
      throw new Error(`Total material quantities (${totalQty}) must equal loaded_qty (${form.loaded_qty || 0})`);
    }
    if (totalQty === 0) {
      throw new Error("Total loaded quantity must be greater than 0");
    }

    return { quantities, totalQty };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLastResult(null);
    
    try {
      if (editingId) {
        const { quantities, totalQty } = buildMaterialQuantitiesPayload();

        await updateLoadingApi(editingId, {
          loaded_qty: totalQty,
          remarks: form.remarks,
          material_quantities: quantities,
        });
        setInfo("Loading record updated — material breakdown saved.");
        gateEntries.refetch();
        salesOrders.refetch();
        materials.refetch();
      } else {
        const { quantities, totalQty } = buildMaterialQuantitiesPayload();

        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          loaded_qty: totalQty,
          material_quantities: quantities
        };
        
        if (form.remarks) payload.remarks = form.remarks;
        
        const res = await createLoadingApi(payload);
        setInfo(
          res.data.msg ||
            "Loading recorded — gate entry moved to 'loaded', ready for check-out."
        );
        setLastResult({
          results: res.data.results || [],
          all_fully_loaded: res.data.all_fully_loaded
        });
        gateEntries.refetch();
        salesOrders.refetch();
        materials.refetch();
      }
      setForm(emptyForm);
      setSelectedItems([]);
      setMaterialQuantities({});
      setEditingOwnQuantities({});
      setEditingId(null);
      setEditingSoId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.msg ||
          err.response?.data?.message ||
          err.message ||
          "Save failed — please check your inputs."
      );
    }
  };

  const handleMarkCompleted = async () => {
    if (!lastResult) return;
    setCompletingSoId(true);
    setError("");
    try {
      // Mark all orders as completed
      for (const result of lastResult.results) {
        if (!result.is_fully_loaded) {
          await updateSalesOrderApi(result.so_id, { so_status: "closed" });
        }
      }
      setInfo(`Sales Order(s) marked completed with remaining quantities.`);
      setLastResult(null);
      salesOrders.refetch();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not mark the order completed");
    } finally {
      setCompletingSoId(null);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setEditingSoId(row.so_id || null);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      loaded_qty: row.loaded_qty ?? "",
      remarks: row.remarks || "",
    });

    const existingBreakdown = Array.isArray(row.material_quantities)
      ? row.material_quantities
      : [];

    if (existingBreakdown.length > 0) {
      const keys = [];
      const quantities = {};
      const ownByMaterial = {};

      existingBreakdown.forEach((m) => {
        const uniqueKey = `${m.so_id}-${m.material_id}`;
        keys.push(uniqueKey);
        quantities[uniqueKey] = Number(m.qty) || 0;
        ownByMaterial[m.material_id] = Number(m.qty) || 0;
      });

      setSelectedItems(keys);
      setMaterialQuantities(quantities);
      setEditingOwnQuantities(ownByMaterial);
    } else {
      setSelectedItems([]);
      setMaterialQuantities({});
      setEditingOwnQuantities({});
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingSoId(null);
    setForm(emptyForm);
    setSelectedItems([]);
    setMaterialQuantities({});
    setEditingOwnQuantities({});
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this loading record?")) return;
    try {
      await deleteLoadingApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Loading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={handleGateEntryChange}
          filter={(row) => row.entry_type === "sales" && row.gate_status === "waiting_loading"}
          required={!editingId}
          disabled={!!editingId}
        />
        
        {selectedGateEntry && (
          <>
            <div className="sf-field">
              <label>Details</label>
              <div
                style={{
                  padding: "8px 10px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <div><strong>Vehicle:</strong> {vehicles.getLabel(selectedGateEntry.vehicle_id)}</div>
                <div><strong>Driver:</strong> {drivers.getLabel(selectedGateEntry.driver_id)}</div>
                <div><strong>Token:</strong> {selectedGateEntry.token_no}</div>
              </div>
            </div>
            
            {/* Materials Selection */}
            <div className="sf-field">
              <label>{editingId ? "Edit Materials in This Load" : "Materials to Load"}</label>
              <div
                style={{
                  padding: "8px 10px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                {loadingMaterials && (
                  <div style={{ color: "#64748b" }}>Loading materials...</div>
                )}
                
                {!loadingMaterials && availableMaterials.length === 0 && (
                  <div style={{ color: "#64748b" }}>
                    No materials found for this gate entry.
                  </div>
                )}
                
                {!loadingMaterials && availableMaterials.length > 0 && (
                  <>
                    {availableMaterials.map((material, idx) => {
                      const isSelected = selectedItems.includes(material.id);
                      const isSelectable =
                        material.remaining_qty > 0 &&
                        (editingId || !['dispatched', 'closed', 'cancelled'].includes(material.so_status));
                      const currentQty = materialQuantities[material.id] || '';
                      
                      return (
                        <div
                          key={material.id}
                          style={{
                            marginTop: idx === 0 ? 0 : 8,
                            paddingTop: idx === 0 ? 0 : 8,
                            borderTop: idx === 0 ? "none" : "1px solid #e2e8f0",
                            opacity: !isSelectable ? 0.6 : 1,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isSelectable) {
                                  toggleItemSelection(material.id);
                                } else {
                                  setError(`Cannot select ${material.material_name} - ${material.remaining_qty <= 0 ? 'No remaining quantity' : 'Order is ' + material.so_status}`);
                                }
                              }}
                              disabled={!isSelectable}
                              style={{ cursor: isSelectable ? "pointer" : "not-allowed" }}
                            />
                            <div style={{ flex: 1 }}>
                              <strong>{material.material_name}</strong>
                              <span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>
                                SO: {material.so_no}
                              </span>
                              <div style={{ marginTop: 2, fontSize: 12, color: "#475569" }}>
                                Ordered: <strong>{material.ordered_qty}</strong> kg
                                {" · "}
                                Dispatched so far: <strong>{material.dispatched_qty}</strong> kg
                                {" · "}
                                Remaining: <strong>{material.remaining_qty}</strong> kg
                              </div>
                              {material.is_fully_loaded && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    marginTop: 4,
                                    padding: "1px 6px",
                                    borderRadius: 10,
                                    background: "#dcfce7",
                                    color: "#166534",
                                    fontSize: 11,
                                    fontWeight: 600,
                                  }}
                                >
                                  ✅ Completed
                                </span>
                              )}
                              {!material.is_fully_loaded && material.dispatched_qty > 0 && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    marginTop: 4,
                                    padding: "1px 6px",
                                    borderRadius: 10,
                                    background: "#fef3c7",
                                    color: "#92400e",
                                    fontSize: 11,
                                    fontWeight: 600,
                                  }}
                                >
                                  🔶 Partially loaded
                                </span>
                              )}
                              {!isSelectable && material.remaining_qty <= 0 && (
                                <span style={{ marginLeft: 8, color: "#dc2626", fontSize: 12 }}>
                                  ⚠️ No remaining quantity
                                </span>
                              )}
                              {!isSelectable && ['dispatched', 'closed', 'cancelled'].includes(material.so_status) && (
                                <span style={{ marginLeft: 8, color: "#dc2626", fontSize: 12 }}>
                                  ⚠️ Order {material.so_status}
                                </span>
                              )}
                            </div>
                            {isSelectable && isSelected && (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={material.remaining_qty}
                                  value={currentQty}
                                  onChange={(e) => handleQuantityChange(material.id, e.target.value)}
                                  placeholder="Qty"
                                  style={{
                                    width: 100,
                                    padding: "4px 6px",
                                    border: "1px solid #d1d5db",
                                    borderRadius: 4,
                                    fontSize: 13,
                                  }}
                                  required
                                />
                                <span style={{ fontSize: 12, color: "#64748b" }}>kg</span>
                              </div>
                            )}
                          </div>
                          {isSelected && currentQty > 0 && (
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, marginLeft: 28 }}>
                              {currentQty} kg loaded — {material.remaining_qty - currentQty} kg remaining after this truck
                            </div>
                          )}
                        </div>
                      );
                    })}
                    
                    {selectedItems.length > 0 && (
                      <div style={{ marginTop: 8, padding: "6px 8px", background: "#e6f7e6", borderRadius: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                          <strong>Selected: {selectedItems.length} material(s)</strong>
                          <span>Total to load: {totalLoadedQty} kg</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItems([]);
                              setMaterialQuantities({});
                            }}
                            style={{
                              padding: "2px 8px",
                              fontSize: 12,
                              background: "#dc2626",
                              color: "white",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                    )}
                    
                    {!isAnyMaterialAvailable && availableMaterials.length > 0 && (
                      <div style={{ marginTop: 8, color: "#dc2626", fontSize: 12 }}>
                        ⚠️ No materials available for loading. All materials are either fully loaded or the order is closed/dispatched.
                      </div>
                    )}
                    
                    {isAnyMaterialAvailable && selectedItems.length === 0 && (
                      <div style={{ marginTop: 8, color: "#b45309", fontSize: 12 }}>
                        ⚠️ Please select at least one material to load
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
        
        <div className="sf-field">
          <label>Total Loaded Qty (kg)</label>
          <input
            name="loaded_qty"
            type="number"
            step="0.01"
            value={form.loaded_qty}
            onChange={handleChange}
            required
            placeholder="Enter total quantity"
          />
          {selectedItems.length > 0 && (
            <p className="field-hint">
              Total remaining across selected materials: {totalRemainingQty} kg
              {totalLoadedQty > 0 && ` | Entered in materials: ${totalLoadedQty} kg`}
              {Math.abs(totalLoadedQty - Number(form.loaded_qty || 0)) > 0.01 && totalLoadedQty > 0 && (
                <span style={{ color: "#dc2626", display: "block" }}>
                  ⚠️ Mismatch: {totalLoadedQty} kg entered in materials vs {form.loaded_qty || 0} kg total
                </span>
              )}
            </p>
          )}
        </div>
        
        <div className="sf-field">
          <label>Remarks (optional)</label>
          <input name="remarks" value={form.remarks} onChange={handleChange} />
        </div>
        
        <div style={{ display: "flex", gap: 8 }}>
          <button 
            className="sf-submit" 
            type="submit"
            disabled={selectedItems.length === 0}
          >
            {editingId ? "Update Loading" : "Record Loading"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {lastResult && !lastResult.all_fully_loaded && (
        <div
          className="sf-form"
          style={{ background: "#fffbeb", border: "1px solid #f5d76e", marginTop: 0 }}
        >
          <h4 style={{ marginTop: 0 }}>Partial Loading Detected</h4>
          {lastResult.results.map((result, idx) => (
            <div key={idx} style={{ fontSize: 14, marginBottom: 4 }}>
              {result.so_no}: {result.dispatched_qty}/{result.ordered_qty} loaded — 
              <strong> {result.remaining_qty} kg remaining</strong>
              {result.is_fully_loaded && " ✅"}
            </div>
          ))}
          <p className="field-hint">
            Some materials still have remaining quantities. You can:
            <br />1. Generate another gate entry against the same Sales Order to load the rest
            <br />2. Or close the order now if no more will be loaded
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="sf-cancel"
              onClick={handleMarkCompleted}
              disabled={completingSoId}
            >
              {completingSoId ? "Marking Completed…" : "Close Order"}
            </button>
          </div>
        </div>
      )}
      
      {lastResult && lastResult.all_fully_loaded && (
        <div className="dt-success" style={{ marginTop: 0 }}>
          ✅ All materials are fully loaded!
          {lastResult.results.map((result, idx) => (
            <div key={idx}>
              {result.so_no}: {result.dispatched_qty}/{result.ordered_qty} loaded ✓
            </div>
          ))}
        </div>
      )}

      <DataTable
        loading={loading}
        rows={loadings}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "loading_no", label: "Loading No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          {
            key: "vehicle",
            label: "Vehicle No.",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? vehicles.getLabel(ge.vehicle_id) : "—";
            },
          },
          {
            key: "so_id",
            label: "Sales Order",
            render: (row) => salesOrders.getLabel(row.so_id),
          },
          {
            key: "material_quantities",
            label: "Materials Loaded",
            render: (row) => {
              const breakdown = Array.isArray(row.material_quantities)
                ? row.material_quantities
                : [];
              if (breakdown.length === 0) {
                return row.remarks || "—";
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {breakdown.map((m, idx) => {
                    const name =
                      materials.rows.find((mat) => String(mat.id) === String(m.material_id))?.name ||
                      `Material ${m.material_id}`;
                    return (
                      <span key={idx} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        <strong>{name}:</strong> {m.qty} kg
                      </span>
                    );
                  })}
                </div>
              );
            },
          },
          { key: "loaded_qty", label: "Loaded Qty (kg)" },
          {
            key: "loaded_at",
            label: "Loaded At",
            render: (row) => (row.loaded_at ? new Date(row.loaded_at).toLocaleString() : "—"),
          },
        ]}
      />

      <ModuleGuide
        title="Loading"
        steps={[
          "Only sales (outbound) gate entries that are checked in and 'waiting_loading' show up here.",
          "Select the gate entry, then choose which materials this truck is carrying.",
          "Enter the quantity for each selected material — quantities are tracked per material.",
          "The total of all material quantities must equal the total loaded_qty.",
          "If a material isn't fully loaded, you can create another gate entry against the same Sales Order.",
          "The remaining quantity will automatically show up for the next truck.",
          "Once all materials are fully loaded, the Sales Order is automatically marked as 'dispatched'.",
          "You can also manually close the order if you want to stop loading the remaining quantity."
        ]}
      />
    </div>
  );
}