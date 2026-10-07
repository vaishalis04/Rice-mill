import { useEffect, useState } from "react";
import {
  createProductionBatchApi,
  getProductionBatchesApi,
  getProductionBatchByIdApi,
  getWarehouseSummaryApi,
  addProductionBatchMaterialApi,
  removeProductionBatchMaterialApi,
  deleteProductionBatchApi,
  getProductionReportPdfApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import InlineSearchSelect from "../../components/InlineSearchSelect";
import ModuleGuide from "../../components/ModuleGuide";
import PdfPreviewModal from "../../components/PdfPreviewModal";
import ProductionOutputPanel from "../../components/ProductionOutputPanel";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyCreateForm = {
  warehouse_id: "",
  materials: [],
};

// pack_size starts empty: the sizes offered come from the chosen material's
// actual bags in the warehouse (see getAddMaterialPackSizeOptions).
const emptyAddMaterialForm = {
  material_id: "",
  pack_size: "",
  custom_pack_size: "",
  bag_count: "",
};

const PACK_SIZE_PRESETS = ["5", "10", "25", "50"];
const CUSTOM_SENTINEL = "__custom__";

export default function ProductionBatchPage() {
  const [batches, setBatches] = useState([]);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warehouseSummary, setWarehouseSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPacking, setShowPacking] = useState(false);

  // ---- Add Material to an already-created (still "pending") batch, from
  // the Production History table ----
  const [addMaterialBatch, setAddMaterialBatch] = useState(null);
  const [addMaterialForm, setAddMaterialForm] = useState(emptyAddMaterialForm);
  const [addMaterialWarehouseSummary, setAddMaterialWarehouseSummary] = useState(null);
  const [addMaterialLoadingSummary, setAddMaterialLoadingSummary] = useState(false);
  const [addMaterialLoading, setAddMaterialLoading] = useState(false);
  const [addMaterialError, setAddMaterialError] = useState("");

  // Removing an input line from the pending batch shown on the output screen
  const [removingInputKey, setRemovingInputKey] = useState(null);

  // Production Report PDF — available right after a batch is finalized
  const [lastCompletedBatch, setLastCompletedBatch] = useState(null);
  const [productionReportLoading, setProductionReportLoading] = useState(false);
  const [productionReportError, setProductionReportError] = useState("");
  const [pdfPreview, setPdfPreview] = useState(null); // { url, fileName, title }

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
      if (warehouseSummary.materials.length === 0) {
        setError("No materials are available in this warehouse");
        return;
      }
    }
    setCreateForm((prev) => ({
      ...prev,
      materials: [...prev.materials, { material_id: "", pack_size: "25", custom_pack_size: "", bag_count: "" }],
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
      // Switching material invalidates whatever bag size/count was set for
      // the PREVIOUS material — a <select> silently shows its first option
      // when the stored value doesn't match any of them, which desyncs the
      // visible "50 kg" from the actual state (still e.g. "25") used for
      // the availability check and the submitted payload. Reset both
      // explicitly so what's displayed is always what's actually stored.
      if (field === "material_id") {
        const validSizes = getCreatePackSizeOptions(value);
        updated[index].pack_size = validSizes.length ? validSizes[0] : PACK_SIZE_PRESETS[0];
        updated[index].custom_pack_size = "";
        updated[index].bag_count = "";
      }
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
    return material ? Number(material.available_qty ?? material.qty) : 0;
  };

  const getAvailableMaterials = () => {
    if (!warehouseSummary?.materials) return [];
    return warehouseSummary.materials.filter((material) => Number(material.available_qty ?? material.qty) > 0);
  };

  const getResolvedCreatePackSize = (item) =>
    item.pack_size === CUSTOM_SENTINEL ? item.custom_pack_size : item.pack_size;

  const getCreateBagAvailability = (materialId, packSize) => {
    const material = warehouseSummary?.materials?.find((m) => m.material_id === Number(materialId));
    if (!material) return 0;
    const bag = (material.bags || []).find((entry) => Number(entry.bag_size) === Number(packSize));
    if (!bag) return 0;
    const availableQty = Number(material.available_qty ?? material.qty);
    const availableBagsByWeight = Math.floor((availableQty * 1000) / Number(packSize) + 0.0001);
    return Math.min(Number(bag.bag_count) || 0, availableBagsByWeight);
  };

  const getCreatePackSizeOptions = (materialId) => {
    const material = warehouseSummary?.materials?.find((m) => m.material_id === Number(materialId));
    const sizes = (material?.bags || [])
      .filter((bag) => Number(bag.bag_size) > 0 && Number(bag.bag_count) > 0)
      .map((bag) => String(bag.bag_size));
    return [...new Set(sizes)];
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
    setLastCompletedBatch(null);

    const validMaterials = createForm.materials.filter(
      (m) => m.material_id && m.bag_count && Number(m.bag_count) > 0
    );

    if (validMaterials.length === 0) {
      setError("Please add at least one material with a valid quantity");
      return;
    }

    const errors = {};
    let hasError = false;
    validMaterials.forEach((item, i) => {
      const packSize = Number(getResolvedCreatePackSize(item));
      const bagCount = Number(item.bag_count);
      const availableBags = getCreateBagAvailability(item.material_id, packSize);
      if (!(packSize > 0)) {
        errors[i] = "Select a valid bag size";
        hasError = true;
      } else if (availableBags <= 0) {
        errors[i] = `No bags of ${packSize}kg are available for this material`;
        hasError = true;
      } else if (bagCount > availableBags + 0.001) {
        errors[i] = `Only ${availableBags} bags of ${packSize}kg are available for this material`;
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

      payload.materials = validMaterials.map((item) => ({
          material_id: Number(item.material_id),
          pack_size: Number(getResolvedCreatePackSize(item)),
          bag_count: Number(item.bag_count),
      }));

      const response = await createProductionBatchApi(payload);
      const created = response.data.data;

      const materialCount = validMaterials.length;
      const totalQty = validMaterials.reduce(
        (sum, m) => sum + (Number(getResolvedCreatePackSize(m)) * Number(m.bag_count)) / 1000,
        0,
      );

      setInfo(
        `✅ Batch ${created.batch_no} created (${materialCount} material${
          materialCount > 1 ? "s" : ""
        }, ${totalQty.toFixed(2)} tons total). Now add its output.`
      );

      // Opens the output screen for the new (still pending) batch.
      setSelectedBatch(created);
      setShowPacking(true);

      setCreateForm(emptyCreateForm);
    } catch (err) {
      setError(
        err.response?.data?.msg || err.response?.data?.message || "Could not create production batch"
      );
    }
  };

  // ---------------- Add material to an existing (pending) batch, from the
  // Production History table ----------------

  const handleOpenAddMaterial = (row) => {
    if (row.batch_status !== "pending") {
      setError(`Cannot add materials — batch ${row.batch_no} is already '${row.batch_status}'.`);
      return;
    }
    setError("");
    setInfo("");
    setAddMaterialError("");
    setAddMaterialForm(emptyAddMaterialForm);
    setAddMaterialBatch(row);
    setAddMaterialWarehouseSummary(null);
    window.setTimeout(() => document.getElementById("add-material-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);

    if (!row.warehouse_id) return;
    setAddMaterialLoadingSummary(true);
    getWarehouseSummaryApi(row.warehouse_id)
      .then((res) => setAddMaterialWarehouseSummary(res.data.data))
      .catch(() =>
        setAddMaterialError("Failed to load warehouse details for this batch's warehouse")
      )
      .finally(() => setAddMaterialLoadingSummary(false));
  };

  const handleCancelAddMaterial = () => {
    setAddMaterialBatch(null);
    setAddMaterialForm(emptyAddMaterialForm);
    setAddMaterialWarehouseSummary(null);
    setAddMaterialError("");
  };

  // Materials already reserved on the batch being edited (works for both
  // the new multi-material shape and legacy single-material batches).
  const getBatchExistingMaterialIds = (row) => {
    if (!row) return [];
    if (Array.isArray(row.materials_data) && row.materials_data.length > 0) {
      return row.materials_data.map((m) => Number(m.material_id));
    }
    const legacyId = row.lot?.material_id ?? row.material_id;
    return legacyId ? [Number(legacyId)] : [];
  };

  const getAddMaterialAvailableOptions = () => {
    if (!addMaterialWarehouseSummary?.materials) return [];
    return addMaterialWarehouseSummary.materials;
  };

  // Bag sizes this material really has in the batch's warehouse (the old list
  // was a fixed 5/10/25/50, so e.g. a 100 kg stock could never be picked and
  // the form defaulted to 25 kg -> "No bags of 25kg are available").
  const getAddMaterialPackSizeOptions = (materialId) => {
    const material = addMaterialWarehouseSummary?.materials?.find((m) => m.material_id === Number(materialId));
    const sizes = (material?.bags || [])
      .filter((b) => Number(b.bag_size) > 0 && Number(b.bag_count) > 0)
      .map((b) => String(b.bag_size));
    return [...new Set(sizes)];
  };

  const getAddMaterialBagsAvailable = (materialId, packSize) => {
    const material = addMaterialWarehouseSummary?.materials?.find((m) => m.material_id === Number(materialId));
    return (material?.bags || []).find((b) => Number(b.bag_size) === Number(packSize))?.bag_count || 0;
  };

  const getAddMaterialAvailableQty = (materialId) => {
    if (!addMaterialWarehouseSummary?.materials) return 0;
    const material = addMaterialWarehouseSummary.materials.find(
      (m) => m.material_id === Number(materialId)
    );
    return material ? material.qty : 0;
  };

  const handleAddMaterialSubmit = async (event) => {
    event.preventDefault();
    setAddMaterialError("");

    const { material_id, bag_count } = addMaterialForm;
    const packSize = Number(addMaterialForm.pack_size === CUSTOM_SENTINEL ? addMaterialForm.custom_pack_size : addMaterialForm.pack_size);
    const bagCount = Number(bag_count);
    if (!material_id || !(packSize > 0) || !(bagCount > 0)) {
      setAddMaterialError("Please select a material, bag size, and bag count");
      return;
    }

    const materialSummary = addMaterialWarehouseSummary?.materials?.find((m) => m.material_id === Number(material_id));
    const availableBags = (materialSummary?.bags || []).find((b) => Number(b.bag_size) === packSize)?.bag_count || 0;
    if (availableBags <= 0 || bagCount > availableBags) {
      setAddMaterialError(
        availableBags > 0
          ? `Only ${availableBags} bags of ${packSize}kg are available`
          : `No bags of ${packSize}kg are available for this material`
      );
      return;
    }
    const requested = (packSize * bagCount) / 1000;

    setAddMaterialLoading(true);
    try {
      const res = await addProductionBatchMaterialApi(addMaterialBatch.id, {
        material_id: Number(material_id),
        input_qty: requested,
        pack_size: packSize,
        bag_count: bagCount,
      });
      setInfo(res.data.msg || `Material added to batch ${addMaterialBatch.batch_no}`);
      const addedToId = addMaterialBatch.id;
      handleCancelAddMaterial();
      load();
      refreshSelectedBatch(addedToId); // keeps the output screen in step if it's open for this batch
    } catch (err) {
      setAddMaterialError(
        err.response?.data?.msg || err.response?.data?.message || "Could not add material to this batch"
      );
    } finally {
      setAddMaterialLoading(false);
    }
  };

  // ---------------- Output screen (finalize a pending batch) ----------------

  // Re-reads a batch (after an input line was added / removed) and refreshes
  // the output screen if it is open for that batch.
  const refreshSelectedBatch = async (batchId) => {
    try {
      const res = await getProductionBatchByIdApi(batchId);
      const fresh = res.data.data ?? res.data;
      setSelectedBatch((prev) => (prev && String(prev.id) === String(batchId) ? fresh : prev));
    } catch {
      /* the list reload still shows the truth */
    }
  };

  // Continue / finalize a batch that was left pending.
  const handleContinueBatch = async (row) => {
    setError("");
    setInfo("");
    setLastCompletedBatch(null);
    try {
      const res = await getProductionBatchByIdApi(row.id);
      const fresh = res.data.data ?? res.data;
      if (fresh.batch_status !== "pending") {
        setError(`Batch ${fresh.batch_no} is already '${fresh.batch_status}'.`);
        load();
        return;
      }
      handleCancelAddMaterial();
      setSelectedBatch(fresh);
      setShowPacking(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not open this batch");
    }
  };

  // Delete a pending batch. Nothing is deducted until a batch is finalized, so
  // this simply releases what it had reserved.
  const handleDeletePendingBatch = async (row) => {
    if (row.batch_status !== "pending") return;
    if (
      !window.confirm(
        `Delete pending batch ${row.batch_no}?\n\nNothing has been deducted from the warehouse yet, so its reserved stock is simply released.`
      )
    ) {
      return;
    }
    setError("");
    setInfo("");
    try {
      await deleteProductionBatchApi(row.id);
      if (selectedBatch && String(selectedBatch.id) === String(row.id)) {
        setShowPacking(false);
        setSelectedBatch(null);
      }
      if (addMaterialBatch && String(addMaterialBatch.id) === String(row.id)) handleCancelAddMaterial();
      setInfo(`Pending batch ${row.batch_no} deleted — its reserved stock is released.`);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not delete this batch");
    }
  };

  // Remove one input line from the pending batch (a batch keeps at least one).
  const handleRemoveInputLine = async (line) => {
    if (!selectedBatch) return;
    if (!window.confirm(`Remove ${materials.getLabel(line.material_id)} from this batch's input?`)) return;
    setError("");
    setRemovingInputKey(line.key);
    try {
      await removeProductionBatchMaterialApi(selectedBatch.id, line.material_id);
      await refreshSelectedBatch(selectedBatch.id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not remove this input material");
    } finally {
      setRemovingInputKey(null);
    }
  };

  const handleFinalized = (payload) => {
    const d = payload?.data || {};
    setInfo(`✅ ${payload?.msg || "Batch completed."}`);
    setLastCompletedBatch({ id: d.batch_id ?? selectedBatch?.id, batch_no: d.batch_no ?? selectedBatch?.batch_no });
    setSelectedBatch(null);
    setShowPacking(false);
    load();
  };

  const handleCancelPacking = () => {
    if (selectedBatch) {
      setInfo(`Batch ${selectedBatch.batch_no} is still pending — continue it any time from Production History.`);
    }
    setShowPacking(false);
    setSelectedBatch(null);
    load();
  };

  // ---------------- Production Report PDF ----------------

  // Axios responseType:"blob" means an error body (e.g. a 403/500 JSON
  // error) still comes back as a Blob instead of parsed JSON — read it as
  // text and try to parse it so the real backend message shows up instead
  // of a generic "something went wrong".
  const extractBlobErrorMessage = async (err, fallback) => {
    const data = err?.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text);
        return parsed.msg || parsed.message || fallback;
      } catch {
        return fallback;
      }
    }
    return err?.response?.data?.msg || err?.response?.data?.message || fallback;
  };

  const handleViewProductionReport = async () => {
    if (!lastCompletedBatch) return;
    setProductionReportError("");
    setProductionReportLoading(true);
    try {
      const res = await getProductionReportPdfApi(lastCompletedBatch.id);
      const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPdfPreview({
        url: blobUrl,
        fileName: `production-report-${lastCompletedBatch.batch_no}.pdf`,
        title: `Production Report — ${lastCompletedBatch.batch_no}`,
      });
    } catch (err) {
      setProductionReportError(await extractBlobErrorMessage(err, "Could not generate the production report PDF"));
    } finally {
      setProductionReportLoading(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Production Batches</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}
      {lastCompletedBatch && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" className="dt-btn" disabled={productionReportLoading} onClick={handleViewProductionReport}>
            {productionReportLoading ? "Generating…" : `View Production Report — ${lastCompletedBatch.batch_no} (PDF)`}
          </button>
          {productionReportError && <span style={{ color: "#dc2626", fontSize: 13 }}>{productionReportError}</span>}
        </div>
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          blobUrl={pdfPreview.url}
          fileName={pdfPreview.fileName}
          onClose={() => {
            window.URL.revokeObjectURL(pdfPreview.url);
            setPdfPreview(null);
          }}
        />
      )}

      {!showPacking ? (
        <>
          <h3>Create Batch</h3>
          <p className="field-hint">
            Select a warehouse to view available stock, then select materials and quantities for
            production. After creating the batch, you'll add its output (output materials, bag size, accepted / rejected bags) and the destination warehouse.
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
                        {warehouseSummary.materials.some((m) => Number(m.reserved_qty) > 0) && (
                          <span>
                            <strong>Reserved:</strong>{" "}
                            {warehouseSummary.materials.reduce((sum, m) => sum + Number(m.reserved_qty || 0), 0).toFixed(2)} tons
                          </span>
                        )}
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
                          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                          gap: 8,
                          fontSize: 13,
                        }}
                      >
                        {warehouseSummary.materials.map((m) => (
                          <div
                            key={m.material_id}
                            style={{
                              padding: "8px 12px",
                              background: "#f1f5f9",
                              borderRadius: 4,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontWeight: 500 }}>{m.material_name}</span>
                              <strong>{Number(m.qty).toFixed(2)} tons</strong>
                            </div>
                            {Number(m.reserved_qty) > 0 && (
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                                Available for production: {Number(m.available_qty).toFixed(2)} tons
                                <span> · Reserved: {Number(m.reserved_qty).toFixed(2)} tons</span>
                              </div>
                            )}
                            {m.bags && m.bags.length > 0 && (
                              <div style={{ marginTop: 4, borderTop: "1px solid #e2e8f0", paddingTop: 4 }}>
                                {m.bags.map((b, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      fontSize: 12,
                                      color: "#475569",
                                    }}
                                  >
                                    <span>
                                      {b.bag_size != null ? `${b.bag_size} kg` : "Bulk"}
                                      {b.bag_count != null && ` × ${b.bag_count} bags`}
                                    </span>
                                    <span>{b.qty.toFixed(3)} tons</span>
                                  </div>
                                ))}
                              </div>
                            )}
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
                const packSize = Number(getResolvedCreatePackSize(item));
                const availableBags = getCreateBagAvailability(item.material_id, packSize);
                const requestedBags = Number(item.bag_count || 0);
                const lineTons = packSize > 0 ? (packSize * requestedBags) / 1000 : 0;
                const isQuantityExceeded = item.material_id && requestedBags > availableBags && availableBags > 0;

                const allAvailableMaterials = getAvailableMaterials();

                return (
                  <div
                    key={index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr auto",
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
                      <InlineSearchSelect
                        value={item.material_id}
                        onChange={(id) => handleMaterialChange(index, "material_id", id)}
                        required
                        placeholder="Search material…"
                        options={allAvailableMaterials.map((m) => ({
                          id: m.material_id,
                          label: m.material_name,
                          sublabel: `${(m.qty).toFixed(2)} tons`,
                        }))}
                        emptyMessage="No materials with stock in this warehouse"
                      />
                    </div>

                    <div className="sf-field" style={{ marginBottom: 0 }}>
                      <label>Bag Size (kg)</label>
                      <select
                        value={item.pack_size}
                        onChange={(e) => handleMaterialChange(index, "pack_size", e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 4,
                          border: isQuantityExceeded ? "1px solid #fca5a5" : "1px solid #d1d5db",
                          fontSize: 14,
                          backgroundColor: "white",
                        }}
                      >
                        {(getCreatePackSizeOptions(item.material_id).length ? getCreatePackSizeOptions(item.material_id) : PACK_SIZE_PRESETS).map((size) => <option key={size} value={size}>{size} kg</option>)}
                        {!getCreatePackSizeOptions(item.material_id).length && <option value={CUSTOM_SENTINEL}>Custom</option>}
                      </select>
                      {item.pack_size === CUSTOM_SENTINEL && (
                        <input type="number" min="0.01" step="0.01" placeholder="Custom kg" value={item.custom_pack_size} onChange={(e) => handleMaterialChange(index, "custom_pack_size", e.target.value)} required />
                      )}
                      {item.material_id && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Available: {availableBags || 0} bags of {packSize || "this size"}</div>}
                    </div>

                    <div className="sf-field" style={{ marginBottom: 0 }}>
                      <label>No. of Bags</label>
                      <input
                        type="number"
                        min="1"
                        max={availableBags || undefined}
                        value={item.bag_count}
                        onChange={(e) => handleMaterialChange(index, "bag_count", e.target.value)}
                        required
                      />
                      {requestedBags > 0 && packSize > 0 && <div style={{ fontSize: 12, color: isQuantityExceeded ? "#dc2626" : "#64748b", marginTop: 4 }}>Input: {lineTons.toFixed(3)} tons</div>}
                      {isQuantityExceeded && (
                        <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                          ⚠️ {fieldErrors[index] || `Only ${availableBags} bags available`}
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
        <ProductionOutputPanel
          batch={selectedBatch}
          getMaterialLabel={materials.getLabel}
          getWarehouseLabel={warehouses.getLabel}
          onCancel={handleCancelPacking}
          onFinalized={handleFinalized}
          onRemoveInput={selectedBatch?.batch_status === "pending" ? handleRemoveInputLine : undefined}
          onAddInput={selectedBatch?.batch_status === "pending" ? () => handleOpenAddMaterial(selectedBatch) : undefined}
          busyInputKey={removingInputKey}
        />
      )}

      {/* Add Material to an existing pending batch, from Production History */}
      {addMaterialBatch && (
        <div
          id="add-material-panel"
          style={{
            background: "#fefce8",
            padding: "20px",
            borderRadius: "8px",
            marginTop: "20px",
            border: "2px solid #eab308",
          }}
        >
          <h3 style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Add Material to Batch: {addMaterialBatch.batch_no}</span>
            <button type="button" className="sf-cancel" onClick={handleCancelAddMaterial}>
              Cancel
            </button>
          </h3>

          <p className="field-hint">
            Adds another INPUT material to this batch before it is finalized. This only works while the
            batch status is still "pending".
          </p>

          {addMaterialError && <div className="dt-error">{addMaterialError}</div>}

          {addMaterialLoadingSummary && (
            <div style={{ color: "#64748b" }}>Loading warehouse details…</div>
          )}

          {!addMaterialLoadingSummary && (
            <form className="sf-form" onSubmit={handleAddMaterialSubmit}>
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Material</label>
                <InlineSearchSelect
                  value={addMaterialForm.material_id}
                  onChange={(id) =>
                    setAddMaterialForm({
                      ...addMaterialForm,
                      material_id: id,
                      pack_size: getAddMaterialPackSizeOptions(id)[0] || "",
                      custom_pack_size: "",
                      bag_count: "",
                    })
                  }
                  required
                  placeholder="Search material…"
                  options={getAddMaterialAvailableOptions().map((m) => ({
                    id: m.material_id,
                    label: m.material_name,
                    sublabel: `${(m.qty).toFixed(2)} tons`,
                  }))}
                  emptyMessage="No additional materials with stock are available in this batch's warehouse"
                />
              </div>

              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>
                  Bag Size (kg)
                  {addMaterialForm.material_id && (
                    <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400 }}>
                      {" "}
                      (select the warehouse pack size)
                    </span>
                  )}
                </label>
                {(() => {
                  const sizes = getAddMaterialPackSizeOptions(addMaterialForm.material_id);
                  const chosen = addMaterialForm.pack_size;
                  return (
                    <>
                      <select
                        value={chosen}
                        onChange={(e) => setAddMaterialForm({ ...addMaterialForm, pack_size: e.target.value, bag_count: "" })}
                        required
                        disabled={!addMaterialForm.material_id || sizes.length === 0}
                      >
                        {!addMaterialForm.material_id && <option value="">Select a material first</option>}
                        {addMaterialForm.material_id && sizes.length === 0 && <option value="">No bags in stock</option>}
                        {sizes.map((size) => (
                          <option key={size} value={size}>{size} kg</option>
                        ))}
                      </select>
                      {addMaterialForm.material_id && chosen && (
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          Available: {getAddMaterialBagsAvailable(addMaterialForm.material_id, chosen)} bags of {chosen} kg
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>No. of Bags</label>
                <input type="number" min="1" value={addMaterialForm.bag_count} onChange={(e) => setAddMaterialForm({ ...addMaterialForm, bag_count: e.target.value })} required />
              </div>

              <button
                className="sf-submit"
                type="submit"
                disabled={addMaterialLoading || getAddMaterialAvailableOptions().length === 0}
                style={{ gridColumn: "1 / -1" }}
              >
                {addMaterialLoading ? "Adding..." : "Add Material to Batch"}
              </button>
            </form>
          )}
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
          {
            key: "output",
            label: "Output (Tons)",
            render: (row) => {
              const lines = row.outputs_data?.lines;
              if (!Array.isArray(lines) || lines.length === 0) return "—";
              const sum = (k) => lines.reduce((acc, l) => acc + Number(l[k] || 0), 0);
              return (
                <span>
                  {sum("accepted_qty").toFixed(3)} accepted
                  {sum("rejected_qty") > 0 && <span style={{ color: "#b91c1c" }}> · {sum("rejected_qty").toFixed(3)} rejected</span>}
                </span>
              );
            },
          },
          {
            key: "batch_status",
            label: "Status",
            render: (row) => {
              const palette = {
                pending: { bg: "#fff7ed", fg: "#9a3412" },
                completed: { bg: "#dcfce7", fg: "#15803d" },
              }[row.batch_status] || { bg: "#eef2f7", fg: "#475569" };
              return (
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: palette.bg, color: palette.fg }}>
                  {row.batch_status}
                </span>
              );
            },
          },
          {
            key: "actions",
            label: "Actions",
            render: (row) =>
              row.batch_status === "pending" ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="dt-btn" onClick={() => handleContinueBatch(row)}>
                    Continue / Finalize
                  </button>
                  <button className="dt-btn" onClick={() => handleOpenAddMaterial(row)}>
                    + Material
                  </button>
                  <button className="dt-btn dt-btn-danger" onClick={() => handleDeletePendingBatch(row)}>
                    Delete
                  </button>
                </div>
              ) : (
                "—"
              ),
          },
        ]}
      />
      <ModuleGuide
        title="Production"
        steps={[
          "Step 1: Select the source warehouse to see its stock, then add the INPUT materials — material, bag size and number of bags.",
          "Step 2: Click 'Create Batch' — this reserves the input (nothing is deducted yet) and opens the output screen. The batch is 'pending'.",
          "Step 3: For each input material, add what it produced: pick the output material (search — it can even be the same material as the input), the bag size, and the accepted and rejected bags. '+ Add Co-Product' adds another output row.",
          "Output of one input (accepted + rejected) can't be more than that input; less is fine — the rest is shrink / loss. Rejected bags are recorded but never added to stock.",
          "Step 4: Choose the destination warehouse for all accepted output and click 'Finalize Batch' — the input is deducted from the source warehouse and the accepted output is added to the destination.",
          "Left the screen before finalizing? The batch stays 'pending' with its stock reserved. In Production History use 'Continue / Finalize' to finish it, '+ Material' to add another input material, or 'Delete' to release its reservation.",
        ]}
      />
    </div>
  );
}