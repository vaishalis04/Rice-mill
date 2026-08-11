import { useState, useEffect } from "react";
import {
  getGateEntriesApi,
  generateGateTokenApi,
  gateCheckinApi,
  gateCheckoutApi,
  uploadGatePhotoApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import CameraCapture from "../../components/CameraCapture";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  vehicle_id: "",
  driver_id: "",
  vendor_id: "",
  po_id: "",
  material_id: "",
  challan_no: "",
  expected_qty: "",
  driver_photo_url: "",
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "waiting_token", label: "Waiting Token" },
  { key: "waiting_sampling", label: "Waiting Sampling" },
  { key: "sampling_done", label: "Sampling Done" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "in_process", label: "In Process (Weighed)" },
  { key: "parked", label: "Parked" },
  { key: "exited", label: "Exited" },
];

export default function GateEntryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
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

  const load = (status = statusFilter) => {
    setLoading(true);
    getGateEntriesApi(status || undefined)
      .then((res) => setEntries(res.data.data ?? res.data))
      .catch(() => setError("Failed to load gate entries"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (status) => {
    setStatusFilter(status);
    load(status);
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  // Used by EntitySelect fields — they hand back the picked row's id directly.
  const setField = (name) => (id) => setForm({ ...form, [name]: id });

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
        ...form,
        vehicle_id: Number(form.vehicle_id),
        driver_id: Number(form.driver_id),
        vendor_id: Number(form.vendor_id),
        po_id: Number(form.po_id),
        material_id: Number(form.material_id),
        expected_qty: Number(form.expected_qty),
      };
      const res = await generateGateTokenApi(payload);
      const tokenNo = res.data.token_no ?? res.data.data?.token_no;
      setLastToken(tokenNo || "");
      setInfo(
        tokenNo
          ? "Token generated — give this number to the driver."
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
        Fill this in when a truck arrives at the gate. It records who's arriving and what
        they're delivering, and prints a token number for the driver to keep.
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
        <div>
          <EntitySelect
            entity="vendor"
            label="Vendor"
            value={form.vendor_id}
            onChange={setField("vendor_id")}
            required
            creatable
          />
          <p className="field-hint">Who is supplying this load of grain.</p>
        </div>
        <div>
          <EntitySelect
            entity="material"
            label="Material"
            value={form.material_id}
            onChange={setField("material_id")}
            required
            creatable
          />
          <p className="field-hint">What's being delivered, e.g. Paddy.</p>
        </div>
        <div>
          <EntitySelect
            entity="purchase_order"
            label="Purchase Order"
            value={form.po_id}
            onChange={setField("po_id")}
            required
            creatable
            context={{ vendor_id: form.vendor_id, material_id: form.material_id }}
          />
          <p className="field-hint">The agreed rate/quantity for this delivery.</p>
        </div>
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
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${statusFilter === f.key ? "active" : ""}`}
            onClick={() => handleFilterChange(f.key)}
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
            key: "gate_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.gate_status}</span>,
          },
          {
            key: "actions2",
            label: "Gate Actions",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                {row.gate_status === "waiting_token" && (
                  <button className="dt-btn" onClick={() => handleCheckin(row.id)}>
                    Check-in
                  </button>
                )}
                {row.gate_status !== "waiting_token" && row.gate_status !== "exited" && (
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
          "Fill in the Generate Token form when a truck arrives — vehicle, driver, vendor, material and PO. Anything not already registered can be added on the spot with '+ Add new'.",
          "Submitting prints a token number for the driver, and the entry starts at status 'waiting_token'.",
          "Check-in when the truck actually enters the yard — this moves it into the sampling queue. Check-out is available any time after that, for whenever the truck physically leaves the premises (it doesn't have to wait for the full journey to finish).",
          "From here the entry flows forward automatically: Quality samples and tests it, Weighbridge weighs it, then Warehouse unloads it into a Lot.",
          "Use the status tabs above the list to see entries at any stage of that journey.",
        ]}
      />
    </div>
  );
}