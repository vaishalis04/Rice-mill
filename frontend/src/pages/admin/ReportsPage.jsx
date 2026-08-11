import { useState, useEffect } from "react";
import {
  getGateRegisterReportApi,
  getProductionSummaryReportApi,
  getMaterialFlowReportApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";

// Triggers a real browser download from a blob response. filenameFallback
// is used if the backend doesn't send a Content-Disposition header.
function downloadBlob(blobData, filenameFallback) {
  const url = window.URL.createObjectURL(new Blob([blobData], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

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

  const exportCsv = async (filename) => {
    setError("");
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      params.format = "csv";
      const res = await fetcher(params);
      downloadBlob(res.data, filename);
    } catch {
      setError("CSV export failed");
    }
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, meta, loading, error, from, setFrom, to, setTo, page, setPage, load, exportCsv };
}

function DateFilterBar({ r, onExport }) {
  return (
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
      <button type="button" className="dt-btn" onClick={onExport}>
        ⬇ Export CSV
      </button>
    </form>
  );
}

function GateRegisterTab() {
  const r = useReport(getGateRegisterReportApi);

  return (
    <div>
      <DateFilterBar r={r} onExport={() => r.exportCsv("gate-register.csv")} />
      {r.error && <div className="dt-error">{r.error}</div>}

      <DataTable
        loading={r.loading}
        rows={r.rows}
        columns={[
          { key: "token_no", label: "Token No." },
          { key: "entry_time", label: "Entry Time" },
          { key: "vehicle", label: "Vehicle", render: (row) => row.vehicle?.vehicle_no || "—" },
          { key: "driver", label: "Driver", render: (row) => row.driver?.name || "—" },
          { key: "vendor", label: "Vendor", render: (row) => row.vendor?.name || "—" },
          { key: "material", label: "Material", render: (row) => row.material?.name || "—" },
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
      <DateFilterBar r={r} onExport={() => r.exportCsv("production-summary.csv")} />
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

const SUMMARY_FIELDS = [
  { key: "total_inward_qty", label: "Total Inward" },
  { key: "total_processed_input_qty", label: "Processed (Input)" },
  { key: "total_processed_output_qty", label: "Processed (Output)" },
  { key: "total_raw_stock_qty", label: "Raw Stock" },
  { key: "total_by_product_stock_qty", label: "By-Product Stock" },
  { key: "total_finished_goods_stock_qty", label: "Finished Goods Stock" },
];

function MaterialFlowTab() {
  const [period, setPeriod] = useState("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const buildParams = (overrides = {}) => {
    const f = { period, from, to, material_id: materialId, ...overrides };
    const params = {};
    // Explicit date range overrides period, per the API.
    if (f.from || f.to) {
      if (f.from) params.from = f.from;
      if (f.to) params.to = f.to;
    } else if (f.period) {
      params.period = f.period;
    }
    if (f.material_id) params.material_id = f.material_id;
    return params;
  };

  const load = (overrides = {}) => {
    setLoading(true);
    setError("");
    getMaterialFlowReportApi(buildParams(overrides))
      .then((res) => {
        const body = res.data.data ?? res.data;
        setSummary(body.summary ?? null);
        setRows(body.rows ?? []);
      })
      .catch(() => setError("Failed to load material flow report"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePeriod = (p) => {
    setPeriod(p);
    setFrom("");
    setTo("");
    load({ period: p, from: "", to: "" });
  };

  const handleExport = async () => {
    setError("");
    try {
      const res = await getMaterialFlowReportApi({ ...buildParams(), format: "csv" });
      downloadBlob(res.data, `material-flow-${from || to ? "range" : period}.csv`);
    } catch {
      setError("CSV export failed");
    }
  };

  return (
    <div>
      <div className="section-tabs" style={{ marginBottom: 10 }}>
        {["today", "week", "month"].map((p) => (
          <button
            key={p}
            className={`section-tab ${period === p && !from && !to ? "active" : ""}`}
            onClick={() => handlePeriod(p)}
          >
            {p === "today" ? "Today" : p === "week" ? "Last 7 Days" : "Last 30 Days"}
          </button>
        ))}
      </div>

      <form
        className="sf-form"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="sf-field">
          <label>From (overrides period)</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <EntitySelect
          entity="material"
          label="Material (optional)"
          value={materialId}
          onChange={(id) => {
            setMaterialId(id);
            load({ material_id: id });
          }}
        />
        <button className="sf-submit" type="submit">
          Apply
        </button>
        <button type="button" className="dt-btn" onClick={handleExport}>
          ⬇ Export CSV
        </button>
      </form>

      {error && <div className="dt-error">{error}</div>}

      {summary && (
        <div className="kpi-cards" style={{ marginBottom: 16 }}>
          {SUMMARY_FIELDS.map((f) => (
            <div className="kpi-card" key={f.key}>
              <div className="kpi-value">{summary[f.key] ?? "—"}</div>
              <div className="kpi-label">{f.label}</div>
            </div>
          ))}
        </div>
      )}

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: "section", label: "Section" },
          { key: "material", label: "Material" },
          { key: "qty", label: "Qty" },
        ]}
      />
      <p className="field-hint" style={{ marginTop: 8 }}>
        Warehouse Stock rows are always a live snapshot — they don't change with the date
        range, only Inward and Processed rows do.
      </p>
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
      <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
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
  { key: "material_flow", label: "Material Flow" },
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
      {tab === "material_flow" && <MaterialFlowTab />}

      <ModuleGuide
        title="Reports"
        steps={[
          "Gate Register — every truck that's come through the gate, with vehicle/driver/vendor/material details, filterable by date.",
          "Production Summary — every batch run, with input/output quantities and recovery %, filterable by production date.",
          "Material Flow — the big picture: how much came in, how much got processed, and how much is sitting in the warehouse right now. Pick a rolling period (today/week/month) or an exact date range.",
          "Every report has an Export CSV button for opening the same data in Excel or Sheets.",
        ]}
      />
    </div>
  );
}