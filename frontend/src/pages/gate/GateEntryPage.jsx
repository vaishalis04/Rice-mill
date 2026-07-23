import { useState, useEffect } from "react";
import {
  getGateEntriesApi,
  generateGateTokenApi,
  gateCheckinApi,
  gateCheckoutApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
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
  { key: "checked_in", label: "Checked In" },
  { key: "parked", label: "Parked" },
  { key: "checked_out", label: "Checked Out" },
  { key: "waiting_sampling", label: "Waiting Sampling" },
  { key: "sampling_done", label: "Sampling Done" },
  { key: "lab_accepted", label: "Lab Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "accepted", label: "Accepted" },
  { key: "in_process", label: "In Process (Weighed)" },
  { key: "unloaded", label: "Unloaded" },
];

export default function GateEntryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

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

  const handleGenerateToken = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
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
      setInfo(`Token generated: ${tokenNo || "(check response)"}`);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to generate token");
    }
  };

  const handleCheckin = async (id) => {
    setError("");
    try {
      await gateCheckinApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Check-in failed");
    }
  };

  const handleCheckout = async (id) => {
    setError("");
    try {
      await gateCheckoutApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Check-out failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Gate Entry</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <h3>Generate Token</h3>
      <form className="sf-form" onSubmit={handleGenerateToken}>
        <EntitySelect
          entity="vehicle"
          label="Vehicle"
          value={form.vehicle_id}
          onChange={setField("vehicle_id")}
          required
          creatable
        />
        <EntitySelect
          entity="driver"
          label="Driver"
          value={form.driver_id}
          onChange={setField("driver_id")}
          required
          creatable
        />
        <EntitySelect
          entity="vendor"
          label="Vendor"
          value={form.vendor_id}
          onChange={setField("vendor_id")}
          required
          creatable
        />
        <EntitySelect
          entity="material"
          label="Material"
          value={form.material_id}
          onChange={setField("material_id")}
          required
          creatable
        />
        <EntitySelect
          entity="purchase_order"
          label="Purchase Order"
          value={form.po_id}
          onChange={setField("po_id")}
          required
          creatable
          context={{ vendor_id: form.vendor_id, material_id: form.material_id }}
        />
        <div className="sf-field">
          <label>Challan No.</label>
          <input
            name="challan_no"
            value={form.challan_no}
            onChange={handleChange}
            required
          />
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
        </div>
        <div className="sf-field">
          <label>Driver Photo URL</label>
          <input
            name="driver_photo_url"
            value={form.driver_photo_url}
            onChange={handleChange}
          />
        </div>
        <button className="sf-submit" type="submit">
          Generate Token
        </button>
      </form>

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
          { key: "token_no", label: "Token No." },
          { key: "challan_no", label: "Challan No." },
          {
            key: "vehicle_id",
            label: "Vehicle",
            render: (row) => vehicles.getLabel(row.vehicle_id),
          },
          {
            key: "driver_id",
            label: "Driver",
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
                {row.gate_status === "checked_in" && (
                  <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                    Check-out
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
