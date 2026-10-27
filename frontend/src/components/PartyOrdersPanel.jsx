import { useState, useEffect, useCallback } from "react";
import { getPartyOrdersReportApi } from "../api/api";
import PdfPreviewModal from "./PdfPreviewModal";
import "./PartyOrdersPanel.css";

// Reports > Party Orders
//
// Every Purchase Order / Sales Order grouped by the PARTY it belongs to (vendor for a PO, customer for an
// SO): how many orders the party has, how many are completed / in progress / not started, how much was
// ordered, received (PO) or loaded (SO), what is still pending, and the dates. Click a party to open its
// order history. The numbers come from GET /api/reports/party-orders (helpers/partyOrders.helper.js), which
// also produces the PDF and the two CSV exports.

const STATUS_STYLE = {
  completed: { label: "Completed", color: "#0b5f58", bg: "#e3f1ee" },
  in_progress: { label: "In progress", color: "#0f766e", bg: "#e3f1ee" },
  not_started: { label: "Not started", color: "#4b5753", bg: "#f1ebda" },
  pending_approval: { label: "Pending approval", color: "#b45309", bg: "#fef3c7" },
  rejected: { label: "Rejected", color: "#b3261e", bg: "#fbeae7" },
  cancelled: { label: "Cancelled", color: "#b3261e", bg: "#fbeae7" },
};

const qtl = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const count = (n) => Number(n || 0).toLocaleString("en-IN");
const dmy = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const todayYmd = () => new Date().toISOString().slice(0, 10);

