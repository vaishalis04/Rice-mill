import { useEffect, useMemo, useState } from "react";
import { finalizeProductionBatchApi } from "../api/api";
import EntitySelect from "./EntitySelect";

// The OUTPUT half of a production batch.
//
// A batch is created from INPUT materials (warehouse + material + bag size +
// bags) — that part is unchanged. This panel is where the batch is finished:
// for every input material the person adds what it was turned into —
//   * one or more output materials (searchable; can even be the SAME material
//     as the input), each with a bag size and ACCEPTED / REJECTED bags
//   * the total output (accepted + rejected) of one input can't be more than
//     that input's quantity — less is fine, the rest is shrink / loss
// and finally picks ONE destination warehouse for all accepted output.
// Rejected bags are recorded but never added to stock.
//
// Quantities are in tons (1 ton = 1000 kg), as everywhere else in this app.

const PACK_PRESETS = ["5", "10", "25", "50", "100"];
const CUSTOM = "__custom__";

const t3 = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);

// Same normalisation the server uses for a batch's input lines.
const getInputLines = (batch) => {
  if (!batch) return [];
  let raw = [];
  if (Array.isArray(batch.materials_data) && batch.materials_data.length > 0) {
    raw = batch.materials_data.map((m) => ({
      material_id: Number(m.material_id),
      input_qty: Number(m.input_qty),
      pack_size: m.pack_size != null ? Number(m.pack_size) : null,
      bag_count: m.bag_count != null ? Number(m.bag_count) : null,
    }));
  } else if (batch.material_id) {
    raw = [{ material_id: Number(batch.material_id), input_qty: Number(batch.input_qty), pack_size: null, bag_count: null }];
  }
  // a stable key per line (same material + size can appear twice)
  const seen = {};
  return raw.map((l, index) => {
    const base = `${l.material_id}|${l.pack_size ?? ""}`;
    seen[base] = (seen[base] || 0) + 1;
    return { ...l, index, key: `${base}|${seen[base]}` };
  });
};

let rowSeq = 0;
const newRow = (lineKey) => ({
  id: `r${(rowSeq += 1)}`,
  line_key: lineKey,
  material_id: "",
  pack_size: "25",
  custom_pack_size: "",
  accepted_bags: "",
  rejected_bags: "",
  remark: "",
});

const sizeOf = (row) => Number(row.pack_size === CUSTOM ? row.custom_pack_size : row.pack_size) || 0;
const bagsOf = (row) => (Number(row.accepted_bags) || 0) + (Number(row.rejected_bags) || 0);
const isBlank = (row) => !row.material_id && !row.accepted_bags && !row.rejected_bags;

const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", boxSizing: "border-box" };
const GRID = "minmax(190px, 2.2fr) 112px 104px 104px minmax(120px, 1.3fr) 84px 30px";

