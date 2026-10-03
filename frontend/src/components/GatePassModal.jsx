import { useState, useEffect } from "react";
import { getGatePassDataApi, getGatePassPdfApi } from "../api/api";
import PdfPreviewModal from "./PdfPreviewModal";

// Gate Pass popup, opened from the Gate Entry list once a truck has checked
// out. Everything is auto-filled from the database; the boxes below are an
// OPTIONAL manual override — leave a box empty and the auto-filled value is
// used. Two copies are printed (ORIGINAL + ACCOUNTS). "View" opens the PDF in
// a preview (which has its own Download button); "Download" saves it directly.

const TYPE_LABEL = { purchase: "Purchase", sales: "Sales (Outbound)", other: "Empty / Misc" };

// A failed blob request carries its JSON error as a Blob — read the message out.
const errorMessageFrom = async (err, fallback) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text());
      return j.message || j.msg || fallback;
    } catch (e) {
      return fallback;
    }
  }
  return data?.message || data?.msg || fallback;
};

const cell = { padding: "4px 8px", borderBottom: "1px solid #e2e8f0", fontSize: 13 };

export default function GatePassModal({ entry, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getGatePassDataApi(entry.id)
      .then((res) => alive && setData(res.data.data ?? res.data))
      .catch(async (err) => alive && setError(await errorMessageFrom(err, "Failed to load the gate pass details")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.id]);

  // Free the preview's blob URL when it is closed / the popup goes away.
  useEffect(() => () => preview && URL.revokeObjectURL(preview.blobUrl), [preview]);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  const isStore = data?.pass_kind === "store";
  const showManualItems = isStore || (data && !data.auto_items_found);

  // Only what was actually typed is sent; empty boxes fall back to the database.
  const overrides = () => {
    const out = {};
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
    });
    return out;
  };

  const fetchPdf = async () => {
    setError("");
    try {
      const res = await getGatePassPdfApi(entry.id, overrides());
      return new Blob([res.data], { type: "application/pdf" });
    } catch (err) {
      setError(await errorMessageFrom(err, "Failed to generate the gate pass"));
      return null;
    }
  };

  const fileName = `${data?.gp_no || "gate-pass"}.pdf`;

  const handleView = async () => {
    setBusy("view");
    const blob = await fetchPdf();
    setBusy("");
    if (blob) setPreview({ blobUrl: URL.createObjectURL(blob), fileName });
  };

  const handleDownload = async () => {
    setBusy("download");
    const blob = await fetchPdf();
    setBusy("");
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // Empty/Misc fallback: pick items from a dropdown instead of typing them.
  const addItemFromList = (name) => {
    if (!name) return;
    const current = (form.items || "").trim() || data?.defaults?.items || "";
    const parts = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!parts.includes(name)) parts.push(name);
    setForm((f) => ({ ...f, items: parts.join(", ") }));
  };

  const ph = (key, fallback = "") => data?.defaults?.[key] || fallback;

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "40px 16px",
          zIndex: 900,
          overflowY: "auto",
        }}
        onClick={onClose}
      >
        <div
          style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 680, width: "100%" }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ marginTop: 0 }}>
            Gate Pass — {entry.token_no} ({entry.vehicle?.vehicle_no || data?.vehicle_no || ""})
          </h3>

          {loading && <p className="field-hint">Loading details…</p>}
          {error && <div className="dt-error">{error}</div>}

          {data && (
            <>
              <p className="field-hint" style={{ marginTop: -6 }}>
                {TYPE_LABEL[data.entry_type] || data.entry_type} · {data.title} · {data.gp_no} · two copies (Original + Accounts)
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "4px 24px",
                  fontSize: 13,
                  margin: "8px 0 12px",
                }}
              >
                <div><strong>Party:</strong> {data.party_name || "—"}</div>
                <div><strong>Vehicle:</strong> {data.vehicle_no || "—"}</div>
                <div><strong>Driver:</strong> {data.driver_name || "—"}</div>
                <div><strong>Date:</strong> {data.date_time}</div>
                {!isStore && (
                  <div>
                    <strong>Net weight:</strong> {data.net_weight ? `${data.net_weight} KG` : "not weighed — blank line on the pass"}
                  </div>
                )}
              </div>

              {!isStore && (
                <>
                  <strong style={{ fontSize: 13 }}>Items (auto-filled from the database)</strong>
                  {data.items.length ? (
                    <div style={{ overflowX: "auto", marginTop: 4 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                            {["Item", "Lab Decision", "Size", "Total", "Accp", "Rej", "Remarks"].map((h) => (
                              <th key={h} style={{ ...cell, fontWeight: 600 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((it, i) => (
                            <tr key={i}>
                              <td style={cell}>{it.item_name}</td>
                              <td style={cell}>{it.lab_decision}</td>
                              <td style={cell}>{it.size || "—"}</td>
                              <td style={cell}>{it.total || "—"}</td>
                              <td style={cell}>{it.accp || "—"}</td>
                              <td style={cell}>{it.rej || "—"}</td>
                              <td style={cell}>{it.remarks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="field-hint" style={{ marginTop: 4 }}>
                      No {data.entry_type === "purchase" ? "unloading" : "loading"} details were found for this truck, so
                      the table will print empty. You can type an item below, or fill it in by hand on the printout.
                    </p>
                  )}
                </>
              )}

              <h4 style={{ marginBottom: 2 }}>Manual entry (optional)</h4>
              <p className="field-hint" style={{ marginTop: 0 }}>
                Everything above is filled in automatically. Type in a box only to override it — leave it empty to keep the
                automatic value.
              </p>

              <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
                <div className="sf-field">
                  <label>Party</label>
                  <input value={form.party || ""} onChange={set("party")} placeholder={ph("party", "Party name")} />
                </div>
                <div className="sf-field">
                  <label>{isStore ? "Inv No." : "Challan / Inv No."}</label>
                  <input value={form.inv_no || ""} onChange={set("inv_no")} placeholder={ph("inv_no", "Invoice / challan no.")} />
                </div>
                {!isStore && (
                  <div className="sf-field">
                    <label>Net Weight (KG)</label>
                    <input
                      value={form.net_weight || ""}
                      onChange={set("net_weight")}
                      placeholder={ph("net_weight", "Leave empty to write by hand")}
                    />
                  </div>
                )}
                {isStore && (
                  <>
                    <div className="sf-field">
                      <label>Inv Value (₹)</label>
                      <input value={form.inv_value || ""} onChange={set("inv_value")} placeholder="e.g. 1000" />
                    </div>
                  </>
                )}
                {showManualItems && (
                  <>
                    <div className="sf-field">
                      <label>{isStore ? "Qty" : "Qty (bags)"}</label>
                      <input value={form.qty || ""} onChange={set("qty")} placeholder={ph("qty", "e.g. 1000 Nos")} />
                    </div>
                    <div className="sf-field" style={{ gridColumn: "1 / -1" }}>
                      <label>Items</label>
                      <input value={form.items || ""} onChange={set("items")} placeholder={ph("items", "Item name(s)")} />
                      {isStore && (data.item_suggestions || []).length > 0 && (
                        <select
                          value=""
                          onChange={(e) => addItemFromList(e.target.value)}
                          style={{ marginTop: 6 }}
                        >
                          <option value="">+ Add an item from the list…</option>
                          {data.item_suggestions.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </>
                )}
                <div className="sf-field" style={{ gridColumn: "1 / -1" }}>
                  <label>Remarks</label>
                  <input
                    value={form.remarks || ""}
                    onChange={set("remarks")}
                    placeholder={ph("remarks", isStore ? "Remarks" : "Applied to every item row")}
                  />
                </div>

                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="sf-submit" onClick={handleView} disabled={!!busy}>
                    {busy === "view" ? "Preparing…" : "View"}
                  </button>
                  <button type="button" className="dt-btn" onClick={handleDownload} disabled={!!busy}>
                    {busy === "download" ? "Preparing…" : "Download PDF"}
                  </button>
                  <button type="button" className="dt-btn" onClick={onClose}>
                    Close
                  </button>
                </div>
              </form>
            </>
          )}

          {!data && !loading && (
            <button type="button" className="dt-btn" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      {preview && (
        <PdfPreviewModal
          title={`Gate Pass — ${data?.gp_no || ""}`}
          blobUrl={preview.blobUrl}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}