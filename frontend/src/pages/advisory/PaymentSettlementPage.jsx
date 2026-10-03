import { useState, useEffect } from "react";
import {
  getPaymentSettlementsApi,
  createPaymentSettlementApi,
  deletePaymentSettlementApi,
  getPaymentSettlementPdfApi,
  searchSettlementSourcesApi,
  getSettlementSourceApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import PdfPreviewModal from "../../components/PdfPreviewModal";
import ModuleGuide from "../../components/ModuleGuide";

// "Payment Settlement Advice" — made AGAINST A TRUCK'S GATE PASS (GP No.).
// Pick the truck (search by GP No., SO No., PO No., vehicle or party) and the
// form fills itself from what the system already knows: party, GST, lorry,
// weighbridge weights, item rows with bags and rate, and — for a partly
// loaded order — the SAUDA / INWARD DETAILS / PENDING SAUDA block. What the
// system can't know (invoice no., TDS, quality difference, balance freight...)
// stays for manual entry, tagged exactly like the mill's Excel sheet.
//
// All weights are in KG; Commission and Less Dana price per real 100kg
// quintal — see paymentSettlement.controller.js for the exact formulas.
// A settlement can still be typed in completely by hand (no truck picked).

const COMMISSION_OPTIONS = ["10/Qntl", "20/Qntl", "1%", "1.5%", "2%"]; // the Excel's dropdown

const emptyItem = (is_return = false) => ({ item_name: is_return ? "Return" : "Rice", bags: "", weight: "", rate: "", is_return });

const makeEmptyForm = () => ({
  gate_entry_id: "",
  gp_no: "", settlement_date: new Date().toISOString().slice(0, 10), party_name: "", lorry_no: "",
  invoice_number_dated: "", gst_number: "", party_mobile: "", broker_name: "", broker_pan: "",
  load_weight: "", empty_weight: "", less_bag_weight: "0", less_moisture: "0", less_misc: "0",
  items: [emptyItem(false), emptyItem(true)],
  tds_amount: "0", less_dana_pct: "0", quality_difference: "0",
  commission_type: "commission", commission_input: "",
  cd_pct: "0", balance_freight: "0", less_hammali: "0", rounded_value: "0",
  sauda_date: "", sauda: "", inward_details: [], pending_sauda: "",
  payment_through: "", payment_date: "",
  remarks: "THE ABOVE DEDUCTION ARE AS PER BARGAIN CONDITION.\nPLEASE DON'T ACCEPT DRAFT/PAYMENT, IF THE DEDUCTION IS NOT ACCEPTABLE.",
});

// Mirrors paymentSettlement.controller.js's computeTotals() exactly, for a
// live preview before saving.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toQuintal = (kg) => (Number(kg) || 0) / 100;
const computeCommission = (input, totalWeightKg, totalAmount) => {
  const str = String(input ?? "").trim();
  if (!str) return 0;
  const perQtl = str.match(/^([\d.]+)\s*\/\s*qt?l?/i);
  if (perQtl) return round2(toQuintal(totalWeightKg) * Number(perQtl[1]));
  if (str.endsWith("%")) return round2((totalAmount * Number(str.slice(0, -1))) / 100);
  const num = Number(str);
  if (!Number.isNaN(num)) return round2(totalAmount * num);
  return 0;
};
const computeTotals = (f) => {
  const netWeight = round2(Number(f.load_weight) - Number(f.empty_weight));
  const finalNetWeight = round2(netWeight - Number(f.less_bag_weight || 0) - Number(f.less_moisture || 0) - Number(f.less_misc || 0));
  const items = f.items.map((it) => ({
    ...it,
    bags: Number(it.bags) || 0,
    weight: it.weight !== "" && it.weight != null ? Number(it.weight) : (it.is_return ? 0 : finalNetWeight),
    rate: Number(it.rate) || 0,
  })).map((it) => ({ ...it, amount: round2(it.weight * it.rate) }));
  const main = items.filter((i) => !i.is_return);
  const ret = items.filter((i) => i.is_return);
  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
  const totalBags = sum(main, "bags") - sum(ret, "bags");
  const totalWeight = round2(sum(main, "weight") - sum(ret, "weight"));
  const rate = main.find((r) => r.rate)?.rate || 0;
  const totalAmount = round2(sum(main, "amount") - sum(ret, "amount"));
  const danaAmount = round2(totalWeight * ((Number(f.less_dana_pct) || 0) / 100) * rate);
  const commissionAmount = computeCommission(f.commission_input, totalWeight, totalAmount);
  const cdAmount = round2((totalAmount * (Number(f.cd_pct) || 0)) / 100);
  const tds = round2(f.tds_amount), qualityDifference = round2(f.quality_difference);
  const hammali = round2(f.less_hammali), roundedValue = round2(f.rounded_value), balanceFreight = round2(f.balance_freight);
  // Whichever of Commission / Trade Discount is selected is deducted.
  const netPayableAmount = round2(totalAmount - tds - danaAmount - qualityDifference - commissionAmount - cdAmount - balanceFreight - hammali + roundedValue);
  const brokerageAmount = f.commission_type === "trade_discount" ? 0 : commissionAmount;
  return { netWeight, finalNetWeight, items, totalBags, totalWeight, rate, totalAmount, danaAmount, commissionAmount, cdAmount, netPayableAmount, brokerageAmount };
};

// The Excel's AUTO FETCH / MANUAL ENTRY / AUTO CALCULATE tags, next to each field.
const TAGS = {
  auto: { text: "AUTO", color: "#0b5cad", bg: "#e3effc" },
  calc: { text: "AUTO CALC", color: "#046c4e", bg: "#d8f3e8" },
  manual: { text: "MANUAL", color: "#9a5b00", bg: "#fdecc8" },
  optional: { text: "OPTIONAL", color: "#4b5563", bg: "#eceff3" },
};
const Tag = ({ kind }) => {
  const t = TAGS[kind];
  return (
    <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: t.color, background: t.bg, verticalAlign: "middle" }}>
      {t.text}
    </span>
  );
};

