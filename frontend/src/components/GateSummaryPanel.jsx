import { useState, useEffect, useCallback, useMemo } from "react";
import { getGateSummaryReportApi } from "../api/api";
import "./GateSummaryPanel.css";

// Reports > Gate Register > Gate Summary
//
// A live picture of every vehicle STILL INSIDE the mill (vehicles that have exited
// never appear), split into six views. Each tab shows how many vehicles are in that
// step right now; PO and SO can be read by order (progress + the trucks inside it)
// or as a flat list of vehicles. A vehicle that's been in the same step for 2h+ turns
// amber, 6h+ red. Anything in the mill that isn't in one of the six views (empty/misc
// trucks mid-process, details not yet attached) is listed at the bottom so nothing is
// ever hidden. The view refreshes itself every minute (switch off with the tick box).

const TABS = [
  { key: "po", label: "Purchase Orders", hint: "Purchase trucks, by order", accent: "#059669", orders: true },
  { key: "so", label: "Sales Orders", hint: "Sales trucks, by order", accent: "#2563eb", orders: true },
  { key: "lab", label: "Lab Analysis", hint: "Waiting for sampling / lab verdict", accent: "#7c3aed" },
  { key: "loading", label: "Loading", hint: "Being loaded, or loaded & weighing out", accent: "#db2777" },
  { key: "unloading", label: "Unloading", hint: "Waiting to unload / unloading", accent: "#ea580c" },
  { key: "gatepass", label: "Gate Pass Pending", hint: "Finished — waiting for gate pass / exit", accent: "#dc2626" },
];

const EMPTY_TEXT = {
  po: "No purchase trucks are inside the mill right now.",
  so: "No sales trucks are inside the mill right now.",
  lab: "Nothing waiting at the lab.",
  loading: "No trucks are waiting to be loaded.",
  unloading: "No trucks are waiting to unload.",
  gatepass: "No trucks are waiting for a gate pass.",
};

const TYPE_LABEL = { purchase: "Purchase", sales: "Sales", other: "Empty / Misc", pending: "Unclassified" };

const fmtDuration = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
};

// Who the order / truck belongs to (vendor on purchase, customer on sales) and the materials —
// shown as bold coloured tags so they can be read at a glance.
const PARTY_LABEL = { purchase: "Vendor", sales: "Customer" };
const PARTY_TONE = { purchase: "po", sales: "so" };

function PartyTag({ kind, name }) {
  if (!name) return null;
  return (
    <span className={`gs-party ${PARTY_TONE[kind] || "other"}`} title={`${PARTY_LABEL[kind] || "Party"}: ${name}`}>
      <em>{PARTY_LABEL[kind] || "Party"}</em>
      {name}
    </span>
  );
}

function MaterialTags({ materials }) {
  const list = (materials || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="gs-mats">
      {list.map((m) => (
        <span key={m} className="gs-mat">{m}</span>
      ))}
    </span>
  );
}

