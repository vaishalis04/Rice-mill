import { useState, useEffect } from "react";
import {
  getLoadingsApi,
  createLoadingApi,
  updateLoadingApi,
  deleteLoadingApi,
  updateSalesOrderApi,
  getGateEntryByIdApi,
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
  // The material-wise breakdown of the loading currently being edited, so
  // the "remaining qty" shown for each material can add this loading's own
  // already-applied amount back in (otherwise it looks smaller than it
  // really is available for, since the SO's dispatched_qty already
  // includes it).
  const [editOriginalItems, setEditOriginalItems] = useState([]);

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
        const response = await getGateEntryByIdApi(form.gate_entry_id);
        const gateEntry = response.data.data || response.data;
        
        console.log("=== Gate Entry Data ===");
        console.log("Gate Entry:", gateEntry);
        console.log("Sales Orders:", gateEntry.sales_orders);
        
        // Check if gateEntry has sales_orders
        // In the useEffect that fetches gate entry details
if (gateEntry && gateEntry.sales_orders && gateEntry.sales_orders.length > 0) {
  const materialsWithDetails = gateEntry.sales_orders.map(so => {
    const material = materials.rows.find(m => String(m.id) === String(so.material_id));
    
    // Use the fields from the formatted response
    const orderedQty = Number(so.ordered_qty || so.qty || 0);
    const dispatchedQty = Number(so.dispatched_qty || 0);
    // If we're editing a loading, this material's SO dispatched_qty already
    // includes what THIS loading contributed — add it back so "remaining"
    // reflects what's actually available to enter here, not a value that's
    // already short by our own prior contribution.
    const originalContribution = editingId
      ? Number(
          editOriginalItems.find(
            (it) =>
              String(it.so_id) === String(so.so_id) &&
              String(it.material_id) === String(so.material_id)
          )?.qty || 0
        )
      : 0;
    const remainingQty = orderedQty - dispatchedQty + originalContribution;
    
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
      is_fully_loaded: !editingId && remainingQty <= 0,
      so_status: so.sales_order?.so_status || 'pending'
    };
  });
  setGateEntryMaterials(materialsWithDetails);
} else {
          setGateEntryMaterials([]);
        }
      } catch (err) {
        console.error("Failed to fetch gate entry details:", err);
        setGateEntryMaterials([]);
      } finally {
        setLoadingMaterials(false);
      }
    };

    fetchGateEntryDetails();
  }, [form.gate_entry_id, salesOrders.rows, materials.rows, editingId, editOriginalItems]);

  // While editing, only the materials that were actually part of THIS
  // loading are shown/adjustable — editing doesn't let you add a brand new
  // material to an already-recorded truckload, only correct the quantities
  // already on it.
  const availableMaterials = editingId
    ? gateEntryMaterials.filter((m) =>
        editOriginalItems.some(
          (it) =>
            String(it.so_id) === String(m.so_id) &&
            String(it.material_id) === String(m.material_id)
        )
      )
    // Create mode: a material that's already fully loaded (remaining <= 0)
    // or whose SO is no longer open for loading has nothing left to enter
    // — matching Unloading, it drops off the list entirely instead of
    // sitting there disabled/greyed out.
    : gateEntryMaterials.filter(
        (m) =>
          m.remaining_qty > 0 &&
          !["dispatched", "closed", "cancelled"].includes(m.so_status)
      );
  const isAnyMaterialAvailable = availableMaterials.some(m => {
    const available = editingId || (m.remaining_qty > 0 && !['dispatched', 'closed', 'cancelled'].includes(m.so_status));
    console.log(`Material ${m.material_name}: remaining=${m.remaining_qty}, status=${m.so_status}, available=${available}`);
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

  // The total is derived from the per-material quantities, not typed in
  // separately — this is what makes material-wise editing actually work:
  // once you're editing individual materials there's no longer a way for
  // the total to drift out of sync with them.
  useEffect(() => {
    if (selectedItems.length > 0) {
      setForm((f) => ({ ...f, loaded_qty: totalLoadedQty }));
    }
  }, [totalLoadedQty, selectedItems.length]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLastResult(null);
    
    try {
      if (selectedItems.length === 0) {
        throw new Error("Please select at least one material");
      }

      // Build + validate the per-material quantities — shared by both
      // create and edit, since editing now goes through the exact same
      // material-wise shape instead of a single opaque total.
      const quantities = [];
      let totalQty = 0;

      for (const materialId of selectedItems) {
        const qty = Number(materialQuantities[materialId] || 0);
        const material = availableMaterials.find(m => m.id === materialId);
        if (!material) {
          throw new Error(`Material not found`);
        }

        // In edit mode a material can be brought down to 0 (removed from
        // this loading); in create mode every selected material needs a
        // real quantity.
        if (qty <= 0) {
          if (editingId) continue;
          throw new Error(`Please enter quantity for ${material.material_name}`);
        }

        if (qty > material.remaining_qty) {
          throw new Error(`Quantity for ${material.material_name} exceeds remaining (${material.remaining_qty})`);
        }

        quantities.push({
          so_id: Number(material.so_id),
          material_id: Number(material.material_id),
          qty: qty
        });
        totalQty += qty;
      }

      if (totalQty === 0) {
        throw new Error("Total loaded quantity must be greater than 0");
      }

      if (editingId) {
        const payload = { material_quantities: quantities };
        if (form.remarks !== undefined) payload.remarks = form.remarks;

        await updateLoadingApi(editingId, payload);
        setInfo("Loading record updated.");
        salesOrders.refetch();
      } else {
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
      setEditOriginalItems([]);
      setEditingId(null);
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
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      loaded_qty: row.loaded_qty ?? "",
      remarks: row.remarks || "",
    });

    // row.items is the material-wise breakdown recorded on this loading —
    // [{ so_id, material_id, qty }, ...]. Pre-select each of those materials
    // and pre-fill its current qty so the form opens showing exactly what
    // was loaded, ready to adjust per material.
    const items = Array.isArray(row.items) ? row.items : [];
    const keys = [];
    const qtys = {};
    items.forEach((it) => {
      const key = `${it.so_id}-${it.material_id}`;
      keys.push(key);
      qtys[key] = Number(it.qty) || 0;
    });
    setSelectedItems(keys);
    setMaterialQuantities(qtys);
    setEditOriginalItems(items);
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedItems([]);
    setMaterialQuantities({});
    setEditOriginalItems([]);
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
              <label>{editingId ? "Materials (edit quantity per material)" : "Materials to Load"}</label>
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
                      const isSelectable = editingId || (material.remaining_qty > 0 && 
                        !['dispatched', 'closed', 'cancelled'].includes(material.so_status));
                      const currentQty = materialQuantities[material.id] || '';
                      
                      console.log(`Rendering ${material.material_name}: isSelectable=${isSelectable}, remaining=${material.remaining_qty}, status=${material.so_status}`);
                      
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
                              <span style={{ marginLeft: 8, color: "#64748b", fontSize: 12 }}>
                                Remaining: {material.remaining_qty} kg
                              </span>
                              {material.is_fully_loaded && (
                                <span style={{ marginLeft: 8, color: "#22c55e", fontSize: 12 }}>
                                  ✅ Fully Loaded
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
            readOnly={selectedItems.length > 0}
            placeholder="Enter total quantity"
            style={selectedItems.length > 0 ? { background: "#f1f5f9" } : undefined}
          />
          {selectedItems.length > 0 && (
            <p className="field-hint">
              Sum of the material quantities below — {totalLoadedQty} kg
              {!editingId && ` (${totalRemainingQty} kg remaining across selected materials)`}
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