const TYPE_LABEL = { purchase: "Purchase", sales: "Sales", other: "Empty / Misc" };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");
const hint = { fontSize: 11.5, color: "#64748b", marginTop: 3 };

export default function PaymentSettlementPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(makeEmptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);

  // truck search + the truck currently being settled
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null); // { gp_no, order_no, entry_type }
  const [notices, setNotices] = useState([]);
  const [fetching, setFetching] = useState(false);

  const load = () => {
    setLoading(true);
    getPaymentSettlementsApi()
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load payment settlements"))
      .finally(() => setLoading(false));
  };
  const runSearch = (q = query) => {
    setSearching(true);
    searchSettlementSourcesApi(q)
      .then((res) => setSources(res.data.data ?? []))
      .catch(() => setError("Couldn't search trucks"))
      .finally(() => setSearching(false));
  };
  useEffect(() => {
    load();
    runSearch("");
  }, []);

  const fromAuto = !!form.gate_entry_id;

  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm({ ...form, [name]: e.target.value }),
  });

  const updateItem = (idx, key, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [key]: value };
    setForm({ ...form, items });
  };
  const addItemRow = () => setForm({ ...form, items: [...form.items, emptyItem(false)] });
  const removeItemRow = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const updateInward = (idx, key, value) => {
    const inward_details = [...form.inward_details];
    inward_details[idx] = { ...inward_details[idx], [key]: value };
    setForm({ ...form, inward_details });
  };
  const addInwardRow = () => setForm({ ...form, inward_details: [...form.inward_details, { date: "", weight: "" }] });
  const removeInwardRow = (idx) => setForm({ ...form, inward_details: form.inward_details.filter((_, i) => i !== idx) });

  const useSource = async (src) => {
    setError("");
    setInfo("");
    if (
      src.settlement_id &&
      !window.confirm(`A settlement already exists for ${src.gp_no} (#${src.settlement_id}).\n\nCreate another one for the same GP?`)
    ) {
      return;
    }
    setFetching(true);
    try {
      const res = await getSettlementSourceApi(src.gate_entry_id);
      const data = res.data.data ?? res.data;
      setForm({ ...makeEmptyForm(), ...data.form });
      setPicked({ gp_no: data.form.gp_no, order_no: data.order_no, entry_type: data.entry_type });
      setNotices(data.notices || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't fetch that truck's details");
    } finally {
      setFetching(false);
    }
  };

  const clearPicked = () => {
    if (!window.confirm("Clear the fetched details and start a blank settlement?")) return;
    setForm(makeEmptyForm());
    setPicked(null);
    setNotices([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setSaving(true);
    try {
      await createPaymentSettlementApi(form);
      setInfo(`Saved settlement for ${form.party_name}${form.gp_no ? ` (${form.gp_no})` : ""}.`);
      setForm(makeEmptyForm());
      setPicked(null);
      setNotices([]);
      load();
      runSearch(query);
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this settlement?")) return;
    try {
      await deletePaymentSettlementApi(id);
      load();
      runSearch(query);
    } catch {
      setError("Delete failed");
    }
  };

  const handleViewPdf = async (row) => {
    setError("");
    try {
      const res = await getPaymentSettlementPdfApi(row.id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPdfPreview({ url, fileName: `settlement-${row.id}.pdf`, title: `Payment Settlement — ${row.party_name}` });
    } catch {
      setError("Couldn't generate the PDF");
    }
  };

  const c = computeTotals(form);
  const isTradeDiscount = form.commission_type === "trade_discount";
  const inwardTotal = form.inward_details.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const danaGrams = Number(form.less_dana_pct) ? Number((Number(form.less_dana_pct) * 1000).toFixed(2)) : 0;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Payment Settlement Advice</h2>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Settle against a truck's Gate Pass: find it below and the details fill in automatically. Weights are in kg;
        Commission and Less Dana price per real 100kg quintal (e.g. "10/Qntl" or "1%").
      </p>
      <p style={{ ...hint, marginTop: -2 }}>
        <Tag kind="auto" /> filled from the truck &nbsp; <Tag kind="calc" /> calculated for you &nbsp;
        <Tag kind="manual" /> you enter &nbsp; <Tag kind="optional" /> only if needed
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-info">{info}</div>}

      {/* ---- find the truck / order ---- */}
      <div style={{ border: "1px solid #dbe3ee", borderRadius: 8, padding: 14, marginBottom: 16, background: "#f8fafc" }}>
        <strong>Find the truck to settle</strong>
        <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
          <input
            style={{ flex: "1 1 280px", minWidth: 220 }}
            value={query}
            placeholder="GP No., SO No., PO No., vehicle or party"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
          />
          <button type="button" className="dt-btn" onClick={() => runSearch()} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {picked && (
          <div className="dt-info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>
              Settling against <strong>{picked.gp_no}</strong> ({TYPE_LABEL[picked.entry_type] || picked.entry_type}
              {picked.order_no ? ` · ${picked.order_no}` : ""})
            </span>
            <button type="button" className="dt-btn" onClick={clearPicked}>Clear</button>
          </div>
        )}

        <div style={{ maxHeight: 230, overflowY: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b", fontSize: 12 }}>
                <th>GP No.</th><th>Type</th><th>Party</th><th>SO / PO</th><th>Vehicle</th><th>Exit</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.gate_entry_id} style={{ borderTop: "1px solid #e5eaf1" }}>
                  <td><strong>{s.gp_no}</strong></td>
                  <td>{TYPE_LABEL[s.entry_type] || s.entry_type}</td>
                  <td>{s.party_name || "—"}</td>
                  <td>{s.order_no || "—"}</td>
                  <td>{s.vehicle_no || "—"}</td>
                  <td>{fmtDate(s.exit_time)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s.settlement_id && <span className="dt-badge" style={{ marginRight: 6 }}>Settled #{s.settlement_id}</span>}
                    <button type="button" className="dt-btn" disabled={fetching} onClick={() => useSource(s)}>
                      {fetching ? "…" : "Use"}
                    </button>
                  </td>
                </tr>
              ))}
              {!sources.length && !searching && (
                <tr><td colSpan={7} style={{ color: "#64748b", padding: "8px 0" }}>No checked-out truck matches. Only trucks that have exited the gate (and so have a Gate Pass) can be settled.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {notices.length > 0 && (
        <div className="dt-info" style={{ marginBottom: 12 }}>
          <strong>Auto-filled from {picked?.gp_no}:</strong>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {notices.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field"><label>G.P. No.<Tag kind="auto" /></label><input {...field("gp_no")} /></div>
        <div className="sf-field"><label>Date<Tag kind="auto" /></label><input type="date" {...field("settlement_date")} required /></div>
        <div className="sf-field"><label>Party Name<Tag kind="auto" /></label><input {...field("party_name")} required /></div>
        <div className="sf-field"><label>Lorry No.<Tag kind="auto" /></label><input {...field("lorry_no")} /></div>
        <div className="sf-field"><label>Invoice Number/Dated<Tag kind="manual" /></label><input {...field("invoice_number_dated")} placeholder="e.g. 25/27-08-2026" /></div>
        <div className="sf-field">
          <label>GST Number<Tag kind={form.gst_number && fromAuto ? "auto" : "optional"} /></label>
          <input {...field("gst_number")} />
        </div>
        <div className="sf-field"><label>Party Mobile Number<Tag kind="optional" /></label><input {...field("party_mobile")} /></div>
        <div className="sf-field"><label>Broker Name<Tag kind="optional" /></label><input {...field("broker_name")} /></div>
        <div className="sf-field"><label>Broker PAN<Tag kind="optional" /></label><input {...field("broker_pan")} /></div>

        <div className="sf-field"><label>Load Weight (kg)<Tag kind="auto" /></label><input type="number" step="0.01" {...field("load_weight")} required /></div>
        <div className="sf-field"><label>Empty Weight (kg)<Tag kind="auto" /></label><input type="number" step="0.01" {...field("empty_weight")} required /></div>
        <div className="sf-field"><label>Net Weight (kg)<Tag kind="calc" /></label><input value={c.netWeight} readOnly /></div>
        <div className="sf-field"><label>Less — Bag Weight (kg)<Tag kind="optional" /></label><input type="number" step="0.01" {...field("less_bag_weight")} /></div>
        <div className="sf-field"><label>Less — Moisture (kg)<Tag kind="optional" /></label><input type="number" step="0.01" {...field("less_moisture")} /></div>
        <div className="sf-field"><label>Less — Misc (kg)<Tag kind="optional" /></label><input type="number" step="0.01" {...field("less_misc")} /></div>
        <div className="sf-field"><label>Net Weight after deductions (kg)<Tag kind="calc" /></label><input value={c.finalNetWeight} readOnly /></div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontWeight: 600 }}>Items<Tag kind="auto" /></label>
          <table style={{ width: "100%", marginTop: 4, marginBottom: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: "#666" }}>
                <th>Item</th><th>Bags</th><th>Weight (kg, blank = net weight)</th><th>Rate (Rs/kg)</th><th>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx}>
                  <td><input value={it.item_name} onChange={(e) => updateItem(idx, "item_name", e.target.value)} style={{ width: 130 }} /></td>
                  <td><input type="number" value={it.bags} onChange={(e) => updateItem(idx, "bags", e.target.value)} style={{ width: 70 }} /></td>
                  <td><input type="number" step="0.01" value={it.weight} onChange={(e) => updateItem(idx, "weight", e.target.value)} placeholder={it.is_return ? "0" : String(c.finalNetWeight)} style={{ width: 110 }} /></td>
                  <td><input type="number" step="0.01" value={it.rate} onChange={(e) => updateItem(idx, "rate", e.target.value)} style={{ width: 80 }} /></td>
                  <td>{c.items[idx]?.amount ?? 0}</td>
                  <td><button type="button" className="dt-btn" onClick={() => removeItemRow(idx)}>x</button></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td>TOTAL</td><td>{c.totalBags}</td><td>{c.totalWeight}</td><td>{c.rate}</td><td>{c.totalAmount}</td><td></td>
              </tr>
            </tbody>
          </table>
          <button type="button" className="dt-btn" onClick={addItemRow}>+ Add Item Row</button>
        </div>

        <div className="sf-field"><label>TDS (amount)<Tag kind="manual" /></label><input type="number" step="0.01" {...field("tds_amount")} /></div>
        <div className="sf-field">
          <label>Less Dana (%)<Tag kind="calc" /></label>
          <input type="number" step="0.001" {...field("less_dana_pct")} placeholder="e.g. 0.3" />
          <div style={hint}>{danaGrams ? `= ${danaGrams} gram per quintal → Rs ${c.danaAmount}` : "0.3 = 300 gram per quintal"}</div>
        </div>
        <div className="sf-field"><label>Quality Difference (amount)<Tag kind="manual" /></label><input type="number" step="0.01" {...field("quality_difference")} /></div>

        <div className="sf-field">
          <label>Commission / Trade Discount<Tag kind="calc" /></label>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={form.commission_type} onChange={(e) => setForm({ ...form, commission_type: e.target.value })} style={{ flex: "0 0 150px" }}>
              <option value="commission">Commission</option>
              <option value="trade_discount">Trade Discount</option>
            </select>
            <input
              list="commission-options"
              style={{ flex: 1 }}
              {...field("commission_input")}
              placeholder='pick or type, e.g. "10/Qntl" or "1%"'
            />
            <datalist id="commission-options">
              {COMMISSION_OPTIONS.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
          <div style={hint}>
            {isTradeDiscount ? "Trade Discount" : "Commission"} → Rs {c.commissionAmount}, deducted from Net Payable
            {isTradeDiscount ? " (not counted as brokerage)." : " and shown under Brokerage Details."}
          </div>
        </div>

        <div className="sf-field">
          <label>CD (%)<Tag kind="calc" /></label>
          <input type="number" step="0.001" {...field("cd_pct")} />
          <div style={hint}>→ Rs {c.cdAmount}</div>
        </div>
        <div className="sf-field"><label>Balance Freight (amount)<Tag kind="manual" /></label><input type="number" step="0.01" {...field("balance_freight")} /></div>
        <div className="sf-field"><label>Less Hammali (amount)<Tag kind="optional" /></label><input type="number" step="0.01" {...field("less_hammali")} /></div>
        <div className="sf-field"><label>Rounded Value (+/-)<Tag kind="optional" /></label><input type="number" step="0.01" {...field("rounded_value")} /></div>

        <div className="sf-field">
          <label style={{ fontWeight: 700 }}>Net Payable Amount<Tag kind="calc" /></label>
          <input value={c.netPayableAmount} readOnly style={{ fontWeight: 700 }} />
        </div>

        {/* ---- Lorry freight payment details ---- */}
        <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          <strong>Lorry Freight Payment Details</strong>
          <span style={{ ...hint, marginLeft: 8 }}>
            Sauda, every load against the order so far, and what's still pending
          </span>
        </div>
        <div className="sf-field"><label>Sauda Date<Tag kind="auto" /></label><input type="date" {...field("sauda_date")} /></div>
        <div className="sf-field"><label>Sauda<Tag kind="auto" /></label><input {...field("sauda")} placeholder="e.g. 60MT" /></div>
        <div className="sf-field">
          <label>Pending Sauda<Tag kind="auto" /></label>
          <input {...field("pending_sauda")} placeholder={fromAuto ? "empty = order fully loaded" : "e.g. 3.45MT"} />
          {form.pending_sauda && <div style={hint}>The order is only partly loaded.</div>}
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontWeight: 600 }}>Inward Details<Tag kind="auto" /></label>
          <table style={{ marginTop: 4, marginBottom: 6 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: "#666" }}><th>Date</th><th>Weight (kg)</th><th></th></tr>
            </thead>
            <tbody>
              {form.inward_details.map((r, idx) => (
                <tr key={idx}>
                  <td><input type="date" value={r.date || ""} onChange={(e) => updateInward(idx, "date", e.target.value)} /></td>
                  <td><input type="number" step="0.01" value={r.weight} onChange={(e) => updateInward(idx, "weight", e.target.value)} style={{ width: 120 }} /></td>
                  <td><button type="button" className="dt-btn" onClick={() => removeInwardRow(idx)}>x</button></td>
                </tr>
              ))}
              {form.inward_details.length > 0 && (
                <tr style={{ fontWeight: 600 }}><td>TOTAL</td><td>{inwardTotal}</td><td></td></tr>
              )}
            </tbody>
          </table>
          <button type="button" className="dt-btn" onClick={addInwardRow}>+ Add Inward Row</button>
        </div>

        <div className="sf-field"><label>Brokerage Amount<Tag kind="calc" /></label><input value={c.brokerageAmount} readOnly /></div>
        <div className="sf-field"><label>Payment Through<Tag kind="optional" /></label><input {...field("payment_through")} /></div>
        <div className="sf-field"><label>Payment Date<Tag kind="optional" /></label><input type="date" {...field("payment_date")} /></div>
        <div className="sf-field" style={{ gridColumn: "1 / -1" }}>
          <label>Remark<Tag kind="optional" /></label>
          <textarea rows={2} {...field("remarks")} />
        </div>

        <button className="sf-submit" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Settlement"}
        </button>
      </form>

      <h3 style={{ marginTop: 24 }}>Saved Settlements</h3>
      <DataTable
        loading={loading}
        rows={rows}
        onDelete={handleDelete}
        columns={[
          { key: "settlement_date", label: "Date" },
          { key: "gp_no", label: "G.P. No.", render: (row) => row.gp_no || "—" },
          { key: "party_name", label: "Party" },
          { key: "lorry_no", label: "Lorry No." },
          { key: "broker_name", label: "Broker" },
          { key: "computed", label: "Net Payable", render: (row) => row.computed?.netPayableAmount ?? "—" },
          {
            key: "pdf",
            label: "PDF",
            render: (row) => <button className="dt-btn" onClick={() => handleViewPdf(row)}>View</button>,
          },
        ]}
      />

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

      <ModuleGuide
        title="Payment Settlement Advice"
        steps={[
          "Search for the truck by GP No., SO No., PO No., vehicle or party and click Use — the party, GST, lorry, weights, items, rate and the Sauda / Inward / Pending block fill in automatically. Only trucks that have checked out (and so have a Gate Pass) are listed.",
          "Fields are tagged like the mill's Excel: AUTO (from the truck), AUTO CALC (worked out for you), MANUAL (you enter it) and OPTIONAL (only if needed). You can overwrite any auto-filled value.",
          "If the order was only partly loaded, Pending Sauda shows what is still to be loaded, and Inward Details lists every load made against the order so far.",
          "Pick Commission or Trade Discount from the dropdown (one at a time) and a value like 10/Qntl, 1% or 2%. Whichever you choose is deducted from the Net Payable Amount; only Commission also appears under Brokerage Details.",
          "Net Payable Amount updates live as you type, exactly matching the printed PDF. Save, then click View on that row to open or download it.",
          "You can still type a settlement in completely by hand without picking a truck.",
        ]}
      />
    </div>
  );
}