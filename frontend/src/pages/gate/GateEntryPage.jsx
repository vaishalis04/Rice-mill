import { useState, useEffect } from "react";
import {
  getGateEntriesApi,
  generateGateTokenApi,
  gateCheckinApi,
  gateCheckoutApi,
  gateSendToWarehouseApi,
  uploadGatePhotoApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import CameraCapture from "../../components/CameraCapture";
import { useEntityLookup } from "../../hooks/useEntityLookup";
import "./GateEntry.css";

const emptyForm = {
  entry_type: "purchase",
  vehicle_id: "",
  driver_id: "",
  vendor_id: "",
  so_id: "",
  challan_no: "",
  expected_qty: "",
  remarks: "",
  driver_photo_url: "",
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "waiting_token", label: "Waiting Token" },
  { key: "waiting_sampling", label: "Waiting Sampling" },
  { key: "sampling_done", label: "Sampling Done" },
  { key: "accepted", label: "Accepted" },
  { key: "waiting_weighment", label: "Waiting Weighment" },
  { key: "rejected", label: "Rejected" },
  { key: "in_process", label: "In Process (Weighed)" },
  { key: "unloaded", label: "Unloaded" },
  { key: "waiting_loading", label: "Waiting Loading" },
  { key: "loaded", label: "Loaded" },
  { key: "parked", label: "Parked" },
  { key: "exited", label: "Exited" },
];

const ENTRY_TYPE_FILTERS = [
  { key: "", label: "All Trucks" },
  { key: "purchase", label: "Purchase Trucks" },
  { key: "other", label: "Empty / Misc Trucks" },
  { key: "sales", label: "Sales (Outbound) Trucks" },
];