const searchText = (v) =>
  [v.token_no, v.vehicle_no, v.driver_name, v.driver_mobile, v.party_name, v.material, v.stage_label, ...(v.po_nos || []), ...(v.so_nos || []), ...(v.lot_nos || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

function VehicleRow({ v }) {
  const orders = [...(v.po_nos || []), ...(v.so_nos || [])];
  return (
    <div className="gs-vehicle" data-testid="gs-vehicle">
      <div>
        <div className="gs-veh-no">
          {v.vehicle_no || "—"}
          <span className="gs-type">{TYPE_LABEL[v.entry_type] || v.entry_type}</span>
        </div>
        <div className="gs-veh-meta">
          <span className="gs-token">{v.token_no}</span>
          {v.driver_name || "No driver"}
          {v.driver_mobile ? ` · ${v.driver_mobile}` : ""}
        </div>
      </div>
      <div>
        <div className="gs-mid">
          <span className={`gs-chip ${v.stage_tone || "muted"}`}>{v.stage_label}</span>
          {orders.map((o) => (
            <span key={o} className="gs-chip order">{o}</span>
          ))}
          {(v.lot_nos || []).map((l) => (
            <span key={l} className="gs-chip order">Lot {l}</span>
          ))}
        </div>
        <div className="gs-veh-tags">
          <PartyTag kind={v.entry_type} name={v.party_name} />
          <MaterialTags materials={v.material ? [v.material] : []} />
          {!v.party_name && !v.material && <span className="gs-veh-meta">—</span>}
        </div>
      </div>
      <div className={`gs-time ${v.wait_level}`}>
        <strong>{fmtDuration(v.minutes_in_stage)}</strong>
        in this step · {fmtDuration(v.minutes_in_mill)} in mill
      </div>
    </div>
  );
}

function OrderCard({ order, kind }) {
  const verb = kind === "po" ? "received" : "loaded";
  // an order whose party isn't on the order row falls back to the party of the trucks inside it
  const partyName = order.party_name || (order.vehicles.find((x) => x.party_name) || {}).party_name || null;
  const partyKind = kind === "po" ? "purchase" : "sales";
  return (
    <div className="gs-order" data-testid="gs-order">
      <div className="gs-order-head">
        <div className="gs-order-id">
          <span className="gs-order-no">{order.order_no}</span>
          <PartyTag kind={partyKind} name={partyName} />
        </div>
        <div className="gs-order-mat">
          {order.materials.length ? <MaterialTags materials={order.materials} /> : "—"}
        </div>
      </div>
      <div className="gs-progress">
        <div className="gs-bar"><span style={{ width: `${order.progress_pct}%` }} /></div>
        <div className="gs-progress-text">
          <span>{order.done_qty} of {order.ordered_qty} Qtl {verb} ({order.progress_pct}%)</span>
          <span><strong>{order.pending_qty} Qtl pending</strong> · {order.vehicles.length} vehicle{order.vehicles.length === 1 ? "" : "s"} in the mill</span>
        </div>
      </div>
      <div className="gs-order-vehicles">
        {order.vehicles.map((v) => <VehicleRow key={v.id} v={v} />)}
      </div>
    </div>
  );
}

export default function GateSummaryPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("po");
  const [view, setView] = useState("order"); // PO / SO: "order" | "vehicle"
  const [q, setQ] = useState("");
  const [auto, setAuto] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getGateSummaryReportApi()
      .then((res) => {
        setData(res.data.data ?? res.data);
        setError("");
      })
      .catch(() => setError("Couldn't load the gate summary"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [auto, load]);

  const needle = q.trim().toLowerCase();
  const match = useCallback((v) => !needle || searchText(v).includes(needle), [needle]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const lists = {};
    TABS.forEach((t) => (lists[t.key] = (data.tabs[t.key] || []).filter(match)));
    const orders = {};
    ["po", "so"].forEach((k) => {
      orders[k] = (data.orders[k] || [])
        .map((o) => {
          const orderHit = !needle || [o.order_no, o.party_name, ...o.materials].filter(Boolean).join(" ").toLowerCase().includes(needle);
          return { ...o, vehicles: orderHit ? o.vehicles : o.vehicles.filter(match) };
        })
        .filter((o) => o.vehicles.length > 0);
    });
    return { lists, orders, unassigned: (data.unassigned || []).filter(match) };
  }, [data, match, needle]);

  const current = TABS.find((t) => t.key === tab);
  const showOrders = current.orders && view === "order";
  const list = filtered ? filtered.lists[tab] : [];
  const orders = filtered && current.orders ? filtered.orders[tab] : [];

  return (
    <div className="gs">
      <div className="gs-top">
        <div className="gs-total">
          <strong>{data ? data.total_in_mill : "—"}</strong>vehicle{data && data.total_in_mill === 1 ? "" : "s"} inside the mill right now
        </div>
        <div className="gs-tools">
          <input
            className="gs-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicle, token, driver, party, order…"
          />
          <button type="button" className="dt-btn" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <label className="gs-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            auto-refresh
          </label>
          {data && <span className="gs-updated">Updated {new Date(data.generated_at).toLocaleTimeString()}</span>}
        </div>
      </div>

      {error && <div className="dt-error">{error}</div>}

      <div className="gs-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`gs-tab ${tab === t.key ? "active" : ""}`}
            style={{ "--accent": t.accent }}
            onClick={() => setTab(t.key)}
            data-testid={`gs-tab-${t.key}`}
          >
            <span className="gs-tab-count">{filtered ? filtered.lists[t.key].length : "—"}</span>
            <span className="gs-tab-label">{t.label}</span>
            <span className="gs-tab-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="gs-panel-head">
        <div>
          <div className="gs-panel-title">{current.label}</div>
          <div className="gs-panel-sub">{current.hint} — vehicles that have exited are not shown.</div>
        </div>
        {current.orders && (
          <div className="gs-switch" role="group" aria-label="Switch view">
            <button type="button" className={view === "order" ? "on" : ""} onClick={() => setView("order")}>By order</button>
            <button type="button" className={view === "vehicle" ? "on" : ""} onClick={() => setView("vehicle")}>By vehicle</button>
          </div>
        )}
      </div>

      {!data && loading && <div className="gs-empty">Loading vehicles…</div>}

      {data && showOrders && (
        orders.length ? (
          <div className="gs-orders">
            {orders.map((o) => <OrderCard key={o.order_no} order={o} kind={tab} />)}
            {list.some((v) => !(v.po_nos || []).length && !(v.so_nos || []).length) && (
              <div className="gs-empty">
                {list.filter((v) => !(v.po_nos || []).length && !(v.so_nos || []).length).length} vehicle(s) have no order linked yet — see "By vehicle".
              </div>
            )}
          </div>
        ) : (
          <div className="gs-empty">{needle ? "No matches for your search." : EMPTY_TEXT[tab]}</div>
        )
      )}

      {data && !showOrders && (
        list.length ? (
          <div className="gs-list">
            {list.map((v) => <VehicleRow key={v.id} v={v} />)}
          </div>
        ) : (
          <div className="gs-empty">{needle ? "No matches for your search." : EMPTY_TEXT[tab]}</div>
        )
      )}

      {filtered && filtered.unassigned.length > 0 && (
        <details className="gs-others">
          <summary>
            {filtered.unassigned.length} other vehicle{filtered.unassigned.length === 1 ? "" : "s"} in the mill — not in any view above yet
          </summary>
          <p className="field-hint" style={{ margin: "6px 0 0" }}>
            Empty / misc trucks still being processed, and trucks whose details haven't been attached yet.
          </p>
          <div className="gs-list">
            {filtered.unassigned.map((v) => <VehicleRow key={v.id} v={v} />)}
          </div>
        </details>
      )}

      <div className="gs-legend">
        Time in the same step: normal · <b className="w">2h+</b> · <b className="l">6h+</b>. Quantities are in Qtl.
      </div>
    </div>
  );
}