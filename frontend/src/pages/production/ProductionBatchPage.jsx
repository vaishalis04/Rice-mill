import { useEffect, useState } from "react";
import {
  createProductionBatchApi,
  getProductionBatchesApi,
  getWarehouseSummaryApi,
  completePackingApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyCreateForm = {
  warehouse_id: "",
  materials: [],
};

const emptyPackingForm = {
  destination_warehouse_id: "",
  materials: [],
};

const PACK_SIZE_PRESETS = ["5", "10", "25", "50"];
const CUSTOM_SENTINEL = "__custom__";

export default function ProductionBatchPage() {
  const [batches, setBatches] = useState([]);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [packingForm, setPackingForm] = useState(emptyPackingForm);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warehouseSummary, setWarehouseSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPacking, setShowPacking] = useState(false);
  const [packingLoading, setPackingLoading] = useState(false);

  const warehouses = useEntityLookup("warehouse");
  const materials = useEntityLookup("material");

  // Fetch warehouse summary (materials + qty available) when the source
  // warehouse changes on the "create batch" form.
  useEffect(() => {
    if (!createForm.warehouse_id) {
      setWarehouseSummary(null);
      setCreateForm((prev) => ({ ...prev, materials: [] }));
      setFieldErrors({});
      return;
    }
    let cancelled = false;
    setLoadingSummary(true);
    setError("");
    getWarehouseSummaryApi(createForm.warehouse_id)
      .then((res) => {
        if (!cancelled) {
          setWarehouseSummary(res.data.data);
          setCreateForm((prev) => ({ ...prev, materials: [] }));
          setFieldErrors({});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.response?.data?.msg ||
              err.response?.data?.message ||
              "Failed to load warehouse details"
          );
          setWarehouseSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createForm.warehouse_id]);

  const load = () => {
    setLoading(true);
    getProductionBatchesApi()
      .then((res) => setBatches(res.data.data ?? res.data))
      .catch(() => setError("Failed to load production batches"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // ---------------- Create-batch material rows ----------------

  const handleAddMaterial = () => {
    if (warehouseSummary?.materials) {
      const availableMaterialIds = warehouseSummary.materials.map((m) => m.material_id);
      const addedMaterialIds = createForm.materials
        .map((m) => Number(m.material_id))
        .filter(Boolean);
      const remaining = availableMaterialIds.filter((id) => !addedMaterialIds.includes(id));
      if (remaining.length === 0) {
        setError("All available materials have been added");
        return;
      }
    }
    setCreateForm((prev) => ({
      ...prev,
      materials: [...prev.materials, { material_id: "", qty: "" }],
    }));
    setFieldErrors({});
  };

  const handleRemoveMaterial = (index) => {
    setCreateForm((prev) => ({
      ...prev,
      materials: prev.materials.filter((_, i) => i !== index),
    }));
    const newErrors = { ...fieldErrors };
    delete newErrors[index];
    setFieldErrors(newErrors);
  };

  const handleMaterialChange = (index, field, value) => {
    setCreateForm((prev) => {
      const updated = [...prev.materials];
      updated[index][field] = value;
      return { ...prev, materials: updated };
    });
    if (fieldErrors[index]) {
      const newErrors = { ...fieldErrors };
      delete newErrors[index];
      setFieldErrors(newErrors);
    }
  };

  const getMaterialAvailableQty = (materialId) => {
    if (!warehouseSummary?.materials) return 0;
    const material = warehouseSummary.materials.find((m) => m.material_id === Number(materialId));
    return material ? material.qty : 0;
  };

  const getAvailableMaterials = () => {
    if (!warehouseSummary?.materials) return [];
    const addedIds = createForm.materials.map((m) => Number(m.material_id)).filter(Boolean);
    return warehouseSummary.materials.filter((m) => !addedIds.includes(m.material_id));
  };

  const validateQuantity = (index, materialId, qty) => {
    if (!materialId || !qty) return null;
    const availableInTons = getMaterialAvailableQty(materialId);
    const requested = Number(qty);
    const tolerance = 0.001;
    if (requested > availableInTons + tolerance) {
      const materialName = materials.getLabel(materialId) || `Material ${materialId}`;
      return {
        index,
        message: `${materialName}: Requested ${requested.toFixed(3)} tons but only ${availableInTons.toFixed(
          3
        )} tons available`,
      };
    }
    return null;
  };

  // ---------------- Create batch ----------------

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    setInfo("");
    setFieldErrors({});

    const validMaterials = createForm.materials.filter(
      (m) => m.material_id && m.qty && Number(m.qty) > 0
    );

    if (validMaterials.length === 0) {
      setError("Please add at least one material with a valid quantity");
      return;
    }

    const errors = {};
    let hasError = false;
    validMaterials.forEach((item, i) => {
      const err = validateQuantity(i, item.material_id, item.qty);
      if (err) {
        errors[i] = err.message;
        hasError = true;
      }
    });
    if (hasError) {
      setFieldErrors(errors);
      setError("Please fix the errors below before submitting");
      return;
    }

    try {
      const payload = {
        warehouse_id: Number(createForm.warehouse_id),
        production_date: new Date().toISOString().slice(0, 10),
      };

      if (validMaterials.length === 1) {
        payload.material_id = Number(validMaterials[0].material_id);
        payload.input_qty = Number(validMaterials[0].qty);
      } else {
        payload.materials = validMaterials.map((item) => ({
          material_id: Number(item.material_id),
          input_qty: Number(item.qty),
        }));
      }

      const response = await createProductionBatchApi(payload);
      const created = response.data.data;

      const materialCount = validMaterials.length;
      const totalQty = validMaterials.reduce((sum, m) => sum + Number(m.qty), 0);

      setInfo(
        `✅ Batch ${created.batch_no} created (${materialCount} material${
          materialCount > 1 ? "s" : ""
        }, ${totalQty.toFixed(2)} tons total). Now complete packing.`
      );

      setSelectedBatch(created);
      setShowPacking(true);

      // Packing rows are fixed to the materials reserved by this batch.
      const packingMaterials = validMaterials.map((m) => ({
        material_id: String(m.material_id),
        material_name: materials.getLabel(m.material_id) || "",
        reserved_qty: Number(m.qty), // tons reserved for this material
        pack_size: "25",
        custom_pack_size: "",
        bag_count: "",
        qty_override: "",
      }));

      setPackingForm({
        destination_warehouse_id: "",
        materials: packingMaterials,
      });

      setCreateForm(emptyCreateForm);
    } catch (err) {
      setError(
        err.response?.data?.msg || err.response?.data?.message || "Could not create production batch"
      );
    }
  };

  // ---------------- Packing form ----------------

  const getResolvedPackSize = (item) =>
    item.pack_size === CUSTOM_SENTINEL ? item.custom_pack_size : item.pack_size;

  const handlePackingFieldChange = (index, field, value) => {
    setPackingForm((prev) => {
      const updated = [...prev.materials];
      updated[index][field] = value;
      return { ...prev, materials: updated };
    });
  };

  const handleCompletePacking = async (event) => {
    event.preventDefault();
    setError("");
    setInfo("");
    setPackingLoading(true);

    try {
      if (!packingForm.destination_warehouse_id) {
        setError("Please select a destination warehouse for the packed goods");
        setPackingLoading(false);
        return;
      }

      const validPackingMaterials = packingForm.materials.filter(
        (m) => m.material_id && m.bag_count && Number(m.bag_count) > 0
      );

      if (validPackingMaterials.length === 0) {
        setError("Please enter bag count and pack size for at least one material");
        setPackingLoading(false);
        return;
      }

      const payload = {
        batch_id: selectedBatch.id,
        destination_warehouse_id: Number(packingForm.destination_warehouse_id),
        materials: validPackingMaterials.map((m) => {
          const packSize =
            m.pack_size === CUSTOM_SENTINEL ? Number(m.custom_pack_size) : Number(m.pack_size);
          return {
            material_id: Number(m.material_id),
            pack_size: packSize,
            bag_count: Number(m.bag_count),
            qty_override: m.qty_override ? Number(m.qty_override) : undefined,
          };
        }),
      };

      const res = await completePackingApi(payload);
      const totalKg = res.data.data?.total_qty_kg || 0;
    const totalTons = totalKg / 1000; // ✅ Correct conversion

      setInfo(
        `✅ Batch completed and packed! ${validPackingMaterials.length} material(s) packed. ` +
          `Total: ${totalKg} kg (${totalTons.toFixed(3)}tons) added to warehouse.`
      );

      setSelectedBatch(null);
      setShowPacking(false);
      setPackingForm(emptyPackingForm);
      load();
    } catch (err) {
      setError(
        err.response?.data?.msg || err.response?.data?.message || "Could not complete packing"
      );
    } finally {
      setPackingLoading(false);
    }
  };

  const handleCancelPacking = () => {
    setShowPacking(false);
    setSelectedBatch(null);
    setPackingForm(emptyPackingForm);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Production Batches</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      {!showPacking ? (
        <>
          <h3>Create Batch</h3>
          <p className="field-hint">
            Select a warehouse to view available stock, then select materials and quantities for
            production. After creating the batch, you'll be prompted to enter packing details.
          </p>
          <form className="sf-form" onSubmit={handleCreate}>
            <EntitySelect
              entity="warehouse"
              label="Source Warehouse"
              value={createForm.warehouse_id}
              onChange={(id) => setCreateForm({ ...createForm, warehouse_id: id, materials: [] })}
              required
            />

            {/* Warehouse Summary Display */}
            {createForm.warehouse_id && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "12px 16px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                {loadingSummary && <div style={{ color: "#64748b" }}>Loading warehouse details…</div>}
                {!loadingSummary && warehouseSummary && (
                  <>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                      <span>
                        <strong>Warehouse:</strong> {warehouseSummary.name}
                      </span>
                      <span>
                        <strong>Total Stock:</strong> {(warehouseSummary.total_stock).toFixed(2)}{" "}
                        tons
                      </span>
                      {warehouseSummary.remaining_capacity != null && (
                        <span>
                          <strong>Remaining Capacity:</strong>{" "}
                          {(warehouseSummary.remaining_capacity ).toFixed(2)} tons
                        </span>
                      )}
                    </div>
                    {warehouseSummary.materials && warehouseSummary.materials.length > 0 ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: 4,
                          fontSize: 13,
                        }}
                      >
                        {warehouseSummary.materials.map((m) => (
                          <div
                            key={m.material_id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "2px 8px",
                              background: "#f1f5f9",
                              borderRadius: 4,
                            }}
                          >
                            <span>{m.material_name}</span>
                            <strong>{(m.qty ).toFixed(2)} tons</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "#64748b" }}>No stock in this warehouse</span>
                    )}
                  </>
                )}
                {!loadingSummary && !warehouseSummary && (
                  <span style={{ color: "#dc2626" }}>Could not load warehouse details</span>
                )}
              </div>
            )}

            {/* Materials Section */}
            <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <label style={{ fontWeight: 600, fontSize: 14 }}>Materials for Production</label>
                <button
                  type="button"
                  className="dt-btn"
                  onClick={handleAddMaterial}
                  disabled={!createForm.warehouse_id || getAvailableMaterials().length === 0}
                >
                  + Add Material
                </button>
              </div>

              {createForm.materials.length === 0 && (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#94a3b8",
                    border: "1px dashed #e2e8f0",
                    borderRadius: 6,
                  }}
                >
                  {warehouseSummary?.materials?.length > 0
                    ? "Click 'Add Material' to select materials from this warehouse"
                    : "Select a warehouse with available stock"}
                </div>
              )}

              {createForm.materials.map((item, index) => {
                const availableQty = getMaterialAvailableQty(item.material_id);
                const availableInTons = availableQty;
                const isQuantityExceeded =
                  item.material_id && item.qty && Number(item.qty) > availableInTons;

                const availableMaterials = getAvailableMaterials();
                const allAvailableMaterials = [...availableMaterials];
                if (item.material_id) {
                  const current = warehouseSummary?.materials?.find(
                    (m) => m.material_id === Number(item.material_id)
                  );
                  if (current && !allAvailableMaterials.find((m) => m.material_id === current.material_id)) {
                    allAvailableMaterials.push(current);
                  }
                }

                return (
                  <div
                    key={index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr auto",
                      gap: 12,
                      padding: "12px",
                      background: isQuantityExceeded ? "#fef2f2" : "#f8fafc",
                      borderRadius: 6,
                      marginBottom: 8,
                      alignItems: "end",
                      border: isQuantityExceeded ? "1px solid #fca5a5" : "1px solid #e2e8f0",
                    }}
                  >
                    <div className="sf-field" style={{ marginBottom: 0 }}>
                      <label>Material</label>
                      <select
                        value={item.material_id}
                        onChange={(e) => handleMaterialChange(index, "material_id", e.target.value)}
                        required
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 4,
                          border: isQuantityExceeded ? "1px solid #fca5a5" : "1px solid #d1d5db",
                          fontSize: 14,
                          backgroundColor: isQuantityExceeded ? "#fef2f2" : "white",
                        }}
                      >
                        <option value="">Select Material</option>
                        {allAvailableMaterials.map((m) => (
                          <option key={m.material_id} value={m.material_id}>
                            {m.material_name} ({(m.qty ).toFixed(2)} tons)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sf-field" style={{ marginBottom: 0 }}>
                      <label>
                        Qty (Tons)
                        {item.material_id && (
                          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400 }}>
                            {" "}
                            (Available: {availableInTons.toFixed(2)} tons)
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={availableInTons || undefined}
                        value={item.qty}
                        onChange={(e) => handleMaterialChange(index, "qty", e.target.value)}
                        onBlur={(e) => {
                          const err = validateQuantity(index, item.material_id, e.target.value);
                          if (err) {
                            setFieldErrors((prev) => ({ ...prev, [index]: err.message }));
                          } else {
                            const newErrors = { ...fieldErrors };
                            delete newErrors[index];
                            setFieldErrors(newErrors);
                          }
                        }}
                        required
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 4,
                          border: isQuantityExceeded ? "1px solid #fca5a5" : "1px solid #d1d5db",
                          fontSize: 14,
                          backgroundColor: isQuantityExceeded ? "#fef2f2" : "white",
                        }}
                      />
                      {isQuantityExceeded && (
                        <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                          ⚠️ {fieldErrors[index] || `Available: ${availableInTons.toFixed(2)} tons`}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="sf-cancel"
                      onClick={() => handleRemoveMaterial(index)}
                      style={{ marginBottom: 1 }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              className="sf-submit"
              type="submit"
              disabled={!createForm.warehouse_id || createForm.materials.length === 0}
              style={{ gridColumn: "1 / -1" }}
            >
              Create Batch
            </button>
          </form>
        </>
      ) : (
        // Packing Form
        <div
          style={{
            background: "#f0f9ff",
            padding: "20px",
            borderRadius: "8px",
            marginTop: "20px",
            border: "2px solid #3b82f6",
          }}
        >
          <h3 style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Packing for Batch: {selectedBatch?.batch_no}</span>
            <button type="button" className="sf-cancel" onClick={handleCancelPacking}>
              Cancel
            </button>
          </h3>

          <p className="field-hint">
            Choose the destination warehouse for the packed goods, then set pack size and bag count
            for each reserved material. Submitting will deduct the reserved qty from the source
            warehouse and add the packed qty to the destination warehouse.
          </p>

          <form className="sf-form" onSubmit={handleCompletePacking}>
            <EntitySelect
              entity="warehouse"
              label="Destination Warehouse"
              value={packingForm.destination_warehouse_id}
              onChange={(id) => setPackingForm({ ...packingForm, destination_warehouse_id: id })}
              required
              creatable
            />

            <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #e2e8f0", paddingTop: 16, marginTop: 8 }}>
              <label style={{ fontWeight: 600, fontSize: 14, display: "block", marginBottom: 12 }}>
                Packing Details
              </label>

              {packingForm.materials.map((item, index) => {
  const resolvedPackSize = getResolvedPackSize(item);
  const totalKg = resolvedPackSize && item.bag_count ? Number(resolvedPackSize) * Number(item.bag_count) : 0;
  const totalTons = totalKg / 1000; // ✅ Fixed: convert kg to tons

  return (
    <div
      key={index}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12,
        padding: "12px",
        background: "#f8fafc",
        borderRadius: 6,
        marginBottom: 8,
        alignItems: "end",
        border: "1px solid #e2e8f0",
      }}
    >
      <div className="sf-field" style={{ marginBottom: 0 }}>
        <label>Material</label>
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            fontSize: 14,
            background: "white",
          }}
        >
          {item.material_name || `Material ${item.material_id}`}
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Reserved: {item.reserved_qty.toFixed(3)} tons
          </div>
        </div>
      </div>

      <div className="sf-field" style={{ marginBottom: 0 }}>
        <label>Pack Size (kg)</label>
        <select
          value={item.pack_size}
          onChange={(e) => handlePackingFieldChange(index, "pack_size", e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            fontSize: 14,
            backgroundColor: "white",
          }}
        >
          {PACK_SIZE_PRESETS.map((s) => (
            <option key={s} value={s}>{`${s} kg`}</option>
          ))}
          <option value={CUSTOM_SENTINEL}>Custom…</option>
        </select>
        {item.pack_size === CUSTOM_SENTINEL && (
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Custom kg"
            value={item.custom_pack_size}
            onChange={(e) => handlePackingFieldChange(index, "custom_pack_size", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              fontSize: 14,
              marginTop: 4,
            }}
          />
        )}
      </div>

      <div className="sf-field" style={{ marginBottom: 0 }}>
        <label>Bag Count</label>
        <input
          type="number"
          min="1"
          value={item.bag_count}
          onChange={(e) => handlePackingFieldChange(index, "bag_count", e.target.value)}
          required
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            fontSize: 14,
          }}
        />
        {resolvedPackSize && item.bag_count && (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Total: {totalKg} kg ({totalTons.toFixed(3)} tons)
          </div>
        )}
      </div>
    </div>
  );
})}
            </div>

            <button className="sf-submit" type="submit" disabled={packingLoading} style={{ gridColumn: "1 / -1" }}>
              {packingLoading ? "Processing..." : "Finalize & Pack"}
            </button>
          </form>
        </div>
      )}

      <h3>Production History</h3>
      <DataTable
        loading={loading}
        rows={batches}
        columns={[
          { key: "batch_no", label: "Batch No." },
          {
            key: "material",
            label: "Material(s)",
            render: (row) => {
              if (row.is_multi_material && row.materials_data) {
                return row.materials_data
                  .map((m) => materials.getLabel(m.material_id))
                  .filter(Boolean)
                  .join(", ");
              }
              const materialId = row.lot?.material_id ?? row.material_id;
              return materialId ? materials.getLabel(materialId) : "—";
            },
          },
          {
            key: "warehouse",
            label: "Source Warehouse",
            render: (row) => (row.warehouse_id ? warehouses.getLabel(row.warehouse_id) : "—"),
          },
          { key: "input_qty", label: "Input (Tons)" },
          { key: "batch_status", label: "Status" },
        ]}
      />
      <ModuleGuide
        title="Production"
        steps={[
          "Step 1: Select a warehouse to view its total stock and materials available.",
          "Step 2: Add one or more materials from the warehouse with quantities in tons.",
          "Step 3: Click 'Create Batch' — this reserves the stock and opens the packing form.",
          "Step 4: Select the destination warehouse for the packed goods.",
          "Step 5: For each material, choose the pack size and bag count.",
          "Step 6: Click 'Finalize & Pack' — this removes the reserved qty from the source warehouse and adds the packed qty (converted to tons) to the destination warehouse.",
        ]}
      />
    </div>
  );
}