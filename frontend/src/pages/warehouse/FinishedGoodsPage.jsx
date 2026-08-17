import { useState, useEffect } from "react";
import {
  getFinishedGoodsApi,
  updateFinishedGoodApi,
  deleteFinishedGoodApi,
  flagAgingApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// "ready" and "aging" are confirmed by the API docs; "dispatched" and
// "hold" are named in prose ("dispatch, hold, or reset to ready") but not
// given as an exact enum — if your backend uses different casing/wording,
// tell me and I'll adjust this list.
const STATUS_OPTIONS = ["", "ready", "dispatched", "hold", "aging"];

export default function FinishedGoodsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [packSizeFilter, setPackSizeFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  const packings = useEntityLookup("packing");
  const warehouses = useEntityLookup("warehouse");

  const load = (overrides = {}) => {
    const f = {
      status: statusFilter,
      pack_size: packSizeFilter,
      warehouse_id: warehouseFilter,
      from: fromFilter,
      to: toFilter,
      ...overrides,
    };
    setLoading(true);
    const params = {};
    if (f.status) params.status = f.status;
    if (f.pack_size) params.pack_size = f.pack_size;
    if (f.warehouse_id) params.warehouse_id = f.warehouse_id;
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    getFinishedGoodsApi(params)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load finished goods"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (id, fg_status) => {
    setError("");
    setInfo("");
    try {
      await updateFinishedGoodApi(id, { fg_status });
      setInfo(
        fg_status === "ready"
          ? "Status reset to ready — aging clock restarted."
          : `Status updated to ${fg_status}.`
      );
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Status update failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this finished goods record?")) return;
    try {
      await deleteFinishedGoodApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRunAging = async () => {
    setError("");
    setInfo("");
    try {
      const res = await flagAgingApi();
      const body = res.data.data ?? res.data;
      const flagged = body?.flagged ?? body?.count ?? body?.updated;
      setInfo(
        flagged != null
          ? `Aging sweep ran — ${flagged} record(s) flagged as aging.`
          : "Aging sweep ran."
      );
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Aging sweep failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>Finished Goods</h2>
        <button className="dt-btn" onClick={handleRunAging}>
          Run Aging Sweep
        </button>
      </div>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
        <div className="sf-field">
          <label>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              load({ status: e.target.value });
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "All"}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-field">
          <label>Pack Size (kg)</label>
          <input
            type="number"
            step="0.01"
            placeholder="e.g. 25 — leave blank for all"
            value={packSizeFilter}
            onChange={(e) => setPackSizeFilter(e.target.value)}
            onBlur={(e) => load({ pack_size: e.target.value })}
          />
        </div>
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={warehouseFilter}
          onChange={(id) => {
            setWarehouseFilter(id);
            load({ warehouse_id: id });
          }}
        />
        <div className="sf-field">
          <label>From</label>
          <input
            type="date"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
            onBlur={() => load()}
          />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input
            type="date"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
            onBlur={() => load()}
          />
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={rows}
        onDelete={handleDelete}
        columns={[
          {
            key: "packing_id",
            label: "Packing",
            render: (row) => packings.getLabel(row.packing_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) => warehouses.getLabel(row.warehouse_id),
          },
          { key: "qty", label: "Qty" },
          { key: "pack_size", label: "Pack Size" },
          { key: "rack_id", label: "Rack" },
          {
            key: "fg_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.fg_status}</span>,
          },
          {
            key: "aged_days",
            label: "Aged (days)",
            render: (row) => (
              <span className={row.aged_days > 30 ? "dt-badge dt-badge-danger" : "dt-badge"}>
                {row.aged_days}
              </span>
            ),
          },
          {
            key: "status_actions",
            label: "Actions",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                {row.fg_status !== "dispatched" && (
                  <button className="dt-btn" onClick={() => handleStatusChange(row.id, "dispatched")}>
                    Dispatch
                  </button>
                )}
                {row.fg_status !== "hold" && (
                  <button className="dt-btn" onClick={() => handleStatusChange(row.id, "hold")}>
                    Hold
                  </button>
                )}
                {row.fg_status !== "ready" && (
                  <button className="dt-btn" onClick={() => handleStatusChange(row.id, "ready")}>
                    Reset to Ready
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