export default function ProductionOutputPanel({
  batch,
  getMaterialLabel = (id) => `#${id}`,
  getWarehouseLabel = (id) => `#${id}`,
  onCancel,
  onFinalized,
  onRemoveInput, // (line) => Promise — only offered while the batch is pending
  onAddInput, // () => void — opens the existing "add material to batch" panel
  busyInputKey = null,
}) {
  const lines = useMemo(() => getInputLines(batch), [batch]);
  const lineSignature = lines.map((l) => l.key).join(",");

  const [rows, setRows] = useState(() => lines.map((l) => newRow(l.key)));
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Keep the output rows in step when input lines are added / removed
  // (rows of a removed line go away; a new line starts with one empty row).
  useEffect(() => {
    setRows((prev) => {
      const keys = new Set(lines.map((l) => l.key));
      const kept = prev.filter((r) => keys.has(r.line_key));
      const withRows = new Set(kept.map((r) => r.line_key));
      const added = lines.filter((l) => !withRows.has(l.key)).map((l) => newRow(l.key));
      return added.length || kept.length !== prev.length ? [...kept, ...added] : prev;
    });
  }, [lineSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = (lineKey) => setRows((prev) => {
    const lastOfLine = prev.map((r) => r.line_key).lastIndexOf(lineKey);
    const copy = [...prev];
    copy.splice(lastOfLine + 1, 0, newRow(lineKey));
    return copy;
  });
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  // ---------- numbers ----------
  const perLine = lines.map((line) => {
    const mine = rows.filter((r) => r.line_key === line.key);
    const acceptedKg = mine.reduce((s, r) => s + (Number(r.accepted_bags) || 0) * sizeOf(r), 0);
    const rejectedKg = mine.reduce((s, r) => s + (Number(r.rejected_bags) || 0) * sizeOf(r), 0);
    const inputKg = line.input_qty * 1000;
    const usedKg = acceptedKg + rejectedKg;
    return { line, mine, acceptedKg, rejectedKg, inputKg, usedKg, over: usedKg > inputKg + 0.5 };
  });
  const totals = perLine.reduce(
    (s, p) => ({ input: s.input + p.inputKg, accepted: s.accepted + p.acceptedKg, rejected: s.rejected + p.rejectedKg }),
    { input: 0, accepted: 0, rejected: 0 }
  );
  const anyOver = perLine.some((p) => p.over);

  // ---------- submit ----------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!destination) {
      setError("Select the destination warehouse for the output.");
      return;
    }
    const outputs = [];
    for (const p of perLine) {
      const name = getMaterialLabel(p.line.material_id);
      let complete = 0;
      for (const r of p.mine) {
        if (isBlank(r)) continue;
        if (!r.material_id) return setError(`${name}: pick the output material on every row that has bags.`);
        if (!(sizeOf(r) > 0)) return setError(`${name}: enter a bag size for ${getMaterialLabel(r.material_id)}.`);
        const acc = Number(r.accepted_bags) || 0;
        const rej = Number(r.rejected_bags) || 0;
        if (!Number.isInteger(acc) || !Number.isInteger(rej) || acc < 0 || rej < 0) {
          return setError(`${name}: bags must be whole numbers (0 or more).`);
        }
        if (acc + rej <= 0) return setError(`${name}: enter accepted and/or rejected bags for ${getMaterialLabel(r.material_id)}.`);
        complete += 1;
        outputs.push({
          source_index: p.line.index,
          material_id: Number(r.material_id),
          pack_size: sizeOf(r),
          accepted_bags: acc,
          rejected_bags: rej,
          remark: r.remark || undefined,
        });
      }
      if (complete === 0) return setError(`Add at least one output for ${name}.`);
      if (p.over) {
        return setError(`${name}: output ${t3(p.usedKg / 1000)} tons is more than the ${t3(p.inputKg / 1000)} tons used as input.`);
      }
    }

    setSaving(true);
    try {
      const res = await finalizeProductionBatchApi(batch.id, {
        destination_warehouse_id: Number(destination),
        outputs,
      });
      onFinalized && onFinalized(res.data);
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not finalize this batch");
    } finally {
      setSaving(false);
    }
  };

  // ---------- render ----------
  return (
    <div style={{ background: "#f0f9ff", padding: 20, borderRadius: 8, marginTop: 20, border: "2px solid #3b82f6" }}>
      <h3 style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>
          Production Output — {batch?.batch_no}
          <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" }}>
            pending
          </span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {onAddInput && (
            <button type="button" className="dt-btn" onClick={onAddInput}>
              + Input Material
            </button>
          )}
          <button type="button" className="sf-cancel" onClick={onCancel}>
            Back (keep pending)
          </button>
        </span>
      </h3>

      <p className="field-hint">
        For each input material below, add the materials it was turned into — pick the output material, bag size and the
        accepted / rejected bags. Output of one input can't be more than that input (less is fine). Then choose the
        destination warehouse and finalize. Leaving this screen keeps the batch <b>pending</b>; continue it any time from
        Production History.
      </p>

      {error && <div className="dt-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {perLine.map((p, lineNo) => {
          const { line } = p;
          const duplicateMaterial = lines.filter((l) => l.material_id === line.material_id).length > 1;
          const canRemoveInput = onRemoveInput && lines.length > 1 && !duplicateMaterial;
          const pct = p.inputKg > 0 ? Math.min(100, (p.usedKg / p.inputKg) * 100) : 0;
          const barColor = p.over ? "#dc2626" : pct >= 90 ? "#f59e0b" : "#22c55e";
          const left = (p.inputKg - p.usedKg) / 1000;

          return (
            <div
              key={line.key}
              style={{ background: "#fff", border: p.over ? "1px solid #fca5a5" : "1px solid #dbeafe", borderRadius: 8, padding: 14, marginBottom: 14 }}
            >
              {/* input header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "#9a3412" }}>
                    INPUT {lines.length > 1 ? `#${lineNo + 1}` : ""}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{getMaterialLabel(line.material_id)}</div>
                  <div style={{ fontSize: 13, color: "#475569" }}>
                    {t3(line.input_qty)} tons
                    {line.pack_size && line.bag_count ? ` · ${line.bag_count} bags × ${line.pack_size} kg` : ""} · from{" "}
                    {getWarehouseLabel(batch?.warehouse_id)}
                  </div>
                </div>
                {canRemoveInput && (
                  <button
                    type="button"
                    className="sf-cancel"
                    disabled={busyInputKey === line.key}
                    onClick={() => onRemoveInput(line)}
                  >
                    {busyInputKey === line.key ? "…" : "Remove input"}
                  </button>
                )}
              </div>

              {/* usage bar */}
              <div style={{ margin: "10px 0 12px" }}>
                <div style={{ height: 8, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: barColor, transition: "width 0.15s" }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 6, fontSize: 12.5, color: p.over ? "#dc2626" : "#475569" }}>
                  <span><b>Accepted</b> {t3(p.acceptedKg / 1000)} t</span>
                  <span><b>Rejected</b> {t3(p.rejectedKg / 1000)} t</span>
                  <span><b>Output</b> {t3(p.usedKg / 1000)} of {t3(p.inputKg / 1000)} t</span>
                  <span style={{ fontWeight: 600 }}>
                    {p.over ? `Over by ${t3(-left)} t — reduce the bags` : `${t3(left)} t unused / loss`}
                  </span>
                </div>
              </div>

              {/* output rows */}
              <div>
                <div style={{ minWidth: 760 }}>
                  <div
                    style={{
                      display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "0 2px 6px",
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#64748b",
                    }}
                  >
                    <span>OUTPUT ITEM</span><span>BAG SIZE (KG)</span><span>ACCEPTED BAGS</span><span>REJECTED BAGS</span><span>REMARK</span><span>QTY (T)</span><span />
                  </div>

                  {p.mine.map((r, i) => {
                    const total = (sizeOf(r) * bagsOf(r)) / 1000;
                    return (
                      <div key={r.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: "#64748b", margin: "0 2px 3px", fontWeight: 600 }}>
                          {i === 0 ? "Main output" : `Co-product ${i}`}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "start" }}>
                          <EntitySelect
                            entity="material"
                            value={r.material_id}
                            onChange={(id) => updateRow(r.id, { material_id: id })}
                            placeholder="Search output material…"
                            creatable
                          />
                          <div>
                            <select
                              value={r.pack_size}
                              onChange={(e) => updateRow(r.id, { pack_size: e.target.value })}
                              style={inputStyle}
                            >
                              {PACK_PRESETS.map((s) => (
                                <option key={s} value={s}>{s} kg</option>
                              ))}
                              <option value={CUSTOM}>Custom…</option>
                            </select>
                            {r.pack_size === CUSTOM && (
                              <input
                                type="number" min="0.01" step="0.01" placeholder="kg per bag"
                                value={r.custom_pack_size}
                                onChange={(e) => updateRow(r.id, { custom_pack_size: e.target.value })}
                                style={{ ...inputStyle, marginTop: 4 }}
                              />
                            )}
                          </div>
                          <input
                            type="number" min="0" step="1" placeholder="0" value={r.accepted_bags}
                            onChange={(e) => updateRow(r.id, { accepted_bags: e.target.value })}
                            style={inputStyle}
                          />
                          <input
                            type="number" min="0" step="1" placeholder="0" value={r.rejected_bags}
                            onChange={(e) => updateRow(r.id, { rejected_bags: e.target.value })}
                            style={{ ...inputStyle, borderColor: Number(r.rejected_bags) > 0 ? "#fca5a5" : "#d1d5db" }}
                          />
                          <input
                            type="text" placeholder="Optional" value={r.remark} maxLength={200}
                            onChange={(e) => updateRow(r.id, { remark: e.target.value })}
                            style={inputStyle}
                          />
                          <div style={{ padding: "9px 2px", fontSize: 13, fontWeight: 600, color: total > 0 ? "#0f172a" : "#94a3b8" }}>
                            {total > 0 ? t3(total) : "—"}
                          </div>
                          {p.mine.length > 1 ? (
                            <button
                              type="button" title="Remove this output row" onClick={() => removeRow(r.id)}
                              style={{ border: "none", background: "transparent", color: "#dc2626", fontSize: 18, cursor: "pointer", padding: "6px 0" }}
                            >
                              ×
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button type="button" className="dt-btn" onClick={() => addRow(line.key)} style={{ marginTop: 4 }}>
                + Add Co-Product
              </button>
            </div>
          );
        })}

        {/* overall + destination */}
        <div style={{ background: "#fff", border: "1px solid #dbeafe", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginBottom: 12, fontSize: 14 }}>
            <span>Total input <b>{t3(totals.input / 1000)} t</b></span>
            <span style={{ color: "#15803d" }}>Accepted <b>{t3(totals.accepted / 1000)} t</b></span>
            <span style={{ color: "#b91c1c" }}>Rejected <b>{t3(totals.rejected / 1000)} t</b></span>
            <span style={{ color: "#475569" }}>Unused / loss <b>{t3((totals.input - totals.accepted - totals.rejected) / 1000)} t</b></span>
          </div>
          <div style={{ maxWidth: 420 }}>
            <EntitySelect
              entity="warehouse"
              label="Destination Warehouse (for all accepted output)"
              value={destination}
              onChange={(id) => setDestination(id)}
              required
              creatable
            />
          </div>
          {destination && totals.accepted > 0 && (
            <div style={{ fontSize: 12.5, color: "#475569", marginTop: 6 }}>
              {t3(totals.accepted / 1000)} tons will be added to {getWarehouseLabel(destination)}; {t3(totals.input / 1000)} tons will be
              deducted from {getWarehouseLabel(batch?.warehouse_id)}.
            </div>
          )}
        </div>

        <button className="sf-submit" type="submit" disabled={saving || anyOver} style={{ width: "100%" }}>
          {saving ? "Finalizing…" : anyOver ? "Output is more than the input" : "Finalize Batch"}
        </button>
      </form>
    </div>
  );
}
