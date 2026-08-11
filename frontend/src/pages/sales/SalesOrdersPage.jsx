import { useState, useEffect } from "react";
import {
  getSalesOrdersApi,
  createSalesOrderApi,
  updateSalesOrderApi,
  deleteSalesOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// The doc only confirms "fg" as an order_type value — kept as free text
// (defaulting to "fg") rather than guessing a full enum.
const emptyForm = {
  customer_id: "",
  order_type: "fg",
  material_id: "",
  qty: "",
  rate: "",
  order_date: "",
};

// Confirmed from the doc: "confirmed" (on create) and "dispatched" (after
// dispatch). "closed"/"cancelled" are named in the KPI description
// ("not yet dispatched/closed/cancelled") so included as filter options too.
const STATUS_FILTERS = ["", "confirmed", "dispatched", "closed", "cancelled"];

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const customers = useEntityLookup("customer");
  const materials = useEntityLookup("material");

  const load = (so_status = statusFilter) => {
    setLoading(true);
    const params = {};
    if (so_status) params.so_status = so_status;
    getSalesOrdersApi(params)
      .then((res) => setOrders(res.data.data ?? res.data))
      .catch(() => setError("Failed to load sales orders"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {
        customer_id: Number(form.customer_id),
        order_type: form.order_type,
        material_id: Number(form.material_id),
        qty: Number(form.qty),
        rate: Number(form.rate),
      };
      if (form.order_date) payload.order_date = form.order_date;

      const res = await createSalesOrderApi(payload);
      const created = res.data.data ?? res.data;
      setInfo(
        `Sales order created${created?.so_no ? ` (${created.so_no})` : ""} — status: ${
          created?.so_status || "confirmed"
        }.`
      );
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this sales order?")) return;
    try {
      await deleteSalesOrderApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRateEdit = async (row) => {
    const newRate = window.prompt("New rate:", row.rate);
    if (newRate == null || newRate === "") return;
    try {
      await updateSalesOrderApi(row.id, { rate: Number(newRate) });
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  // Cancel/Close were previously unreachable from the UI — the backend has
  // always supported these statuses via PUT, nothing ever called it with
  // them. Cancel only makes sense before goods have moved (pending/confirmed);
  // Close is a manual "this order is fully settled" step taken after dispatch.
  const handleStatusChange = async (row, newStatus) => {
    const verb = newStatus === "cancelled" ? "cancel" : "close";
    if (!window.confirm(`Are you sure you want to ${verb} ${row.so_no}?`)) return;
    setError("");
    try {
      await updateSalesOrderApi(row.id, { so_status: newStatus });
      setInfo(`${row.so_no} marked ${newStatus}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to mark order ${newStatus}`);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Sales Orders</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="customer"
          label="Customer"
          value={form.customer_id}
          onChange={(id) => setForm({ ...form, customer_id: id })}
          required
          creatable
        />
        <div className="sf-field">
          <label>Order Type</label>
          <input
            name="order_type"
            value={form.order_type}
            onChange={handleChange}
            placeholder="fg"
            required
          />
        </div>
        <EntitySelect
          entity="material"
          label="Material"
          value={form.material_id}
          onChange={(id) => setForm({ ...form, material_id: id })}
          required
          creatable
        />
        <div className="sf-field">
          <label>Qty</label>
          <input
            name="qty"
            type="number"
            value={form.qty}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Rate</label>
          <input
            name="rate"
            type="number"
            step="0.01"
            value={form.rate}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Order Date</label>
          <input
            name="order_date"
            type="date"
            value={form.order_date}
            onChange={handleChange}
          />
        </div>
        <button className="sf-submit" type="submit">
          Create Sales Order
        </button>
      </form>

      <div className="section-tabs">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={`section-tab ${statusFilter === s ? "active" : ""}`}
            onClick={() => {
              setStatusFilter(s);
              load(s);
            }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={orders}
        onDelete={handleDelete}
        columns={[
          { key: "so_no", label: "SO No." },
          {
            key: "customer_id",
            label: "Customer",
            render: (row) => customers.getLabel(row.customer_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => materials.getLabel(row.material_id),
          },
          { key: "qty", label: "Qty" },
          {
            key: "rate",
            label: "Rate",
            render: (row) => (
              <button className="dt-btn" onClick={() => handleRateEdit(row)}>
                ₹{row.rate}
              </button>
            ),
          },
          {
            key: "so_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.so_status}</span>,
          },
          {
            key: "lifecycle_actions",
            label: "",
            render: (row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["pending", "confirmed"].includes(row.so_status) && (
                  <button className="dt-btn" onClick={() => handleStatusChange(row, "cancelled")}>
                    Cancel
                  </button>
                )}
                {row.so_status === "dispatched" && (
                  <button className="dt-btn" onClick={() => handleStatusChange(row, "closed")}>
                    Close
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