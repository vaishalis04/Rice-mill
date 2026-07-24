import { useState, useEffect } from "react";
import {
  getGateRegisterReportApi,
  getProductionSummaryReportApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";

function useReport(fetcher) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const load = (overrides = {}) => {
    const f = { from, to, page, ...overrides };
    setLoading(true);
    setError("");
    const params = { page: f.page, limit: 25 };
    if (f.from) params.from = f.from;
    if (f.to) params.to = f.to;
    fetcher(params)
      .then((res) => {
        const body = res.data.data ?? res.data;
        // Be defensive about pagination shape — some backends return
        // {rows, page, totalPages}, others {data, meta: {...}}.
        setRows(body.rows ?? body.data ?? body ?? []);
        setMeta({
          page: body.page ?? body.meta?.page ?? f.page,
          totalPages: body.totalPages ?? body.meta?.totalPages ?? 1,
        });
      })
      .catch(() => setError("Failed to load report"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, meta, loading, error, from, setFrom, to, setTo, page, setPage, load };
}

function GateRegisterTab() {
  const r = useReport(getGateRegisterReportApi);

  return (
    <div>
      <form
        className="sf-form"
        onSubmit={(e) => {
          e.preventDefault();
          r.setPage(1);
          r.load({ page: 1 });
        }}
      >
        <div className="sf-field">
          <label>From</label>
          <input type="date" value={r.from} onChange={(e) => r.setFrom(e.target.value)} />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input type="date" value={r.to} onChange={(e) => r.setTo(e.target.value)} />
        </div>
        <button className="sf-submit" type="submit">
          Apply
        </button>
      </form>

      {r.error && <div className="dt-error">{r.error}</div>}

      <DataTable
        loading={r.loading}
        rows={r.rows}
        columns={[
          { key: "token_no", label: "Token No." },
          { key: "entry_time", label: "Entry Time" },
          { key: "vehicle_no", label: "Vehicle" },
          { key: "driver_name", label: "Driver" },
          { key: "vendor_name", label: "Vendor" },
          { key: "material_name", label: "Material" },
          { key: "gate_status", label: "Status" },
        ]}
      />

      <Pager meta={r.meta} onPage={(p) => { r.setPage(p); r.load({ page: p }); }} />
    </div>
  );
}

function ProductionSummaryTab() {
  const r = useReport(getProductionSummaryReportApi);

  return (
    <div>
      <form
        className="sf-form"
        onSubmit={(e) => {
          e.preventDefault();
          r.setPage(1);
          r.load({ page: 1 });
        }}
      >
        <div className="sf-field">
          <label>From</label>
          <input type="date" value={r.from} onChange={(e) => r.setFrom(e.target.value)} />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input type="date" value={r.to} onChange={(e) => r.setTo(e.target.value)} />
        </div>
        <button className="sf-submit" type="submit">
          Apply
        </button>
      </form>

      {r.error && <div className="dt-error">{r.error}</div>}

      <DataTable
        loading={r.loading}
        rows={r.rows}
        columns={[
          { key: "batch_no", label: "Batch No." },
          { key: "production_date", label: "Production Date" },
          { key: "input_qty", label: "Input Qty" },
          { key: "output_qty", label: "Output Qty" },
          {
            key: "recovery_pct",
            label: "Recovery %",
            render: (row) =>
              row.recovery_pct != null ? `${Number(row.recovery_pct).toFixed(2)}%` : "—",
          },
        ]}
      />

      <Pager meta={r.meta} onPage={(p) => { r.setPage(p); r.load({ page: p }); }} />
    </div>
  );
}

function Pager({ meta, onPage }) {
  if (!meta.totalPages || meta.totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
      <button
        className="dt-btn"
        disabled={meta.page <= 1}
        onClick={() => onPage(meta.page - 1)}
      >
        Prev
      </button>
      <span style={{ fontSize: "0.85rem", color: "#7a6f60" }}>
        Page {meta.page} of {meta.totalPages}
      </span>
      <button
        className="dt-btn"
        disabled={meta.page >= meta.totalPages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next
      </button>
    </div>
  );
}

const TABS = [
  { key: "gate_register", label: "Gate Register" },
  { key: "production_summary", label: "Production Summary" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState("gate_register");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Reports</h2>
      <div className="section-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`section-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "gate_register" && <GateRegisterTab />}
      {tab === "production_summary" && <ProductionSummaryTab />}
    </div>
  );
}
