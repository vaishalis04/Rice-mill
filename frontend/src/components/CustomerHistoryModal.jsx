import { useState, useEffect } from "react";
import { getCustomerHistoryApi } from "../api/api";
import DataTable from "./DataTable";

/**
 * <CustomerHistoryModal customerId={5} onClose={() => ...} />
 * Fetches GET /customers/:id/history and shows address/GSTIN/credit-limit
 * plus every sales order and dispatch for that customer. Used from both
 * CustomersPage (Sales/Admin) and DispatchPage so "who did we sell to, how
 * much, and when" is always one click away.
 */
export default function CustomerHistoryModal({ customerId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getCustomerHistoryApi(customerId)
      .then((res) => setData(res.data.data ?? res.data))
      .catch((err) =>
        setError(err.response?.data?.message || "Failed to load customer history")
      )
      .finally(() => setLoading(false));
  }, [customerId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        zIndex: 1000,
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 24,
          maxWidth: 900,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Customer Profile</h2>
          <button className="dt-btn" onClick={onClose}>Close</button>
        </div>

        {loading && <p className="dt-msg">Loading...</p>}
        {error && <div className="dt-error">{error}</div>}

        {data && (
          <>
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f7f8fa",
                borderRadius: 8,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Name</div>
                <div style={{ fontWeight: 600 }}>{data.customer.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Customer Code</div>
                <div>{data.customer.customer_code}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>GSTIN</div>
                <div>{data.customer.gstin || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Address</div>
                <div>{data.customer.address || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Type</div>
                <div>{data.customer.customer_type}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Credit Limit</div>
                <div>{data.customer.credit_limit ?? "—"}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              <div className="dt-badge">Orders: {data.summary.orderCount}</div>
              <div className="dt-badge">Dispatches: {data.summary.dispatchCount}</div>
              <div className="dt-badge">Total Ordered: {data.summary.totalOrderedQty}</div>
              <div className="dt-badge">Total Dispatched: {data.summary.totalDispatchedQty}</div>
            </div>

            <h3 style={{ marginTop: 24 }}>Order History</h3>
            <DataTable
              rows={data.salesOrders}
              columns={[
                { key: "so_no", label: "SO No." },
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) => row.material?.name || "—",
                },
                { key: "qty", label: "Qty" },
                { key: "rate", label: "Rate" },
                { key: "order_date", label: "Order Date" },
                {
                  key: "so_status",
                  label: "Status",
                  render: (row) => <span className="dt-badge">{row.so_status}</span>,
                },
              ]}
            />

            <h3 style={{ marginTop: 24 }}>Dispatch History</h3>
            <DataTable
              rows={data.dispatches}
              columns={[
                { key: "challan_no", label: "Challan No." },
                {
                  key: "so_id",
                  label: "Sales Order",
                  render: (row) => row.salesOrder?.so_no || "—",
                },
                {
                  key: "vehicle_id",
                  label: "Vehicle",
                  render: (row) => row.vehicle?.vehicle_no || "—",
                },
                {
                  key: "driver_id",
                  label: "Driver",
                  render: (row) => row.driver?.name || "—",
                },
                { key: "dispatch_weight", label: "Weight" },
                {
                  key: "dispatch_status",
                  label: "Status",
                  render: (row) => <span className="dt-badge">{row.dispatch_status}</span>,
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}