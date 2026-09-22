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
import VisitorSection from "./VisitorSection";
import "./GateEntry.css";

// The Gate only ever captures these three things now. Entry Type, the
// PO/SO to attach, Challan No. and Expected Qty all moved to
// Admin > Gate Entry — see GateEntryAdminPage.jsx — which is where the
// token actually gets its details and becomes ready for check-in.
const emptyForm = {
  vehicle_id: "",
  driver_id: "",
  driver_photo_url: "",
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "pending_details", label: "Waiting on Admin" },
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
  { key: "parked", label: "parked" },
  { key: "exited", label: "Exited" },
];

const ENTRY_TYPE_FILTERS = [
  { key: "", label: "All Trucks" },
  { key: "pending", label: "Not Yet Classified" },
  { key: "purchase", label: "Purchase Trucks" },
  { key: "other", label: "Empty / Misc Trucks" },
  { key: "sales", label: "Sales (Outbound) Trucks" },
];

export default function GateEntryPage({ prefillSoId, onPrefillConsumed } = {}) {
  const [pageMode, setPageMode] = useState("trucks"); // "trucks" | "visitor"
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const vendors = useEntityLookup("vendor");
  const salesOrders = useEntityLookup("sales_order");

  // prefillSoId is used by the Sales module to jump straight to a
  // sales-order picker on this page — that PO/SO picking now happens on
  // Admin > Gate Entry instead, so this prop is no longer relevant here.
  // Kept as a no-op so callers passing it don't break.
  useEffect(() => {
    if (prefillSoId && onPrefillConsumed) onPrefillConsumed();
  }, [prefillSoId]);

  const load = (status = statusFilter, entryType = entryTypeFilter) => {
    setLoading(true);
    getGateEntriesApi(status || undefined, entryType || undefined)
      .then((res) => setEntries(res.data.data ?? res.data))
      .catch(() => setError("Failed to load gate entries"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const handleStatusFilterChange = (status) => {
    setStatusFilter(status);
    load(status, entryTypeFilter);
  };

  const handleEntryTypeFilterChange = (entryType) => {
    setEntryTypeFilter(entryType);
    load(statusFilter, entryType);
  };

  const setField = (name) => (id) => setForm({ ...form, [name]: id });

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
    if (!form.vehicle_id) {
      setError("Please select a vehicle.");
      return;
    }
    if (!form.driver_id) {
      setError("Please select a driver.");
      return;
    }

    try {
      const payload = {
        vehicle_id: Number(form.vehicle_id),
        driver_id: Number(form.driver_id),
        driver_photo_url: form.driver_photo_url,
      };

      const res = await generateGateTokenApi(payload);
      const generatedEntry = res.data.data;
      const tokenNo = res.data.token_no ?? generatedEntry?.token_no;

      setLastToken(tokenNo || "");
      setInfo(
        tokenNo
          ? "Token generated — give this number to the driver, then click Check-in below once the truck is physically at the gate."
          : "Entry saved (check the list below for the token number)."
      );

      setForm(emptyForm);
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

      <div className="section-tabs" style={{ marginBottom: 16 }}>
        <button
          className={`section-tab ${pageMode === "trucks" ? "active" : ""}`}
          onClick={() => setPageMode("trucks")}
        >
          🚛 Trucks (Purchase / Sales / Empty)
        </button>
        <button
          className={`section-tab ${pageMode === "visitor" ? "active" : ""}`}
          onClick={() => setPageMode("visitor")}
        >
          👤 Visitor
        </button>
      </div>

      <div style={{ display: pageMode === "trucks" ? "block" : "none" }}>
        <h3 style={{ marginBottom: 4 }}>Generate Token</h3>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Fill this in when a truck arrives at the gate — just the vehicle, the driver
          and (optionally) a quick photo of the driver. This prints a token for the
          driver right away. Once the truck is physically at the gate, click
          <strong> Check-in</strong> on it in the list below — it then shows up for
          Admin to classify (Purchase / Sales / Empty) and attach the approved
          Purchase Order or Sales Order on the Admin &gt; Gate Entry tab.
        </p>

        <form className="sf-form" onSubmit={handleGenerateToken}>
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
                  {row.entry_type === "pending"
                    ? "Not yet classified"
                    : row.entry_type === "other"
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
              render: (row) => row.vendor?.name || (row.vendor_id ? vendors.getLabel(row.vendor_id) : "—"),
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
              render: (row) =>
                row.gate_status === "pending_details" ? (
                  <span className="dt-badge" style={{ background: "#fef3c7", color: "#92400e" }}>
                    Waiting on Admin
                  </span>
                ) : (
                  <span className="dt-badge">{row.gate_status}</span>
                ),
            },
            {
              key: "actions2",
              label: "Gate Actions",
              render: (row) => (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {row.gate_status === "pending_details" && (
                    <span className="field-hint" style={{ margin: 0 }}>
                      → Waiting for Admin to attach details (Admin &gt; Gate Entry)
                    </span>
                  )}
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
                    ? row.gate_status === "parked" && (
                        <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                          Check-out
                        </button>
                      )
                    : row.gate_status !== "waiting_token" &&
                      row.gate_status !== "pending_details" &&
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
            "Fill in the Generate Token form when a truck arrives — just Vehicle, Driver and (optionally) a Driver Photo.",
            "Submitting prints a token number for the driver and puts the entry at 'Waiting Token' — it isn't classified as Purchase / Sales / Empty yet.",
            "Click Check-in on that entry as soon as the truck is physically at the gate. This moves it to 'Waiting on Admin' — its journey doesn't continue any further until Admin classifies it.",
            "Admin now goes to Admin > Gate Entry, picks the Entry Type, and attaches the approved Purchase Order or Sales Order (with materials, Challan No. and Expected Qty) — or, for Empty/Misc trucks, logs what items came in and where they were stored.",
            "That Admin step is what actually routes the truck onward: Purchase trucks move into the sampling queue; Empty/Misc and Sales trucks move into the weighment queue.",
            "Purchase trucks flow forward automatically from there: Quality samples and tests it, Weighbridge weighs it, then Warehouse unloads it into a Lot.",
            "Empty/Misc trucks can be weighed on the Weighbridge page if needed, then use 'Send to Warehouse' here (or on the Warehouse page) to close them out — no Lot is created since there's usually no stock to track.",
            "Sales trucks are weighed too, then head to the Loading tab: enter the loaded quantity there, which moves the gate entry to 'loaded' and the Sales Order to 'dispatched'. Only then can the truck check out here.",
            "Use the tabs above the list to filter by truck type or by status at any stage of the journey.",
          ]}
        />
      </div>

      {pageMode === "visitor" && <VisitorSection />}
    </div>
  );
}