function downloadBlob(blobData, filename, type) {
  const url = window.URL.createObjectURL(new Blob([blobData], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

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

const Pill = ({ n, tone }) => <span className={`po-pill ${n ? tone || "" : "zero"}`}>{n ? count(n) : "0"}</span>;

function OrderHistory({ party }) {
  return (
    <table className="po-sub">
      <thead>
        <tr>
          <th>Order No</th>
          <th>Type</th>
          <th>Order date</th>
          <th>Validity</th>
          <th>Materials</th>
          <th>Status</th>
          <th className="num">Ordered (Qtl)</th>
          <th className="num">{party.party_kind === "vendor" ? "Received" : "Loaded"} (Qtl)</th>
          <th className="num">Pending (Qtl)</th>
          <th>Progress</th>
          <th className="num">Trucks</th>
          <th>First {party.party_kind === "vendor" ? "receipt" : "loading"}</th>
          <th>Last {party.party_kind === "vendor" ? "receipt" : "loading"}</th>
        </tr>
      </thead>
      <tbody>
        {party.orders.map((o) => {
          const st = STATUS_STYLE[o.status];
          return (
            <tr key={`${o.kind}-${o.id}`}>
              <td><strong>{o.order_no}</strong></td>
              <td>{o.kind === "po" ? "PO" : "SO"}</td>
              <td>{dmy(o.order_date)}</td>
              <td>{o.validity ? dmy(o.validity) : "—"}</td>
              <td>{o.materials.join(", ") || "—"}</td>
              <td>
                <span className="po-status" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                {o.overdue && <span className="po-late">past validity</span>}
              </td>
              <td className="num">{qtl(o.ordered_qty)}</td>
              <td className="num">{qtl(o.done_qty)}</td>
              <td className="num"><strong>{qtl(o.pending_qty)}</strong></td>
              <td>
                <span className="po-bar"><span style={{ width: `${o.progress_pct}%` }} /></span>
                {o.progress_pct}%
              </td>
              <td className="num">
                {o.trucks_done}
                {o.trucks_active > 0 && <span title="Trucks for this order inside the mill right now"> (+{o.trucks_active} in mill)</span>}
              </td>
              <td>{dmy(o.first_date)}</td>
              <td>{dmy(o.last_date)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function PartyOrdersPanel() {
  const [type, setType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);

  const params = useCallback(() => {
    const p = { type };
    if (from) p.from = from;
    if (to) p.to = to;
    if (status) p.status = status;
    if (q.trim()) p.q = q.trim();
    return p;
  }, [type, from, to, status, q]);

  const load = useCallback(() => {
    if (from && to && from > to) {
      setError("'From' must not be after 'To'");
      return;
    }
    setLoading(true);
    setError("");
    getPartyOrdersReportApi(params())
      .then((res) => setData(res.data.data ?? res.data))
      .catch((err) => setError(err?.response?.data?.msg || "Couldn't load the party order summary"))
      .finally(() => setLoading(false));
  }, [params, from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // first load only; after that the Show button applies the filters

  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportAs = async (kind) => {
    setError("");
    setBusy(kind);
    try {
      if (kind === "pdf") {
        const res = await getPartyOrdersReportApi({ ...params(), format: "pdf" });
        const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        setPreview({ url, fileName: `party-order-summary-${todayYmd()}.pdf`, title: "Party-wise Order Summary" });
      } else {
        const res = await getPartyOrdersReportApi({ ...params(), format: "csv", detail: kind === "csv_parties" ? "parties" : "orders" });
        downloadBlob(res.data, kind === "csv_parties" ? "party-order-summary.csv" : "party-orders.csv", "text/csv");
      }
    } catch (err) {
      setError(await blobErrorMessage(err, "Could not generate the export"));
    } finally {
      setBusy("");
    }
  };

  const s = data?.summary;
  const parties = data?.parties || [];
  const kpis = s
    ? [
        { label: "Parties", value: count(s.parties), color: "#14201d" },
        { label: "Orders", value: count(s.counts.total), color: "#14201d" },
        { label: "Completed", value: count(s.counts.completed), color: "#0f766e" },
        { label: "In progress", value: count(s.counts.in_progress), color: "#0f766e" },
        { label: "Not started", value: count(s.counts.not_started), color: "#5b6660" },
        { label: "Awaiting approval", value: count(s.counts.pending_approval), color: "#d97706" },
        { label: "Ordered (Qtl)", value: qtl(s.ordered_qty), color: "#14201d" },
        { label: "Received / loaded (Qtl)", value: qtl(s.done_qty), color: "#0f766e" },
        { label: "Pending (Qtl)", value: qtl(s.pending_qty), color: "#c2701a" },
        { label: "Completion", value: `${s.completion_pct}%`, color: "#2e9e92" },
      ]
    : [];

  return (
    <div className="po">
      <p className="field-hint" style={{ marginTop: 0 }}>
        Every Purchase Order (by vendor) and Sales Order (by customer), grouped by party: how many orders each has, how
        many are completed, in progress or not started, how much was ordered against what was received / loaded, what is
        still pending, and the dates. Click a party to see its order history.
      </p>

      <div className="po-filters">
        <div>
          <label>Orders</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">Purchase and Sales</option>
            <option value="po">Purchase Orders (vendors)</option>
            <option value="so">Sales Orders (customers)</option>
          </select>
        </div>
        <div>
          <label>Order date from</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>Order date to</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="in_progress">In progress</option>
            <option value="not_started">Not started</option>
            <option value="pending_approval">Pending approval</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="overdue">Past validity (still open)</option>
          </select>
        </div>
        <div>
          <label>Party / order no.</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search party or order…"
          />
        </div>
      </div>

      <div className="po-actions">
        <button type="button" className="sf-submit" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Show"}
        </button>
        <button type="button" className="dt-btn" onClick={() => exportAs("pdf")} disabled={!!busy}>
          {busy === "pdf" ? "Generating…" : "View PDF"}
        </button>
        <button type="button" className="dt-btn" onClick={() => exportAs("csv_orders")} disabled={!!busy}>
          {busy === "csv_orders" ? "Exporting…" : "Export CSV (orders)"}
        </button>
        <button type="button" className="dt-btn" onClick={() => exportAs("csv_parties")} disabled={!!busy}>
          {busy === "csv_parties" ? "Exporting…" : "Export CSV (party summary)"}
        </button>
      </div>

      {error && <div className="dt-error">{error}</div>}

      {s && (
        <div className="po-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="po-kpi" style={{ "--k": k.color }}>
              <strong>{k.value}</strong>
              <span>{k.label}</span>
            </div>
          ))}
        </div>
      )}

      {data && parties.length > 0 && (
        <div className="po-tools">
          <span>{parties.length} part{parties.length === 1 ? "y" : "ies"}</span>
          <span>
            <button type="button" className="dt-btn" onClick={() => setOpen(new Set(parties.map((p) => p.party_key)))}>Expand all</button>{" "}
            <button type="button" className="dt-btn" onClick={() => setOpen(new Set())}>Collapse all</button>
          </span>
        </div>
      )}

      <div className="po-wrap">
        {!data && loading && <div className="po-empty">Loading…</div>}
        {data && parties.length === 0 && <div className="po-empty">No orders found for these filters.</div>}
        {data && parties.length > 0 && (
          <table className="po-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Type</th>
                <th className="num">Orders</th>
                <th className="num">Completed</th>
                <th className="num">In progress</th>
                <th className="num">Not started</th>
                <th className="num">Ordered (Qtl)</th>
                <th className="num">Received / Loaded (Qtl)</th>
                <th className="num">Pending (Qtl)</th>
                <th>Completion</th>
                <th>First order</th>
                <th>Last order</th>
                <th>Last activity</th>
                <th className="num" title="Average days from order date to last receipt / loading, for completed orders">Avg days to complete</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => {
                const isOpen = open.has(p.party_key);
                return (
                  <FragmentRows key={p.party_key} party={p} isOpen={isOpen} onToggle={() => toggle(p.party_key)} />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="po-note">
        Quantities are in Qtl. Ordered / Received-Loaded count approved, non-cancelled orders; Pending is what is left on orders
        that are in progress or not started. Orders awaiting approval, rejected or cancelled are listed but not counted in the
        quantities. Completed = every line received (PO) or loaded (SO) in full; In progress = something received / loaded, or a
        truck for the order is inside the mill.
      </div>

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

function FragmentRows({ party: p, isOpen, onToggle }) {
  return (
    <>
      <tr className={`po-party-row ${isOpen ? "po-open" : ""}`} onClick={onToggle}>
        <td>
          <span className="po-caret">▶</span>
          <span className="po-party-name">{p.party_name}</span>
        </td>
        <td><span className={`po-kind ${p.party_kind}`}>{p.party_kind === "vendor" ? "Vendor" : "Customer"}</span></td>
        <td className="num"><strong>{count(p.counts.total)}</strong></td>
        <td className="num"><Pill n={p.counts.completed} tone="good" /></td>
        <td className="num"><Pill n={p.counts.in_progress} tone="info" /></td>
        <td className="num"><Pill n={p.counts.not_started} /></td>
        <td className="num">{qtl(p.ordered_qty)}</td>
        <td className="num">{qtl(p.done_qty)}</td>
        <td className="num"><strong>{qtl(p.pending_qty)}</strong></td>
        <td>
          <span className="po-bar"><span style={{ width: `${p.completion_pct}%` }} /></span>
          {p.completion_pct}%
        </td>
        <td>{dmy(p.first_order_date)}</td>
        <td>{dmy(p.last_order_date)}</td>
        <td>{dmy(p.last_activity_date)}</td>
        <td className="num">{p.avg_days_to_complete ?? "—"}</td>
      </tr>
      {isOpen && (
        <tr className="po-detail">
          <td colSpan={14}>
            <OrderHistory party={p} />
          </td>
        </tr>
      )}
    </>
  );
}
