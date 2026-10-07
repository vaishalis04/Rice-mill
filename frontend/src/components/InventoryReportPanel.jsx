import { useState, useEffect } from "react";
import axiosInstance from "../api/axiosInstance";
import PdfPreviewModal from "./PdfPreviewModal";

// "Reports (PDF)" panel for the Inventory page. Two reports:
//   Stock Movement  - Opening / Inwards / Production / Dispatch / Issue / Closing for a date range
//   Current Stock   - what the Inventory table shows, as on now
// Both can be viewed in a preview window or downloaded, and filtered by
// warehouse (location), item, stock type and pack size. See
// rice-mill-backend/controllers/inventoryReport.controller.js.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const QUICK_RANGES = [
  { label: "Today", from: () => ymd(new Date()), to: () => ymd(new Date()) },
  { label: "Last 7 days", from: () => ymd(daysAgo(6)), to: () => ymd(new Date()) },
  { label: "Last 30 days", from: () => ymd(daysAgo(29)), to: () => ymd(new Date()) },
  { label: "This month", from: () => ymd(startOfMonth()), to: () => ymd(new Date()) },
];

const fieldStyle = { width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" };

// The PDF endpoint answers with a blob, so a JSON error body has to be read out of it.
const blobErrorMessage = async (err, fallback) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.message || parsed.msg || fallback;
    } catch {
      return fallback;
    }
  }
  return err?.response?.data?.message || err?.response?.data?.msg || fallback;
};

