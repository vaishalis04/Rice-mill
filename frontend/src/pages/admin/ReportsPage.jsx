import { useState, useEffect } from "react";
import {
  getProductionSummaryReportApi,
  getDailyReportPdfApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import PdfPreviewModal from "../../components/PdfPreviewModal";
import GateSummaryPanel from "../../components/GateSummaryPanel";
import PartyOrdersPanel from "../../components/PartyOrdersPanel";
import { useEntityLookup } from "../../hooks/useEntityLookup";
import ProductionMovementModal from "../../components/ProductionMovementModal";
import InventoryPage from "../warehouse/InventoryPage";

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

// A failed blob request carries its JSON error as a Blob — read the message out.
async function blobErrorMessage(err, fallback) {
  const blob = err?.response?.data;
  if (blob instanceof Blob) {
    try {
      const parsed = JSON.parse(await blob.text());
      return parsed.msg || parsed.message || fallback;
    } catch {
      return fallback;
    }
  }
  return err?.response?.data?.msg || err?.response?.data?.message || fallback;
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

function DateFilterBar({ r, onExport, onPdf, pdfBusy }) {
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
      {onPdf && (
        <button type="button" className="dt-btn" onClick={onPdf} disabled={pdfBusy}>
          {pdfBusy ? "Generating…" : "📄 PDF Report"}
        </button>
      )}
    </form>
  );
}

function ProductionSummaryTab() {
  const r = useReport(getProductionSummaryReportApi);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [preview, setPreview] = useState(null); // { url, fileName, title }
  const [movementRow, setMovementRow] = useState(null);

  // The Production Summary PDF: every batch in the date range with the materials USED
  // FROM each warehouse, what was TRANSFERRED INTO which warehouse, and the stock
  // before / after / now. Opens in the PDF preview (which has Download).
  const viewPdf = async () => {
    setPdfError("");
    setPdfBusy(true);
    try {
      const params = { format: "pdf" };
      if (r.from) params.from = r.from;
      if (r.to) params.to = r.to;
      const res = await getProductionSummaryReportApi(params);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPreview({
        url,
        fileName: `production-summary${r.from ? `-${r.from}` : ""}${r.to ? `_to_${r.to}` : ""}.pdf`,
        title: "Production Summary Report",
      });
    } catch (err) {
      setPdfError(await blobErrorMessage(err, "Could not generate the Production Summary PDF"));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div>
      <DateFilterBar r={r} onExport={() => r.exportCsv("production-summary.csv")} onPdf={viewPdf} pdfBusy={pdfBusy} />
      {r.error && <div className="dt-error">{r.error}</div>}
      {pdfError && <div className="dt-error">{pdfError}</div>}

      <DataTable
        loading={r.loading}
        rows={r.rows}
        columns={[
          { key: "batch_no", label: "Batch No." },
          { key: "production_date", label: "Production Date" },
          {
            key: "input_qty",
            label: "Input Qty (Qtl)",
            render: (row) => (row.input_qty != null ? Number(row.input_qty).toFixed(2) : "—"),
          },
          {
            key: "output_qty",
            label: "Output Qty (Qtl)",
            render: (row) => (row.output_qty != null ? Number(row.output_qty).toFixed(2) : "—"),
          },
          {
            key: "recovery_pct",
            label: "Recovery %",
            render: (row) =>
              row.recovery_pct != null ? `${Number(row.recovery_pct).toFixed(2)}%` : "—",
          },
          {
            key: "movement",
            label: "Warehouse movement",
            render: (row) => (
              <button type="button" className="dt-btn" onClick={() => setMovementRow(row)}>
                View
              </button>
            ),
          },
        ]}
      />

      <Pager meta={r.meta} onPage={(p) => { r.setPage(p); r.load({ page: p }); }} />

      {movementRow && <ProductionMovementModal batch={movementRow} onClose={() => setMovementRow(null)} />}

      {preview && (
        <PdfPreviewModal
          title={preview.title}
          blobUrl={preview.url}
          fileName={preview.fileName}
          onClose={() => {
            window.URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

// Daily Report — one date, optional plant / warehouse, three PDF reports:
// Inward, Outward and the Overall inward/outward summary. Each opens in the PDF
// preview (which has Download), same as the other report PDFs.
const DAILY_REPORTS = [
  {
    type: "inward",
    label: "Inward Report",
    hint: "Purchase trucks received, by warehouse — every warehouse listed, with GP No.",
    accent: "#059669",
  },
  {
    type: "outward",
    label: "Outward Report",
    hint: "Sales trucks dispatched, by plant / mill — with GP No., bags and loaded qty.",
    accent: "#2563eb",
  },
  {
    type: "overall",
    label: "Overall Inward / Outward",
    hint: "Day summary of inward and outward plus the full vehicle log — with GP No.",
    accent: "#7c3aed",
  },
];

// Pick one OR MORE warehouses (nothing ticked = all). A small dropdown with a tick-list.
function WarehouseMultiSelect({ plantId, value, onChange }) {
  const warehouses = useEntityLookup("warehouse");
  const options = warehouses.rows.filter((w) => !plantId || !w.plant_id || String(w.plant_id) === String(plantId));
  const picked = new Set(value.map(String));
  const toggleOne = (id) => {
    const next = new Set(picked);
    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    onChange([...next]);
  };
  const names = options.filter((w) => picked.has(String(w.id))).map((w) => w.name);
  const summary = !names.length ? "All warehouses" : names.length <= 2 ? names.join(", ") : `${names.length} warehouses selected`;
  return (
    <div className="sf-field">
      <label>Warehouses (optional — all if none ticked)</label>
      <details style={{ position: "relative" }}>
        <summary
          style={{ listStyle: "none", cursor: "pointer", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", display: "flex", justifyContent: "space-between", gap: 8 }}
        >
          <span>{summary}</span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div
          style={{ position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: 4, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 6px 18px rgba(15,23,42,.12)", maxHeight: 260, overflowY: "auto", padding: 8 }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button type="button" className="dt-btn" onClick={() => onChange(options.map((w) => String(w.id)))}>Select all</button>
            <button type="button" className="dt-btn" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.length === 0 && <div style={{ color: "#64748b", fontSize: "0.85rem" }}>No warehouses.</div>}
          {options.map((w) => (
            <label key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", cursor: "pointer", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={picked.has(String(w.id))} onChange={() => toggleOne(w.id)} />
              {w.name}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function DailyReportTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [plantId, setPlantId] = useState("");
  const [warehouseIds, setWarehouseIds] = useState([]); // empty = all warehouses
  const [busy, setBusy] = useState(""); // report type being generated
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null); // { url, fileName, title }

  const handleView = async (report) => {
    setError("");
    if (!from || !to) {
      setError("Pick both a From and a To date");
      return;
    }
    if (from > to) {
      setError("'From' must not be after 'To'");
      return;
    }
    setBusy(report.type);
    try {
      const params = { from, to, report_type: report.type };
      if (plantId) params.plant_id = plantId;
      if (warehouseIds.length) params.warehouse_ids = warehouseIds.join(",");
      const res = await getDailyReportPdfApi(params);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const range = from === to ? from : `${from}_to_${to}`;
      setPreview({
        url,
        fileName: `daily-${report.type}-report-${range}.pdf`,
        title: `${report.label} — ${from === to ? from : `${from} to ${to}`}`,
      });
    } catch (err) {
      setError(await blobErrorMessage(err, `Could not generate the ${report.label} PDF`));
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      <p className="field-hint" style={{ marginTop: 0 }}>
        Pick a date range (the same day in both boxes gives a single-day report) and, if you want, a plant / mill and
        one or more warehouses, then open the report you need. Every vehicle carries its Gate Pass number; weights are
        the weighbridge net weight (1st − 2nd weighment).
      </p>
      <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
        <div className="sf-field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
        </div>
        <EntitySelect
          entity="plant"
          label="Plant / Mill (optional — all if blank)"
          value={plantId}
          onChange={(v) => {
            setPlantId(v);
            setWarehouseIds([]);
          }}
        />
        <WarehouseMultiSelect plantId={plantId} value={warehouseIds} onChange={setWarehouseIds} />
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 14 }}>
        {DAILY_REPORTS.map((r) => (
          <div
            key={r.type}
            style={{
              border: "1px solid #e2e8f0",
              borderTop: `4px solid ${r.accent}`,
              borderRadius: 12,
              background: "#fff",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>{r.label}</div>
            <div style={{ fontSize: "0.82rem", color: "#64748b", flex: 1 }}>{r.hint}</div>
            <button
              type="button"
              className="sf-submit"
              disabled={!!busy}
              onClick={() => handleView(r)}
              style={{ background: r.accent }}
            >
              {busy === r.type ? "Generating…" : "View PDF"}
            </button>
          </div>
        ))}
      </div>

      {error && <div className="dt-error" style={{ marginTop: 12 }}>{error}</div>}

      {preview && (
        <PdfPreviewModal
          title={preview.title}
          blobUrl={preview.url}
          fileName={preview.fileName}
          onClose={() => {
            window.URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        />
      )}
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
  { key: "gate_summary", label: "Gate Summary" },
  { key: "production_summary", label: "Production Summary" },
  { key: "inventory", label: "Inventory" },
  { key: "daily_report", label: "Daily Report" },
  { key: "party_orders", label: "Party Orders" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState("gate_summary");

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

      {tab === "gate_summary" && <GateSummaryPanel />}
      {tab === "production_summary" && <ProductionSummaryTab />}
      {tab === "inventory" && <InventoryPage embedded />}
      {tab === "daily_report" && <DailyReportTab />}
      {tab === "party_orders" && <PartyOrdersPanel />}

      <ModuleGuide
        title="Reports"
        steps={[
          "Gate Summary — a live view of vehicles still inside the mill, grouped into Purchase Orders, Sales Orders, Lab Analysis, Loading, Unloading and Gate Pass Pending. Inside each one, the status buttons split the vehicles by the exact step they are in (for example Lab Analysis: Sample not taken yet / Lab test pending). Exited vehicles are excluded; the panel refreshes automatically.",
          "Production Summary — every batch run, with input/output quantities and recovery %, filterable by production date. Click View under Warehouse movement for a batch to see which warehouse its materials were used from, which warehouse they were transferred into, and the stock before, after and now. PDF Report gives the same for every batch in the date range, and Export CSV now carries the same warehouse and stock before / closing / current columns (one row per movement line; Line 1 of each batch carries the batch totals once).",
          "Inventory — your live stock by item, location and bag size, plus the Inventory Reports (PDF): Stock Movement for a date range and Current Stock.",
          "Daily Report — pick a date range (one day, or From – To), optionally a plant / mill and one or more warehouses, and open the Inward Report, the Outward Report or the Overall Inward / Outward report. Each is its own PDF layout and lists the Gate Pass number of every vehicle, with weighbridge net weight, bags and lot numbers; a longer range adds each vehicle's date and, on the overall report, day-wise totals.",
          "Party Orders — every Purchase Order (by vendor) and Sales Order (by customer) grouped by party: how many orders, how many completed / in progress / not started, ordered vs received or loaded quantity, what is pending, and the dates. Filter by order type, order date, status or party; click a party for its order history; open the PDF or export CSV.",
          "Production Summary has an Export CSV option; its designed PDF report opens in a preview. Inventory includes current-stock and date-range stock-movement PDFs; the stock-movement PDF also lists every material movement between warehouses with the quantity left.",
        ]}
      />
    </div>
  );
}