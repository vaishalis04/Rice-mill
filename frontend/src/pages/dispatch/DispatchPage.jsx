import { useState, useEffect } from "react";
import {
  getDispatchesApi,
  createDispatchApi,
  updateDispatchApi,
  getDispatchChallanPdfApi,
  getFinishedGoodsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  so_id: "",
  vehicle_id: "",
  driver_id: "",
  dispatch_weight: "", // optional — defaults to sum of allocated FG qty
  dispatch_type: "", // doc only names "direct_outward" as an example value
};

export default function DispatchPage() {
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Ready finished goods available to allocate — a plain multi-select
  // checklist since EntitySelect only picks one id at a time.
  const [readyFg, setReadyFg] = useState([]);
  const [fgLoading, setFgLoading] = useState(true);
  const [selectedFgIds, setSelectedFgIds] = useState([]);

  const salesOrders = useEntityLookup("sales_order");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");

  const load = () => {
    setLoading(true);
    getDispatchesApi()
      .then((res) => setDispatches(res.data.data ?? res.data))
      .catch(() => setError("Failed to load dispatches"))
      .finally(() => setLoading(false));
  };

  const loadReadyFg = () => {
    setFgLoading(true);
    getFinishedGoodsApi({ status: "ready" })
      .then((res) => setReadyFg(res.data.data ?? res.data))
      .catch(() => setError("Failed to load ready finished goods"))
      .finally(() => setFgLoading(false));
  };

  useEffect(() => {
    load();
    loadReadyFg();
  }, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const toggleFg = (id) =>
    setSelectedFgIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (selectedFgIds.length === 0) {
      setError("Pick at least one ready Finished Goods record to allocate");
      return;
    }
    try {
      const payload = {
        so_id: Number(form.so_id),
        vehicle_id: Number(form.vehicle_id),
        driver_id: Number(form.driver_id),
        finished_goods_ids: selectedFgIds,
      };
      if (form.dispatch_weight !== "") payload.dispatch_weight = Number(form.dispatch_weight);
      if (form.dispatch_type) payload.dispatch_type = form.dispatch_type;

      const res = await createDispatchApi(payload);
      const created = res.data.data ?? res.data;
      setInfo(
        `Dispatch created${created?.challan_no ? ` — challan ${created.challan_no}` : ""}. ` +
          "Allocated FG rows are now dispatched and the sales order is marked dispatched."
      );
      setForm(emptyForm);
      setSelectedFgIds([]);
      load();
      loadReadyFg();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleMarkDelivered = async (id) => {
    setError("");
    try {
      await updateDispatchApi(id, { dispatch_status: "delivered" });
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  const handleDownloadChallan = async (row) => {
    setError("");
    try {
      const res = await getDispatchChallanPdfApi(row.id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.challan_no || `challan-${row.id}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download the challan PDF");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dispatch</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="sales_order"
          label="Sales Order"
          value={form.so_id}
          onChange={(id) => setForm({ ...form, so_id: id })}
          filter={(row) => row.so_status === "confirmed"}
          required
        />
        <EntitySelect
          entity="vehicle"
          label="Vehicle"
          value={form.vehicle_id}
          onChange={(id) => setForm({ ...form, vehicle_id: id })}
          required
          creatable
        />
        <EntitySelect
          entity="driver"
          label="Driver"
          value={form.driver_id}
          onChange={(id) => setForm({ ...form, driver_id: id })}
          required
          creatable
        />
        <div className="sf-field">
          <label>Dispatch Weight (optional — defaults to sum of allocated FG)</label>
          <input
            name="dispatch_weight"
            type="number"
            value={form.dispatch_weight}
            onChange={handleChange}
          />
        </div>
        <div className="sf-field">
          <label>Dispatch Type (optional)</label>
          <input
            name="dispatch_type"
            value={form.dispatch_type}
            onChange={handleChange}
            placeholder="e.g. direct_outward"
          />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 6 }}>
            Allocate Ready Finished Goods
          </label>
          {fgLoading && <p className="dt-msg">Loading…</p>}
          {!fgLoading && readyFg.length === 0 && (
            <p className="dt-msg">No finished goods are currently ready to dispatch.</p>
          )}
          {!fgLoading && readyFg.length > 0 && (
            <div
              className="dt-wrapper"
              style={{ maxHeight: 180, overflowY: "auto", padding: 10 }}
            >
              {readyFg.map((fg) => (
                <label
                  key={fg.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFgIds.includes(fg.id)}
                    onChange={() => toggleFg(fg.id)}
                  />
                  FG #{fg.id} — {fg.qty}kg ({fg.pack_size}) · warehouse #{fg.warehouse_id}
                </label>
              ))}
            </div>
          )}
        </div>

        <button className="sf-submit" type="submit" style={{ gridColumn: "1 / -1" }}>
          Create Dispatch
        </button>
      </form>

      <DataTable
        loading={loading}
        rows={dispatches}
        columns={[
          { key: "challan_no", label: "Challan No." },
          {
            key: "so_id",
            label: "Sales Order",
            render: (row) => salesOrders.getLabel(row.so_id),
          },
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
          { key: "dispatch_weight", label: "Weight" },
          {
            key: "dispatch_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.dispatch_status}</span>,
          },
          {
            key: "actions2",
            label: "",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="dt-btn" onClick={() => handleDownloadChallan(row)}>
                  Download Challan
                </button>
                {row.dispatch_status !== "delivered" && (
                  <button className="dt-btn" onClick={() => handleMarkDelivered(row.id)}>
                    Mark Delivered
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
