import { useState, useEffect } from "react";
import { getProductionBatchMovementApi } from "../api/api";

// Production Summary > "Warehouse movement": for ONE batch — which warehouse the
// materials were USED FROM, which warehouse they were TRANSFERRED INTO, and the
// stock of each material in that warehouse before the batch, after it, and now.
// (Stock isn't priced in this system, so "value" is the quantity, in Qtl.)

const fmt = (v) => (v === null || v === undefined ? null : Number(v).toFixed(3));
const th = { textAlign: "left", fontSize: 12, color: "#64748b", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 };
const td = { padding: "7px 8px", borderBottom: "1px solid #eef2f7", fontSize: 13.5 };
const num = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function StockCell({ value, completed }) {
  const f = fmt(value);
  if (f === null) return <td style={{ ...num, color: "#94a3b8" }}>{completed ? "n/a" : "—"}</td>;
  return <td style={num}>{f}</td>;
}

function Section({ title, color, subtitle, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ background: color, color: "#fff", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>{title}</span>
        <span style={{ fontSize: 13, color: "#475569" }}>{subtitle}</span>
      </div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>{children}</div>
    </div>
  );
}

export default function ProductionMovementModal({ batch, onClose }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getProductionBatchMovementApi(batch.batch_id ?? batch.id)
      .then((res) => alive && setM(res.data.data ?? res.data))
      .catch((err) => alive && setError(err.response?.data?.message || err.response?.data?.msg || "Couldn't load the warehouse movement"));
    return () => {
      alive = false;
    };
  }, [batch]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "36px 16px", zIndex: 900, overflowY: "auto" }}
      onClick={onClose}
    >
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 900, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Warehouse movement — {batch.batch_no}</h3>
          <button type="button" className="dt-btn" onClick={onClose}>Close</button>
        </div>

        {error && <div className="dt-error" style={{ marginTop: 10 }}>{error}</div>}
        {!m && !error && <p className="field-hint">Loading…</p>}

        {m && (
          <>
            <p className="field-hint" style={{ marginTop: 6 }}>
              {m.production_date ? `Production date ${String(m.production_date).slice(0, 10)} · ` : ""}
              {m.status_label}
            </p>

            {/* the flow at a glance: source -> destination */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" }}>
              <div>
                <div style={{ fontSize: 11, color: "#9a3412", fontWeight: 700 }}>USED FROM</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.source_warehouse.name}</div>
                <div style={{ fontSize: 12.5, color: "#64748b" }}>{m.completed ? "used" : "reserved"} {Number(m.input_qty).toFixed(3)} Qtl</div>
              </div>
              <div style={{ fontSize: 26, color: "#94a3b8" }}>→</div>
              <div>
                <div style={{ fontSize: 11, color: "#166534", fontWeight: 700 }}>TRANSFERRED INTO</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.destination_warehouses.length ? m.destination_warehouses.join(", ") : "— not packed yet —"}</div>
                <div style={{ fontSize: 12.5, color: "#64748b" }}>
                  {m.completed ? `packed ${Number(m.output_qty).toFixed(3)} Qtl` : "stock is moved when the batch is completed"}
                  {m.recovery_pct != null ? ` · recovery ${m.recovery_pct}%` : ""}
                </div>
              </div>
            </div>

            {m.warnings.length > 0 && (
              <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#92400e" }}>
                {m.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <Section title="USED FROM" color="#9a3412" subtitle="materials drawn from the source warehouse">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr><th style={th}>Material</th><th style={th}>Lot</th><th style={th}>Warehouse</th><th style={{ ...th, textAlign: "right" }}>Qty (Qtl)</th><th style={{ ...th, textAlign: "right" }}>Stock before</th><th style={{ ...th, textAlign: "right" }}>Stock after</th><th style={{ ...th, textAlign: "right" }}>Current stock</th></tr>
                </thead>
                <tbody>
                  {m.used.map((u) => (
                    <tr key={u.material_id}>
                      <td style={td}><strong>{u.material_name}</strong></td>
                      <td style={td}>{u.lots.length ? u.lots.join(", ") : "—"}</td>
                      <td style={td}>{u.warehouse_name}</td>
                      <td style={num}>{fmt(u.qty)}</td>
                      <StockCell value={u.before} completed={m.completed} />
                      <StockCell value={u.after} completed={m.completed} />
                      <td style={{ ...num, fontWeight: 700 }}>{fmt(u.current)}</td>
                    </tr>
                  ))}
                  {!m.used.length && <tr><td style={td} colSpan={7}>No materials recorded for this batch.</td></tr>}
                </tbody>
              </table>
            </Section>

            <Section title="TRANSFERRED INTO" color="#166534" subtitle="packed goods added to the destination warehouse">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr><th style={th}>Material</th><th style={th}>Packing</th><th style={th}>Warehouse</th><th style={{ ...th, textAlign: "right" }}>Qty (Qtl)</th><th style={{ ...th, textAlign: "right" }}>Stock before</th><th style={{ ...th, textAlign: "right" }}>Stock after</th><th style={{ ...th, textAlign: "right" }}>Current stock</th></tr>
                </thead>
                <tbody>
                  {m.produced.map((p) => (
                    <tr key={`${p.warehouse_id}-${p.material_id}`}>
                      <td style={td}><strong>{p.material_name}</strong></td>
                      <td style={td}>{p.packs.map((k) => `${k.pack_size} kg × ${k.bags}`).join(", ")}</td>
                      <td style={td}>{p.warehouse_name}</td>
                      <td style={num}>{fmt(p.qty)}</td>
                      <StockCell value={p.before} completed />
                      <StockCell value={p.after} completed />
                      <td style={{ ...num, fontWeight: 700 }}>{fmt(p.current)}</td>
                    </tr>
                  ))}
                  {!m.produced.length && <tr><td style={td} colSpan={7}>Nothing has been packed for this batch yet.</td></tr>}
                </tbody>
              </table>
            </Section>

            <p className="field-hint" style={{ marginTop: 14 }}>
              Stock before / after = the quantity of that material in that warehouse just before the batch moved stock and right after it finished; Current stock = the live balance now.
              These are rebuilt from the stock records (there is no stock ledger); "n/a" means the records for that warehouse and material no longer add up because stock was adjusted by hand.
            </p>
          </>
        )}
      </div>
    </div>
  );
}