export default function InventoryReportPanel() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState({ warehouses: [], materials: [], bag_sizes: [] });
  const [optionsError, setOptionsError] = useState("");

  const [reportType, setReportType] = useState("movement");
  const [from, setFrom] = useState(ymd(daysAgo(6)));
  const [to, setTo] = useState(ymd(new Date()));
  const [warehouseId, setWarehouseId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [stockType, setStockType] = useState("all");
  const [bagSize, setBagSize] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [minIdleDays, setMinIdleDays] = useState("");

  const [busy, setBusy] = useState(""); // "view" | "download" | ""
  const [error, setError] = useState("");
  const [pdfPreview, setPdfPreview] = useState(null);

  // Load the dropdown choices the first time the panel is opened.
  useEffect(() => {
    if (!open || options.warehouses.length || options.materials.length) return;
    axiosInstance
      .get("/inventory/report-filters")
      .then((res) => {
        setOptions(res.data.data);
        setOptionsError("");
      })
      .catch(() => setOptionsError("Couldn't load the warehouse / item lists — you can still generate the report for everything."));
  }, [open, options.warehouses.length, options.materials.length]);

  const isMovement = reportType === "movement";

  const buildParams = () => {
    const params = { report_type: reportType };
    if (isMovement) {
      params.from = from;
      params.to = to;
      if (includeEmpty) params.include_empty = 1;
    } else if (String(minIdleDays).trim() !== "") {
      params.min_idle_days = minIdleDays;
    }
    if (warehouseId) params.warehouse_id = warehouseId;
    if (materialId) params.material_id = materialId;
    if (stockType !== "all") params.stock_type = stockType;
    if (bagSize) params.bag_size = bagSize;
    return params;
  };

  const validate = () => {
    if (isMovement) {
      if (!from || !to) return "Choose both a From and a To date.";
      if (from > to) return "The From date can't be after the To date.";
    }
    if (!isMovement && String(minIdleDays).trim() !== "" && (!(Number(minIdleDays) >= 0) || Number.isNaN(Number(minIdleDays)))) {
      return "Minimum idle days must be 0 or more.";
    }
    return "";
  };

  const fileName = () =>
    isMovement
      ? `inventory-movement-${from}${from === to ? "" : `_to_${to}`}.pdf`
      : `inventory-stock-${ymd(new Date())}.pdf`;

  const previewTitle = () => {
    const wh = options.warehouses.find((w) => String(w.id) === String(warehouseId))?.name;
    const base = isMovement ? "Inventory Stock Movement Report" : "Inventory Stock Report";
    return wh ? `${base} — ${wh}` : base;
  };

  const generate = async (mode) => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(mode);
    try {
      const res = await axiosInstance.get("/inventory/report-pdf", { params: buildParams(), responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      if (mode === "view") {
        setPdfPreview({ url, fileName: fileName(), title: previewTitle() });
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", fileName());
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 4000);
      }
    } catch (err) {
      setError(await blobErrorMessage(err, "Could not generate the report PDF"));
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    setWarehouseId("");
    setMaterialId("");
    setStockType("all");
    setBagSize("");
    setIncludeEmpty(false);
    setMinIdleDays("");
    setFrom(ymd(daysAgo(6)));
    setTo(ymd(new Date()));
    setError("");
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button type="button" className="dt-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide Reports" : "Reports (PDF)"}
      </button>

      {open && (
        <div style={{ marginTop: 10, padding: 16, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          {optionsError && <div className="dt-error">{optionsError}</div>}
          {error && <div className="dt-error">{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div className="sf-field" style={{ marginBottom: 0 }}>
              <label>Report</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value)} style={fieldStyle}>
                <option value="movement">Stock Movement (date range)</option>
                <option value="stock">Current Stock (as on now)</option>
              </select>
            </div>

            {isMovement && (
              <>
                <div className="sf-field" style={{ marginBottom: 0 }}>
                  <label>From</label>
                  <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
                </div>
                <div className="sf-field" style={{ marginBottom: 0 }}>
                  <label>To</label>
                  <input type="date" value={to} min={from || undefined} max={ymd(new Date())} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
                </div>
              </>
            )}

            <div className="sf-field" style={{ marginBottom: 0 }}>
              <label>Warehouse / Location</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={fieldStyle}>
                <option value="">All warehouses</option>
                {options.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div className="sf-field" style={{ marginBottom: 0 }}>
              <label>Item</label>
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} style={fieldStyle}>
                <option value="">All items</option>
                {options.materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="sf-field" style={{ marginBottom: 0 }}>
              <label>Stock type</label>
              <select value={stockType} onChange={(e) => setStockType(e.target.value)} style={fieldStyle}>
                <option value="all">Raw + Packed</option>
                <option value="raw">Raw only</option>
                <option value="fg">Packed (finished goods) only</option>
              </select>
            </div>

            <div className="sf-field" style={{ marginBottom: 0 }}>
              <label>Pack / bag size</label>
              <select value={bagSize} onChange={(e) => setBagSize(e.target.value)} style={fieldStyle}>
                <option value="">All sizes</option>
                <option value="bulk">Bulk (no bag size)</option>
                {options.bag_sizes.map((s) => (
                  <option key={s} value={s}>{s} kg</option>
                ))}
              </select>
            </div>

            {!isMovement && (
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Idle for at least (days)</label>
                <input type="number" min="0" step="1" placeholder="e.g. 7 — leave blank for all" value={minIdleDays} onChange={(e) => setMinIdleDays(e.target.value)} style={fieldStyle} />
              </div>
            )}
          </div>

          {isMovement && (
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>Quick range:</span>
              {QUICK_RANGES.map((r) => (
                <button key={r.label} type="button" className="dt-btn" onClick={() => { setFrom(r.from()); setTo(r.to()); }}>
                  {r.label}
                </button>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12, fontWeight: 400, fontSize: 13 }}>
                <input type="checkbox" checked={includeEmpty} onChange={(e) => setIncludeEmpty(e.target.checked)} style={{ width: "auto" }} />
                Include rows with no stock and no movement
              </label>
            </div>
          )}

          {isMovement && (
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
              Opening and Closing stock are shown when the date range ends today. For a range that ends earlier, only the
              movements (Inwards, Production, Dispatch, Issue) are shown — the system keeps no past running balance.
            </p>
          )}

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="sf-submit" disabled={!!busy} onClick={() => generate("view")}>
              {busy === "view" ? "Generating…" : "View PDF"}
            </button>
            <button type="button" className="dt-btn" disabled={!!busy} onClick={() => generate("download")}>
              {busy === "download" ? "Preparing…" : "Download PDF"}
            </button>
            <button type="button" className="dt-btn" disabled={!!busy} onClick={reset}>
              Reset filters
            </button>
          </div>
        </div>
      )}

      {pdfPreview && (
        <PdfPreviewModal
          title={pdfPreview.title}
          blobUrl={pdfPreview.url}
          fileName={pdfPreview.fileName}
          onClose={() => {
            window.URL.revokeObjectURL(pdfPreview.url);
            setPdfPreview(null);
          }}
        />
      )}
    </div>
  );
}
