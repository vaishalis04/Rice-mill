import { useEffect, useState } from "react";
import {
  createProductionBatchApi,
  getProductionBatchesApi,
  getWarehouseSummaryApi,
  completePackingApi,
  addProductionBatchMaterialApi,
  removeProductionBatchMaterialApi,
  swapProductionBatchMaterialApi,
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

const emptyAddMaterialForm = {
  material_id: "",
  pack_size: "25",
  custom_pack_size: "",
  bag_count: "",
};

const emptyPackingAddMaterialForm = {
  material_id: "",
  pack_size: "25",
  custom_pack_size: "",
  bag_count: "",
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

  // ---- Add Material to an already-created (still "pending") batch, from
  // the Production History table ----
  const [addMaterialBatch, setAddMaterialBatch] = useState(null);
  const [addMaterialForm, setAddMaterialForm] = useState(emptyAddMaterialForm);
  const [addMaterialWarehouseSummary, setAddMaterialWarehouseSummary] = useState(null);
  const [addMaterialLoadingSummary, setAddMaterialLoadingSummary] = useState(false);
  const [addMaterialLoading, setAddMaterialLoading] = useState(false);
  const [addMaterialError, setAddMaterialError] = useState("");

  // ---- Add / swap / remove materials directly on the Packing screen,
  // before "Finalize & Pack" ----
  const [showPackingAddMaterial, setShowPackingAddMaterial] = useState(false);
  const [packingAddMaterialForm, setPackingAddMaterialForm] = useState(emptyPackingAddMaterialForm);
  const [packingWarehouseSummary, setPackingWarehouseSummary] = useState(null);
  const [packingWarehouseSummaryLoading, setPackingWarehouseSummaryLoading] = useState(false);
  const [packingAddMaterialLoading, setPackingAddMaterialLoading] = useState(false);
  const [packingAddMaterialError, setPackingAddMaterialError] = useState("");
  const [rowActionError, setRowActionError] = useState("");
  const [rowActionLoadingId, setRowActionLoadingId] = useState(null);

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

  // Load the packing warehouse's summary once we enter the packing screen —
  // used both by the "+ Add Material" form and by the per-row "change
  // material" dropdown.
  useEffect(() => {
    if (!showPacking || !selectedBatch?.warehouse_id) {
      setPackingWarehouseSummary(null);
      return;
    }
    let cancelled = false;
    setPackingWarehouseSummaryLoading(true);
    getWarehouseSummaryApi(selectedBatch.warehouse_id)
      .then((res) => {
        if (!cancelled) setPackingWarehouseSummary(res.data.data);
      })
      .catch(() => {
        if (!cancelled) setRowActionError("Failed to load warehouse details for this batch's warehouse");
      })
      .finally(() => {
        if (!cancelled) setPackingWarehouseSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showPacking, selectedBatch?.id, selectedBatch?.warehouse_id]);

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
    return warehouseSummary.materials;
  };

  const getResolvedCreatePackSize = (item) =>
    item.pack_size === CUSTOM_SENTINEL ? item.custom_pack_size : item.pack_size;

  const getCreateBagAvailability = (materialId, packSize) => {
    const material = warehouseSummary?.materials?.find((m) => m.material_id === Number(materialId));
    if (!material) return 0;
    const bag = (material.bags || []).find((entry) => Number(entry.bag_size) === Number(packSize));
    return bag?.bag_count || 0;
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
        }, ${totalQty.toFixed(2)} tons total). Now complete packing.`
      );

      setSelectedBatch(created);
      setShowPacking(true);

      // Packing rows start out as the materials reserved at creation time —
      // but can now be edited, added to, or removed from below, right up
      // until "Finalize & Pack" is clicked.
      const packingMaterials = validMaterials.map((m) => ({
        material_id: String(m.material_id),
        material_name: materials.getLabel(m.material_id) || "",
        reserved_qty: (Number(getResolvedCreatePackSize(m)) * Number(m.bag_count)) / 1000,
        pack_size: String(getResolvedCreatePackSize(m)),
        custom_pack_size: "",
        bag_count: String(m.bag_count),
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
      handleCancelAddMaterial();
      load();
    } catch (err) {
      setAddMaterialError(
        err.response?.data?.msg || err.response?.data?.message || "Could not add material to this batch"
      );
    } finally {
      setAddMaterialLoading(false);
    }
  };

  // ---------------- Add / swap / remove materials on the Packing screen
  // (the batch just created, still "pending" until Finalize & Pack) --------

  const getPackingReservedMaterialIds = () =>
    packingForm.materials.map((m) => Number(m.material_id));

  const handleOpenPackingAddMaterial = () => {
    setPackingAddMaterialError("");
    setPackingAddMaterialForm(emptyPackingAddMaterialForm);
    setShowPackingAddMaterial(true);
  };

  const handleCancelPackingAddMaterial = () => {
    setShowPackingAddMaterial(false);
    setPackingAddMaterialForm(emptyPackingAddMaterialForm);
    setPackingAddMaterialError("");
  };

  const getPackingAddMaterialOptions = () => {
    if (!packingWarehouseSummary?.materials) return [];
    const existingIds = getPackingReservedMaterialIds();
    return packingWarehouseSummary.materials.filter((m) => !existingIds.includes(m.material_id));
  };

  const getPackingAddMaterialAvailableQty = (materialId) => {
    if (!packingWarehouseSummary?.materials) return 0;
    const material = packingWarehouseSummary.materials.find(
      (m) => m.material_id === Number(materialId)
    );
    return material ? material.qty : 0;
  };

  const getPackingAddResolvedPackSize = () =>
    packingAddMaterialForm.pack_size === CUSTOM_SENTINEL
      ? packingAddMaterialForm.custom_pack_size
      : packingAddMaterialForm.pack_size;

  const handlePackingAddMaterialSubmit = async () => {
    setPackingAddMaterialError("");

    const { material_id, bag_count } = packingAddMaterialForm;
    const resolvedPackSize = Number(getPackingAddResolvedPackSize());
    const bagCount = Number(bag_count);

    if (!material_id) {
      setPackingAddMaterialError("Please select a material");
      return;
    }
    if (!(resolvedPackSize > 0)) {
      setPackingAddMaterialError("Enter a valid pack size (kg)");
      return;
    }
    if (!(bagCount > 0)) {
      setPackingAddMaterialError("Enter a bag count greater than 0");
      return;
    }

    const qtyTons = (resolvedPackSize * bagCount) / 1000;
    const availableInTons = getPackingAddMaterialAvailableQty(material_id);
    const tolerance = 0.001;
    if (availableInTons > 0 && qtyTons > availableInTons + tolerance) {
      setPackingAddMaterialError(
        `${resolvedPackSize}kg x ${bagCount} bags = ${qtyTons.toFixed(3)} tons, but only ${availableInTons.toFixed(3)} tons available`
      );
      return;
    }

    setPackingAddMaterialLoading(true);
    try {
      await addProductionBatchMaterialApi(selectedBatch.id, {
        material_id: Number(material_id),
        input_qty: qtyTons,
      });
      setPackingForm((prev) => ({
        ...prev,
        materials: [
          ...prev.materials,
          {
            material_id: String(material_id),
            material_name: materials.getLabel(material_id) || "",
            reserved_qty: qtyTons,
            pack_size: packingAddMaterialForm.pack_size,
            custom_pack_size: packingAddMaterialForm.custom_pack_size,
            bag_count: String(bagCount),
            qty_override: "",
          },
        ],
      }));
      setInfo("Material added to this batch");
      handleCancelPackingAddMaterial();
    } catch (err) {
      setPackingAddMaterialError(
        err.response?.data?.msg || err.response?.data?.message || "Could not add material"
      );
    } finally {
      setPackingAddMaterialLoading(false);
    }
  };

  const handleRemovePackingMaterial = async (materialId) => {
    if (packingForm.materials.length <= 1) {
      setRowActionError(
        "A batch needs at least one material — cancel the batch instead if none are needed."
      );
      return;
    }
    if (!window.confirm("Remove this material from the batch?")) return;

    setRowActionError("");
    setRowActionLoadingId(materialId);
    try {
      await removeProductionBatchMaterialApi(selectedBatch.id, materialId);
      setPackingForm((prev) => ({
        ...prev,
        materials: prev.materials.filter((m) => String(m.material_id) !== String(materialId)),
      }));
    } catch (err) {
      setRowActionError(
        err.response?.data?.msg || err.response?.data?.message || "Could not remove this material"
      );
    } finally {
      setRowActionLoadingId(null);
    }
  };

  // Options for the per-row "change material" dropdown: warehouse
  // materials not already used on another row, plus the row's own current
  // material (so it always appears as the selected option even if its
  // remaining stock after reservations is low/zero).
  const getRowSwapOptions = (currentMaterialId) => {
    const reservedIdsExcludingSelf = getPackingReservedMaterialIds().filter(
      (id) => String(id) !== String(currentMaterialId)
    );
    const fromSummary = (packingWarehouseSummary?.materials || []).filter(
      (m) => !reservedIdsExcludingSelf.includes(m.material_id)
    );
    const hasCurrent = fromSummary.some((m) => String(m.material_id) === String(currentMaterialId));
    if (!hasCurrent) {
      fromSummary.push({
        material_id: Number(currentMaterialId),
        material_name: materials.getLabel(currentMaterialId) || `Material ${currentMaterialId}`,
        qty: 0,
      });
    }
    return fromSummary;
  };

  const handleSwapMaterial = async (oldMaterialId, newMaterialIdRaw) => {
    const newMaterialId = Number(newMaterialIdRaw);
    if (!newMaterialId || String(newMaterialId) === String(oldMaterialId)) return;

    setRowActionError("");
    setRowActionLoadingId(oldMaterialId);
    try {
      await swapProductionBatchMaterialApi(selectedBatch.id, oldMaterialId, newMaterialId);
      setPackingForm((prev) => ({
        ...prev,
        materials: prev.materials.map((m) =>
          String(m.material_id) === String(oldMaterialId)
            ? { ...m, material_id: String(newMaterialId), material_name: materials.getLabel(newMaterialId) || "" }
            : m
        ),
      }));
    } catch (err) {
      setRowActionError(
        err.response?.data?.msg || err.response?.data?.message || "Could not change material"
      );
    } finally {
      setRowActionLoadingId(null);
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
    setShowPackingAddMaterial(false);
    setRowActionError("");
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
                              <strong>{(m.qty).toFixed(2)} tons</strong>
                            </div>
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
            for each reserved material. You can still add or remove a material, or change which
            material a line refers to, right up until you click "Finalize & Pack".
          </p>

          {rowActionError && <div className="dt-error">{rowActionError}</div>}

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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <label style={{ fontWeight: 600, fontSize: 14 }}>Packing Details</label>
                <button type="button" className="dt-btn" onClick={handleOpenPackingAddMaterial}>
                  + Add Material
                </button>
              </div>

              {/* Inline "add another material to this batch" form — material,
                  pack size and bag count are captured together, same as a
                  normal packing line. */}
              {showPackingAddMaterial && (
                <div
                  style={{
                    padding: "12px",
                    background: "#eff6ff",
                    border: "1px solid #93c5fd",
                    borderRadius: 6,
                    marginBottom: 12,
                  }}
                >
                  {packingAddMaterialError && <div className="dt-error">{packingAddMaterialError}</div>}
                  {packingWarehouseSummaryLoading ? (
                    <div style={{ color: "#64748b" }}>Loading warehouse details…</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 12 }}>
                        <EntitySelect
                          entity="material"
                          label="Material"
                          value={packingAddMaterialForm.material_id}
                          onChange={(id) =>
                            setPackingAddMaterialForm({ ...packingAddMaterialForm, material_id: id })
                          }
                          creatable
                        />
                        {packingAddMaterialForm.material_id && (
                          <div style={{ fontSize: 12, color: "#64748b", marginTop: -8 }}>
                            Available in this warehouse:{" "}
                            {getPackingAddMaterialAvailableQty(packingAddMaterialForm.material_id).toFixed(2)} tons
                          </div>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 12, alignItems: "end" }}>
                        <div className="sf-field" style={{ marginBottom: 0 }}>
                          <label>Pack Size (kg)</label>
                          <select
                            value={packingAddMaterialForm.pack_size}
                            onChange={(e) =>
                              setPackingAddMaterialForm({ ...packingAddMaterialForm, pack_size: e.target.value })
                            }
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
                          {packingAddMaterialForm.pack_size === CUSTOM_SENTINEL && (
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="Custom kg"
                              value={packingAddMaterialForm.custom_pack_size}
                              onChange={(e) =>
                                setPackingAddMaterialForm({ ...packingAddMaterialForm, custom_pack_size: e.target.value })
                              }
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
                            value={packingAddMaterialForm.bag_count}
                            onChange={(e) =>
                              setPackingAddMaterialForm({ ...packingAddMaterialForm, bag_count: e.target.value })
                            }
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: 4,
                              border: "1px solid #d1d5db",
                              fontSize: 14,
                            }}
                          />
                          {getPackingAddResolvedPackSize() && packingAddMaterialForm.bag_count && (
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                              Total: {(Number(getPackingAddResolvedPackSize()) * Number(packingAddMaterialForm.bag_count)).toFixed(0)} kg (
                              {((Number(getPackingAddResolvedPackSize()) * Number(packingAddMaterialForm.bag_count)) / 1000).toFixed(3)} tons)
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="dt-btn"
                          disabled={packingAddMaterialLoading}
                          onClick={handlePackingAddMaterialSubmit}
                        >
                          {packingAddMaterialLoading ? "Adding..." : "Add"}
                        </button>
                        <button type="button" className="sf-cancel" onClick={handleCancelPackingAddMaterial}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {packingForm.materials.map((item, index) => {
                const resolvedPackSize = getResolvedPackSize(item);
                const totalKg = resolvedPackSize && item.bag_count ? Number(resolvedPackSize) * Number(item.bag_count) : 0;
                const totalTons = totalKg / 1000; // ✅ Fixed: convert kg to tons
                const isRowBusy = String(rowActionLoadingId) === String(item.material_id);
                const swapOptions = getRowSwapOptions(item.material_id);

                return (
                  <div
                    key={index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr auto",
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
                      <select
                        value={item.material_id}
                        disabled={isRowBusy || packingWarehouseSummaryLoading}
                        onChange={(e) => handleSwapMaterial(item.material_id, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 4,
                          border: "1px solid #d1d5db",
                          fontSize: 14,
                          background: "white",
                        }}
                      >
                        {swapOptions.map((m) => (
                          <option key={m.material_id} value={m.material_id}>
                            {m.material_name}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        Reserved: {item.reserved_qty.toFixed(3)} tons
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

                    <button
                      type="button"
                      className="sf-cancel"
                      disabled={isRowBusy}
                      onClick={() => handleRemovePackingMaterial(item.material_id)}
                      style={{ marginBottom: 1 }}
                    >
                      {isRowBusy ? "..." : "Remove"}
                    </button>
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

      {/* Add Material to an existing pending batch, from Production History */}
      {addMaterialBatch && (
        <div
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
            Adds another material to this batch before packing. This only works while the batch
            status is still "pending".
          </p>

          {addMaterialError && <div className="dt-error">{addMaterialError}</div>}

          {addMaterialLoadingSummary && (
            <div style={{ color: "#64748b" }}>Loading warehouse details…</div>
          )}

          {!addMaterialLoadingSummary && (
            <form className="sf-form" onSubmit={handleAddMaterialSubmit}>
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Material</label>
                <select
                  value={addMaterialForm.material_id}
                  onChange={(e) =>
                    setAddMaterialForm({ ...addMaterialForm, material_id: e.target.value })
                  }
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid #d1d5db",
                    fontSize: 14,
                  }}
                >
                  <option value="">Select Material</option>
                  {getAddMaterialAvailableOptions().map((m) => (
                    <option key={m.material_id} value={m.material_id}>
                      {m.material_name} ({(m.qty).toFixed(2)} tons)
                    </option>
                  ))}
                </select>
                {getAddMaterialAvailableOptions().length === 0 && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    No additional materials with stock are available in this batch's warehouse.
                  </div>
                )}
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
                <select value={addMaterialForm.pack_size} onChange={(e) => setAddMaterialForm({ ...addMaterialForm, pack_size: e.target.value })} required>
                  {PACK_SIZE_PRESETS.map((size) => <option key={size} value={size}>{size} kg</option>)}
                  <option value={CUSTOM_SENTINEL}>Custom</option>
                </select>
                {addMaterialForm.pack_size === CUSTOM_SENTINEL && <input type="number" min="0.01" step="0.01" placeholder="Custom kg" value={addMaterialForm.custom_pack_size} onChange={(e) => setAddMaterialForm({ ...addMaterialForm, custom_pack_size: e.target.value })} required />}
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
          { key: "batch_status", label: "Status" },
          {
            key: "add_material",
            label: "Add Material",
            render: (row) =>
              row.batch_status === "pending" ? (
                <button className="dt-btn" onClick={() => handleOpenAddMaterial(row)}>
                  + Material
                </button>
              ) : (
                "—"
              ),
          },
        ]}
      />
      <ModuleGuide
        title="Production"
        steps={[
          "Step 1: Select a warehouse to view its total stock and materials available.",
          "Step 2: Add one or more materials from the warehouse with quantities in tons.",
          "Step 3: Click 'Create Batch' — this reserves the stock and opens the packing form.",
          "Step 4: On the packing screen you can still add another material (with its own pack size and bag count), remove one, or change which material a line refers to — before finalizing.",
          "Step 5: Select the destination warehouse for the packed goods.",
          "Step 6: For each material, choose the pack size and bag count.",
          "Step 7: Click 'Finalize & Pack' — this removes the reserved qty from the source warehouse and adds the packed qty (converted to tons) to the destination warehouse.",
          "Need to add another material to a batch you already left the packing screen for? Use the '+ Material' button in Production History — this only works while the batch is still 'pending'.",
        ]}
      />
    </div>
  );
}