export default function GateEntryPage({ prefillSoId, onPrefillConsumed } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [poGroup, setPoGroup] = useState(null);
  const [soGroup, setSoGroup] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [lastVendor, setLastVendor] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  const [selectedPOs, setSelectedPOs] = useState([]);
const [selectedMaterials, setSelectedMaterials] = useState({});

  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const purchaseOrders = useEntityLookup("purchase_order");
  const salesOrders = useEntityLookup("sales_order");
  const salesOrderGroups = useEntityLookup("sales_order_grouped");

  // "Load New Truck for Remaining Qty (Tons)" on the Loading tab jumps here with a
  // specific Sales Order LINE ITEM id already known (prefillSoId) — resolve
  // which grouped SO it belongs to (so the picker + box display correctly)
  // and pre-select that exact item.
  useEffect(() => {
    if (!prefillSoId) return;
    setForm((prev) => ({ ...emptyForm, entry_type: "sales", so_id: prefillSoId }));
    setPoGroup(null);
    const group = salesOrderGroups.rows.find(
      (g) => Array.isArray(g.items) && g.items.some((i) => String(i.id) === String(prefillSoId))
    );
    setSoGroup(group || null);
    if (onPrefillConsumed) onPrefillConsumed();
  }, [prefillSoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guards against a race where salesOrderGroups hasn't finished its fetch
  // yet at the moment the prefill effect above runs — once the grouped
  // list does arrive, try again to resolve soGroup for display.
  useEffect(() => {
    if (!form.so_id || soGroup || form.entry_type !== "sales") return;
    const group = salesOrderGroups.rows.find(
      (g) => Array.isArray(g.items) && g.items.some((i) => String(i.id) === String(form.so_id))
    );
    if (group) setSoGroup(group);
  }, [salesOrderGroups.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOther = form.entry_type === "other";
  const isSales = form.entry_type === "sales";

  const load = (status = statusFilter, entryType = entryTypeFilter) => {
    setLoading(true);
    getGateEntriesApi(status || undefined, entryType || undefined)
      .then((res) => setEntries(res.data.data ?? res.data))
      .catch(() => setError("Failed to load gate entries"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusFilterChange = (status) => {
    setStatusFilter(status);
    load(status, entryTypeFilter);
  };

  const handleEntryTypeFilterChange = (entryType) => {
    setEntryTypeFilter(entryType);
    load(statusFilter, entryType);
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const setField = (name) => (id) => setForm({ ...form, [name]: id });

const handleAddPurchaseOrder = (po_id) => {
  if (!po_id) return;

  const po = purchaseOrders.rows.find(
    (r) => String(r.id) === String(po_id)
  );

  if (!po) return;

  // Don't add same PO twice
  if (
    selectedPOs.some(
      (p) => String(p.id) === String(po.id)
    )
  ) {
    return;
  }

  setSelectedPOs((prev) => [...prev, po]);

  // IMPORTANT:
  // Start with NO materials selected.
  setSelectedMaterials((prev) => ({
    ...prev,
    [po.id]: [],
  }));

  // Vendor comes from PO
  setForm((prev) => ({
    ...prev,
    vendor_id: po.vendor_id,
  }));
};  
  
const handleRemovePurchaseOrder = (poId) => {
  setSelectedPOs((prev) =>
    prev.filter((po) => String(po.id) !== String(poId))
  );

  setSelectedMaterials((prev) => {
    const updated = { ...prev };
    delete updated[poId];
    return updated;
  });
};
const handleToggleMaterial = (poId, material) => {
  setSelectedMaterials((prev) => {
    const current = prev[poId] || [];

    const materialId = String(material.material_id);

    const exists = current.some(
      (m) => String(m.material_id) === materialId
    );

    if (exists) {
      return {
        ...prev,
        [poId]: current.filter(
          (m) =>
            String(m.material_id) !== materialId
        ),
      };
    }

    return {
      ...prev,
      [poId]: [
        ...current,
        {
          material_id: material.material_id,
          qty: "",
        },
      ],
    };
  });
};
const handleMaterialQtyChange = (
  poId,
  materialId,
  qty
) => {
  setSelectedMaterials((prev) => ({
    ...prev,

    [poId]: (prev[poId] || []).map((m) =>
      String(m.material_id) === String(materialId)
        ? {
            ...m,
            qty,
          }
        : m
    ),
  }));
};

  const handleSoChange = (so_id) => {
    const so = salesOrderGroups.rows.find((r) => String(r.id) === String(so_id));
    setSoGroup(so || null);
    const items = so && Array.isArray(so.items) ? so.items : [];
    const openItem = items.find((i) => !["dispatched", "closed", "cancelled"].includes(i.so_status)) || items[0];
    setForm((prev) => ({
      ...prev,
      so_id: openItem ? openItem.id : "",
      material_id: openItem ? openItem.material_id : "",
    }));
    salesOrders.refetch();
  };

  const handleEntryTypeChange = (e) => {
    const entry_type = e.target.value;
    setForm((prev) => ({
      ...emptyForm,
      entry_type,
      vehicle_id: prev.vehicle_id,
      driver_id: prev.driver_id,
      driver_photo_url: prev.driver_photo_url,
    }));
    setPoGroup(null);
    setSoGroup(null);
  };

  const handlePhotoCaptured = async (dataUrl) => {
    setShowCamera(false);
    setPhotoPreview(dataUrl);
    setPhotoUploadError("");
    setForm((prev) => ({ ...prev, driver_photo_url: "" }));
    setUploadingPhoto(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const res = await uploadGatePhotoApi(blob);
      const url = res.data.data?.url ?? res.data.url;
      if (!url) throw new Error("Upload didn't return a URL");
      setForm((prev) => ({ ...prev, driver_photo_url: url }));
    } catch (err) {
      setPhotoUploadError(
        err.response?.data?.msg ||
          err.response?.data?.message ||
          err.message ||
          "Photo upload failed — try Retake, or Clear and continue without a photo."
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleClearPhoto = () => {
    setPhotoPreview("");
    setPhotoUploadError("");
    setForm((prev) => ({ ...prev, driver_photo_url: "" }));
  };

  const handleGenerateToken = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLastToken("");
    setLastVendor("");
    if (uploadingPhoto) {
      setError("The driver photo is still uploading — wait a moment and try again.");
      return;
    }
    if (form.entry_type === "purchase" && poGroup && poGroup.items.length > 1 && !form.po_id) {
      setError("Tap which material on this PO the truck is delivering before generating the token.");
      return;
    }
    if (form.entry_type === "sales" && soGroup && soGroup.items.length > 1 && !form.so_id) {
      setError("Tap which material on this Sales Order the truck is collecting before generating the token.");
      return;
    }
    try {
      const payload = {
        entry_type: form.entry_type,
        vehicle_id: Number(form.vehicle_id),
        driver_id: Number(form.driver_id),
        driver_photo_url: form.driver_photo_url,
      };

   if (form.entry_type === "purchase") {
  // ---------------------------------------------
  // At least one PO
  // ---------------------------------------------

  if (selectedPOs.length === 0) {
    setError(
      "Please select at least one Purchase Order."
    );
    return;
  }

  // ---------------------------------------------
  // Build PO + materials payload
  // ---------------------------------------------

  const purchase_orders = [];

  for (const po of selectedPOs) {
    const materials =
      selectedMaterials[po.id] || [];

    // PO must have material
    if (materials.length === 0) {
      setError(
        `Please select at least one material for PO ${
          po.po_no || po.id
        }.`
      );
      return;
    }

    // Validate quantities
    
    purchase_orders.push({
      po_id: Number(po.id),

      materials: materials.map(
        (material) => ({
          material_id: Number(
            material.material_id
          ),
          qty: Number(material.qty),
        })
      ),
    });
  }

  // ---------------------------------------------
  // Vendor
  // ---------------------------------------------

  if (!form.vendor_id) {
    setError(
      "Vendor is required for a purchase entry."
    );
    return;
  }

  payload.vendor_id = Number(
    form.vendor_id
  );

  // ---------------------------------------------
  // Purchase Orders
  // ---------------------------------------------

  payload.purchase_orders =
    purchase_orders;

  // ---------------------------------------------
  // Challan
  // ---------------------------------------------

  if (form.challan_no) {
    payload.challan_no =
      form.challan_no;
  }

  // ---------------------------------------------
  // Expected quantity
  // ---------------------------------------------

  if (form.expected_qty) {
    payload.expected_qty = Number(
      form.expected_qty
    );
  }
}else if (form.entry_type === "sales") {
        payload.so_id = Number(form.so_id);
        payload.challan_no = form.challan_no || undefined;
        payload.expected_qty = form.expected_qty ? Number(form.expected_qty) : undefined;
      } else {
        payload.challan_no = form.challan_no || undefined;
        payload.remarks = form.remarks;
      }

      const res = await generateGateTokenApi(payload);
      const generatedEntry = res.data.data;
      const tokenNo = res.data.token_no ?? generatedEntry?.token_no;
      const vendorName = generatedEntry?.vendor?.name || poGroup?.vendor?.name || "";
      setLastToken(tokenNo || "");
      setLastVendor(vendorName);
      setInfo(
        tokenNo
          ? "Token generated — give this number to the driver."
          : "Entry saved (check the list below for the token number)."
      );
      setForm(emptyForm);
setSelectedPOs([]);
setSelectedMaterials({});
setPoGroup(null);
setSoGroup(null);
setPhotoPreview("");
      setPhotoUploadError("");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Failed to generate token");
    }
  };

  const handleCheckin = async (id) => {
    setError("");
    try {
      await gateCheckinApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Check-in failed");
    }
  };

  const handleCheckout = async (id) => {
    setError("");
    try {
      await gateCheckoutApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Check-out failed");
    }
  };

  const handleSendToWarehouse = async (id) => {
    setError("");
    setInfo("");
    try {
      await gateSendToWarehouseApi(id);
      setInfo("Truck sent to warehouse.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Failed to send to warehouse");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Gate Entry</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-success">
          {info}
          {lastToken && (
            <div style={{ marginTop: 8 }}>
              <span className="token-chip token-chip-lg">{lastToken}</span>
            </div>
          )}
          {lastVendor && (
            <div style={{ marginTop: 8 }}>
              <strong>Vendor:</strong> {lastVendor}
            </div>
          )}
        </div>
      )}

      <h3 style={{ marginBottom: 4 }}>Generate Token</h3>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Fill this in when a truck arrives at the gate. Choose "Empty / Miscellaneous" for
        trucks with no vendor delivery — those skip Sampling and Lab and go straight to
        Weighbridge (if needed) and Warehouse instead. Choose "Sales (Outbound Loading)" for
        an empty truck that's here to be loaded and dispatched against a Sales Order.
      </p>
      <form className="sf-form" onSubmit={handleGenerateToken}>
        <div className="sf-field">
          <label>Entry Type</label>
          <select name="entry_type" value={form.entry_type} onChange={handleEntryTypeChange}>
            <option value="purchase">Purchase (Vendor Delivery)</option>
            <option value="other">Empty / Miscellaneous</option>
            <option value="sales">Sales (Outbound Loading)</option>
          </select>
          <p className="field-hint">
            {isSales
              ? "An empty truck arriving to be loaded against a Sales Order and dispatched."
              : isOther
              ? "No vendor delivery — e.g. an empty truck, or one dropping off items that don't need QC."
              : "A vendor is delivering grain against a Purchase Order."}
          </p>
        </div>
        <div>
          <EntitySelect
            entity="vehicle"
            label="Vehicle"
            value={form.vehicle_id}
            onChange={setField("vehicle_id")}
            required
            creatable
          />
          <p className="field-hint">The truck's number plate.</p>
        </div>
        <div>
          <EntitySelect
            entity="driver"
            label="Driver"
            value={form.driver_id}
            onChange={setField("driver_id")}
            required
            creatable
          />
          <p className="field-hint">Who's driving the truck today.</p>
        </div>
        {form.entry_type === "purchase" && (
  <>
    <div className="sf-field">
      <label>Purchase Orders</label>

      <EntitySelect
        entity="purchase_order"
        label="Add Purchase Order"
        value=""
        onChange={handleAddPurchaseOrder}
        required={selectedPOs.length === 0}
      />

      <p className="field-hint">
        You can select multiple Purchase Orders. After selecting a PO,
        choose one or more materials from that PO.
      </p>
    </div>

    {selectedPOs.length > 0 && (
      <div className="multi-po-container">
        {selectedPOs.map((po) => {
          const materials = Array.isArray(po.items)
            ? po.items
            : [];

          const selected =
            selectedMaterials[po.id] || [];

          return (
            <div
              key={po.id}
              className="po-selection-card"
            >
              <div className="po-selection-header">
                <div>
                  <strong>
                    PO #{po.po_no || po.id}
                  </strong>

                  <div className="field-hint">
                    Vendor: {po.vendor?.name || "—"}
                  </div>
                </div>

                <button
                  type="button"
                  className="dt-btn dt-btn-danger"
                  onClick={() =>
                    handleRemovePurchaseOrder(po.id)
                  }
                >
                  Remove
                </button>
              </div>

              <div className="po-material-list">
                <div className="po-material-title">
                  Select Materials
                </div>

                {materials.map((material) => {
                  const isSelected = selected.some(
                    (m) =>
                      String(m.material_id) ===
                      String(material.material_id)
                  );

                  const selectedMaterial = selected.find(
                    (m) =>
                      String(m.material_id) ===
                      String(material.material_id)
                  );

                  return (
                    <div
                      key={material.material_id}
                      className={`po-material-row ${
                        isSelected ? "selected" : ""
                      }`}
                    >
                      <label className="material-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            handleToggleMaterial(
                              po.id,
                              material
                            )
                          }
                        />

                        <span>
                          <strong>
                            {material.material?.name ||
                              "Unknown Material"}
                          </strong>

                          {material.variety?.variety_name && (
                            <span className="material-variety">
                              {" "}
                              ({material.variety.variety_name})
                            </span>
                          )}

                          <small>
                            Ordered: {material.qty} @ ₹
                            {material.rate}
                          </small>
                        </span>
                      </label>

                      {isSelected && (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="material-qty-input"
                          placeholder="Qty (Tons)"
                          value={
                            selectedMaterial?.qty || ""
                          }
                          onChange={(e) =>
                            handleMaterialQtyChange(
                              po.id,
                              material.material_id,
                              e.target.value
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}

    <div className="sf-field">
      <label>Challan No.</label>

      <input
        name="challan_no"
        value={form.challan_no}
        onChange={handleChange}
        required
      />

      <p className="field-hint">
        The delivery-note number the driver brought with them.
      </p>
    </div>

    <div className="sf-field">
      <label>Expected Qty (Tons)</label>

      <input
        name="expected_qty"
        type="number"
        value={form.expected_qty}
        onChange={handleChange}
        required
      />

      <p className="field-hint">
        Total quantity expected on this truck.
      </p>
    </div>
  </>
)}
        {isSales && (
          <>
            <div>
              <EntitySelect
                entity="sales_order_grouped"
                label="Sales Order"
                value={soGroup ? soGroup.id : ""}
                onChange={handleSoChange}
                required
              />
              <p className="field-hint">
                Picking a Sales Order books this truck against it and fills in the Customer
                automatically. Which material this truck actually collects is decided later, on
                the Loading tab (in Warehouse) when the truck is physically loaded — that's also
                where the loaded quantity is entered, and it can't exceed the Sales Order's
                remaining qty.
              </p>
            </div>
            <div className="sf-field">
              <label>Challan No. (if any)</label>
              <input
                name="challan_no"
                value={form.challan_no}
                onChange={handleChange}
              />
              <p className="field-hint">Optional — the delivery-note number for this dispatch, if any.</p>
            </div>
            <div className="sf-field">
              <label>Planned Loading Qty (Tons) (optional)</label>
              <input
                name="expected_qty"
                type="number"
                value={form.expected_qty}
                onChange={handleChange}
              />
              <p className="field-hint">
                Optional estimate only — the actual quantity is entered when the truck is loaded
                (Loading tab), and it can't exceed the Sales Order's ordered qty.
              </p>
            </div>
          </>
        )}
        {isOther && (
          <>
            <div className="sf-field">
              <label>Challan No. (if any)</label>
              <input
                name="challan_no"
                value={form.challan_no}
                onChange={handleChange}
              />
              <p className="field-hint">Optional — only if the driver brought a delivery note.</p>
            </div>
            <div className="sf-field">
              <label>Remarks</label>
              <input
                name="remarks"
                value={form.remarks}
                onChange={handleChange}
                placeholder="e.g. Empty truck returning from delivery, or dropping off packing material"
              />
              <p className="field-hint">
                What this truck is here for, since there's no vendor/material to describe it.
              </p>
            </div>
          </>
        )}
        <div className="sf-field">
          <label>Driver Photo</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Driver"
                style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", border: "1px solid #cbd5e1" }}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  background: "#f8fafc",
                  border: "1px dashed #cbd5e1",
                }}
              />
            )}
            <button
              type="button"
              className="dt-btn"
              style={{ cursor: "pointer", margin: 0 }}
              onClick={() => setShowCamera(true)}
            >
              📷 {photoPreview ? "Retake" : "Take Photo"}
            </button>
            {photoPreview && (
              <button type="button" className="dt-btn dt-btn-danger" onClick={handleClearPhoto}>
                Clear
              </button>
            )}
          </div>
          {uploadingPhoto && <p className="field-hint">Uploading photo…</p>}
          {photoUploadError && (
            <p className="field-hint" style={{ color: "#dc2626" }}>{photoUploadError}</p>
          )}
          <p className="field-hint">Optional — a quick photo of the driver for the record.</p>
        </div>
        <button className="sf-submit" type="submit" disabled={uploadingPhoto}>
          {uploadingPhoto ? "Uploading photo…" : "Generate Token"}
        </button>
      </form>

      {showCamera && (
        <CameraCapture
          onCapture={handlePhotoCaptured}
          onClose={() => setShowCamera(false)}
        />
      )}

      <h3>Entries</h3>
      <div className="section-tabs">
        {ENTRY_TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${entryTypeFilter === f.key ? "active" : ""}`}
            onClick={() => handleEntryTypeFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="section-tabs">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${statusFilter === f.key ? "active" : ""}`}
            onClick={() => handleStatusFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={entries}
        columns={[
          {
            key: "token_no",
            label: "Token No.",
            render: (row) => <span className="token-chip">{row.token_no}</span>,
          },
          {
            key: "entry_type",
            label: "Type",
            render: (row) => (
              <span className="dt-badge">
                {row.entry_type === "other"
                  ? "Empty / Misc"
                  : row.entry_type === "sales"
                  ? "Sales (Outbound)"
                  : "Purchase"}
              </span>
            ),
          },
          { key: "challan_no", label: "Challan No." },
          {
            key: "vehicle_id",
            label: "Vehicle No.",
            render: (row) => row.vehicle?.vehicle_no || vehicles.getLabel(row.vehicle_id),
          },
          {
            key: "vendor_id",
            label: "Vendor Name",
            render: (row) => row.vendor?.name || "—",
          },
          {
            key: "driver_id",
            label: "Driver Name",
            render: (row) => drivers.getLabel(row.driver_id),
          },
          {
            key: "sales_order",
            label: "Sales Order",
            render: (row) => (row.entry_type === "sales" ? salesOrders.getLabel(row.so_id) : "—"),
          },
          {
            key: "gate_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.gate_status}</span>,
          },
          {
            key: "actions2",
            label: "Gate Actions",
            render: (row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {row.gate_status === "waiting_token" && (
                  <button className="dt-btn" onClick={() => handleCheckin(row.id)}>
                    Check-in
                  </button>
                )}
                {row.entry_type === "other" &&
                  ["waiting_weighment", "in_process"].includes(row.gate_status) && (
                    <button className="dt-btn" onClick={() => handleSendToWarehouse(row.id)}>
                      Send to Warehouse
                    </button>
                  )}
                {row.entry_type === "sales" && row.gate_status === "waiting_loading" && (
                  <span className="field-hint" style={{ margin: 0 }}>
                    → Go to the Loading tab to load this truck
                  </span>
                )}
                {row.entry_type === "sales"
                  ? row.gate_status === "loaded" && (
                      <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                        Check-out
                      </button>
                    )
                  : row.gate_status !== "waiting_token" &&
                    row.gate_status !== "exited" && (
                      <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                        Check-out
                      </button>
                    )}
              </div>
            ),
          },
        ]}
      />
      <ModuleGuide
        title="Gate Entry"
        steps={[
          "Fill in the Generate Token form when a truck arrives — pick the Entry Type first. 'Purchase' is a vendor delivery (vehicle, driver, vendor, material and PO). 'Empty / Miscellaneous' is for empty trucks or non-purchase loads. 'Sales (Outbound Loading)' is an empty truck here to collect goods against a Sales Order.",
          "Submitting prints a token number for the driver, and the entry starts at status 'waiting_token'.",
          "Check-in when the truck actually enters the yard. Purchase trucks move into the sampling queue; Empty/Misc trucks move into the weighment queue; Sales trucks move into the loading queue ('waiting_loading') — each skips the stages that don't apply to it.",
          "Purchase trucks flow forward automatically from there: Quality samples and tests it, Weighbridge weighs it, then Warehouse unloads it into a Lot.",
          "Empty/Misc trucks can be weighed on the Weighbridge page if needed, then use 'Send to Warehouse' here (or on the Warehouse page) to close them out — no Lot is created since there's usually no stock to track.",
          "Sales trucks head to the Loading tab once checked in: enter the loaded quantity there, which moves the gate entry to 'loaded' and the Sales Order to 'dispatched'. Only then can the truck check out here.",
          "Use the tabs above the list to filter by truck type or by status at any stage of the journey.",
        ]}
      />
    </div>
  );
}