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

const emptyForm = {
  entry_type: "purchase",
  vehicle_id: "",
  driver_id: "",
  vendor_id: "",
  po_id: "",
  material_id: "",
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

// Which flow the truck belongs to — filters the list independently of
// gate_status. "other" = empty trucks / trucks with miscellaneous items,
// which skip Sampling/Lab/Negotiation entirely. "sales" = outbound trucks
// arriving empty to be loaded against a Sales Order (see ModuleGuide below).
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
  // The full grouped PO object (po_no + all its material line items) once
  // one's been picked — used to resolve which SPECIFIC line item (po_id)
  // matches whichever material the truck actually ends up delivering, and
  // to constrain the Material field's choices to only what's on this PO.
  const [poGroup, setPoGroup] = useState(null);
  // The full grouped Sales Order object (so_no + all its material line
  // items) once one's been picked — same idea as poGroup above. Lets the
  // "materials on this Sales Order" box below show EVERY material the SO
  // covers, and (when there's more than one) resolves which SPECIFIC line
  // item (so_id) matches whichever material this truck is collecting.
  const [soGroup, setSoGroup] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  // The captured image is shown locally (photoPreview) the instant it's
  // taken, while it uploads in the background; form.driver_photo_url only
  // gets set once the server confirms and hands back a real URL — that's
  // the only thing that ever gets submitted with the gate entry.
  const [photoPreview, setPhotoPreview] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  // Used to auto-fill Vendor/Material the moment a PO is picked below — a
  // PO always belongs to exactly one vendor + one material, so there's no
  // reason to make the person pick those separately once they've chosen
  // the PO that already pins them down.
  const purchaseOrders = useEntityLookup("purchase_order");
  // Used to auto-fill Customer/Material the moment a Sales Order is picked
  // for a sales (outbound loading) entry — flat, one row per material line,
  // used for labels/details of a SPECIFIC line item (so_id).
  const salesOrders = useEntityLookup("sales_order");
  // Grouped, one option per so_no with every material it covers nested
  // under `items` — used for the Sales Order picker itself, so a
  // multi-material SO reads as ONE order (see soGroup above).
  const salesOrderGroups = useEntityLookup("sales_order_grouped");

  // "Load New Truck for Remaining Qty" on the Loading tab jumps here with a
  // Sales Order id already known — pre-select it and switch to the Sales
  // entry type so the operator only has to pick the next Vehicle/Driver.
  useEffect(() => {
    if (!prefillSoId) return;
    setForm((prev) => ({ ...emptyForm, entry_type: "sales", so_id: prefillSoId }));
    setPoGroup(null);
    setSoGroup(null);
    if (onPrefillConsumed) onPrefillConsumed();
  }, [prefillSoId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Used by EntitySelect fields — they hand back the picked row's id directly.
  const setField = (name) => (id) => setForm({ ...form, [name]: id });

  // Picking a PO pins down its vendor too — auto-fill it so the person
  // isn't asked to pick something the PO already answers (they can still
  // override afterward). If the PO covers just one material, auto-fill
  // that too. If it covers several, leave Material for the person to pick
  // explicitly (constrained to just this PO's materials, see the Material
  // field below) — the exact po_id line item is resolved once they do.
  const handlePoChange = (po_id) => {
    const po = purchaseOrders.rows.find((r) => String(r.id) === String(po_id));
    setPoGroup(po || null);
    // Use grouped PO id so a single gate entry represents the whole PO
    setForm((prev) => ({
      ...prev,
      po_id: po ? po.id : po_id,
      vendor_id: po ? po.vendor_id : prev.vendor_id,
      material_id: po && Array.isArray(po.items) && po.items[0] ? po.items[0].material_id : "",
    }));
  };

  // Picking a Sales Order shows every material it covers (soGroup below).
  // If it covers just one material, auto-select that line item's id as
  // so_id — nothing else to pick. If it covers several, leave Material for
  // the person to pick explicitly (constrained to just this SO's materials,
  // see the Material field below) — the exact so_id line item is resolved
  // once they do, same pattern as handlePoChange above.
  const handleSoChange = (so_id) => {
    const so = salesOrderGroups.rows.find((r) => String(r.id) === String(so_id));
    setSoGroup(so || null);
    // Use grouped SO id so a single gate entry represents the whole Sales Order
    setForm((prev) => ({
      ...prev,
      so_id: so ? so.id : so_id,
      material_id: so && Array.isArray(so.items) && so.items[0] ? so.items[0].material_id : "",
    }));
    salesOrders.refetch();
  };
  

  const handleEntryTypeChange = (e) => {
    const entry_type = e.target.value;
    // Switching away from "purchase" drops vendor/PO/material/qty so a
    // half-filled purchase field doesn't silently get submitted with an
    // empty/misc entry, and vice versa.
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

  // Fired by <CameraCapture> once a frame is snapped (or a fallback file is
  // picked, if the camera itself couldn't be opened). We show it locally
  // right away, then upload it — driver_photo_url only gets set once that
  // upload actually succeeds and the backend hands back a short URL.
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
    if (uploadingPhoto) {
      setError("The driver photo is still uploading — wait a moment and try again.");
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
        payload.vendor_id = Number(form.vendor_id);
        // send grouped PO id so one gate entry represents the whole PO
        payload.po_id = form.po_id ? Number(form.po_id) : undefined;
        if (form.material_id) payload.material_id = Number(form.material_id);
        payload.challan_no = form.challan_no;
        payload.expected_qty = form.expected_qty ? Number(form.expected_qty) : undefined;
      } else if (form.entry_type === "sales") {
        // send grouped Sales Order id so one gate entry represents the whole SO
        payload.so_id = Number(form.so_id);
        payload.challan_no = form.challan_no || undefined;
        payload.expected_qty = form.expected_qty ? Number(form.expected_qty) : undefined;
      } else {
        payload.challan_no = form.challan_no || undefined;
        payload.remarks = form.remarks;
      }

      const res = await generateGateTokenApi(payload);
      const tokenNo = res.data.token_no ?? res.data.data?.token_no;
      setLastToken(tokenNo || "");
      setInfo(
        tokenNo
          ? "Token generated — give this number to the driver."
          : "Entry saved (check the list below for the token number)."
      );
      setForm(emptyForm);
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
            <div>
              <EntitySelect
                entity="purchase_order"
                label="Purchase Order"
                value={form.po_id}
                onChange={handlePoChange}
                required
              />
              <p className="field-hint">
                Picking a Purchase Order shows every material it covers below and fills in the
                Vendor automatically. The gate entry will represent the whole Purchase Order
                (all materials) for this vehicle.
              </p>
            </div>
            {/* Material selection removed — gate entry represents the whole PO */}
            {poGroup && (
              <div className="sf-field">
                <label>Materials on this Purchase Order</label>
                <div
                  style={{
                    padding: "8px 10px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong>Vendor:</strong> {poGroup.vendor?.name || "—"}
                  </div>
                  {poGroup.items.map((i, idx) => {
                    const isThisTruck = String(i.id) === String(form.po_id);
                    return (
                      <div
                        key={i.id}
                        style={{
                          marginTop: idx === 0 ? 0 : 6,
                          paddingTop: idx === 0 ? 0 : 6,
                          borderTop: idx === 0 ? "none" : "1px dashed #e2e8f0",
                          color: isThisTruck ? "#1d4ed8" : undefined,
                        }}
                      >
                        <strong>{i.material?.name || "—"}</strong>
                        {i.variety?.variety_name ? ` (${i.variety.variety_name})` : ""} — Ordered {i.qty} @ ₹{i.rate}
                        {isThisTruck ? " ← this truck" : ""}
                      </div>
                    );
                  })}
                </div>
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
              <p className="field-hint">The delivery-note number the driver brought with them.</p>
            </div>
            <div className="sf-field">
              <label>Expected Qty</label>
              <input
                name="expected_qty"
                type="number"
                value={form.expected_qty}
                onChange={handleChange}
                required
              />
              <p className="field-hint">How much grain the vendor says is on the truck (kg).</p>
            </div>
          </>
        )}
        {isSales && (
          <>
            <div>
              <EntitySelect
                entity="sales_order_grouped"
                label="Sales Order"
                value={form.so_id}
                onChange={handleSoChange}
                filter={(row) =>
                  Array.isArray(row.items) &&
                  row.items.some((i) => !["dispatched", "closed", "cancelled"].includes(i.so_status))
                }
                required
              />
              <p className="field-hint">
                Picking a Sales Order shows every material it covers below and fills in the
                Customer automatically. The gate entry will represent the whole Sales Order
                (all materials) for this vehicle; the actual loaded quantity is entered later on
                the Loading tab when the truck is loaded.
              </p>
            </div>
            {/* Material selection removed — gate entry represents the whole Sales Order */}
            {soGroup && (
              <div className="sf-field">
                <label>Materials on this Sales Order</label>
                <div
                  style={{
                    padding: "8px 10px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong>Customer:</strong> {soGroup.customer?.name || "—"}
                  </div>
                  {soGroup.items.map((i, idx) => {
                    const remaining = Math.round((Number(i.qty || 0) - Number(i.dispatched_qty || 0)) * 100) / 100;
                    const isThisTruck = String(i.id) === String(form.so_id);
                    return (
                      <div
                        key={i.id}
                        style={{
                          marginTop: idx === 0 ? 0 : 6,
                          paddingTop: idx === 0 ? 0 : 6,
                          borderTop: idx === 0 ? "none" : "1px dashed #e2e8f0",
                          color: isThisTruck ? "#1d4ed8" : undefined,
                        }}
                      >
                        <strong>{i.material?.name || "—"}</strong> — Ordered {i.qty}, Remaining {remaining}
                        {isThisTruck ? " ← this truck" : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
              <label>Planned Loading Qty (optional)</label>
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
            render: (row) => vehicles.getLabel(row.vehicle_id),
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