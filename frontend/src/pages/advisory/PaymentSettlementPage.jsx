import { useState, useEffect } from "react";
import {
  getPaymentSettlementsApi,
  createPaymentSettlementApi,
  deletePaymentSettlementApi,
  getPaymentSettlementPdfApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import PdfPreviewModal from "../../components/PdfPreviewModal";
import ModuleGuide from "../../components/ModuleGuide";

// "Payment Settlement Advice" — the broker/lorry freight settlement slip
// handed to a buyer after an outward sale. All weights are in KG (matching
// the paper form and the weighbridge slip it comes from); Commission and
// Less Dana are the only figures priced per real 100kg quintal — see
// paymentSettlement.controller.js for the exact formulas, verified against
// a real filled-in example of this form.

const emptyItem = (is_return = false) => ({ item_name: is_return ? "Return" : "Rice", bags: "", weight: "", rate: "", is_return });

const emptyForm = {
  gp_no: "", settlement_date: new Date().toISOString().slice(0, 10), party_name: "", lorry_no: "",
  invoice_number_dated: "", gst_number: "", party_mobile: "", broker_name: "", broker_pan: "",
  load_weight: "", empty_weight: "", less_bag_weight: "0", less_moisture: "0", less_misc: "0",
  items: [emptyItem(false), emptyItem(true)],
  tds_amount: "0", less_dana_pct: "0", quality_difference: "0", commission_input: "",
  cd_pct: "0", less_hammali: "0", rounded_value: "0",
  sauda_date: "", sauda: "", inward_date: "", inward_weight: "", pending_sauda: "",
  payment_through: "", payment_date: "",
  remarks: "THE ABOVE DEDUCTION ARE AS PER BARGAIN CONDITION.\nPLEASE DON'T ACCEPT DRAFT/PAYMENT, IF THE DEDUCTION IS NOT ACCEPTABLE.",
};

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
  const hammali = round2(f.less_hammali), roundedValue = round2(f.rounded_value);
  const netPayableAmount = round2(totalAmount - tds - danaAmount - qualityDifference - commissionAmount - cdAmount - hammali + roundedValue);
  return { netWeight, finalNetWeight, items, totalBags, totalWeight, rate, totalAmount, danaAmount, commissionAmount, cdAmount, netPayableAmount };
};

export default function PaymentSettlementPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);

  const load = () => {
    setLoading(true);
    getPaymentSettlementsApi()
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load payment settlements"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setSaving(true);
    try {
      await createPaymentSettlementApi(form);
      setInfo(`Saved settlement for ${form.party_name}.`);
      setForm(emptyForm);
      load();
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

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Payment Settlement Advice</h2>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Broker/lorry freight settlement for an outward sale. Weights are in kg; Commission and Less Dana price per
        real 100kg quintal (e.g. "10/qtl" or "1%").
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-info">{info}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field"><label>G.P. No.</label><input {...field("gp_no")} /></div>
        <div className="sf-field"><label>Date</label><input type="date" {...field("settlement_date")} required /></div>
        <div className="sf-field"><label>Party Name</label><input {...field("party_name")} required /></div>
        <div className="sf-field"><label>Lorry No.</label><input {...field("lorry_no")} /></div>
        <div className="sf-field"><label>Invoice Number/Dated</label><input {...field("invoice_number_dated")} placeholder="e.g. 25/27-08-2026" /></div>
        <div className="sf-field"><label>GST Number</label><input {...field("gst_number")} /></div>
        <div className="sf-field"><label>Party Mobile Number</label><input {...field("party_mobile")} /></div>
        <div className="sf-field"><label>Broker Name</label><input {...field("broker_name")} /></div>
        <div className="sf-field"><label>Broker PAN</label><input {...field("broker_pan")} /></div>

        <div className="sf-field"><label>Load Weight (kg)</label><input type="number" step="0.01" {...field("load_weight")} required /></div>
        <div className="sf-field"><label>Empty Weight (kg)</label><input type="number" step="0.01" {...field("empty_weight")} required /></div>
        <div className="sf-field"><label>Net Weight (kg)</label><input value={c.netWeight} readOnly /></div>
        <div className="sf-field"><label>Less — Bag Weight (kg)</label><input type="number" step="0.01" {...field("less_bag_weight")} /></div>
        <div className="sf-field"><label>Less — Moisture (kg)</label><input type="number" step="0.01" {...field("less_moisture")} /></div>
        <div className="sf-field"><label>Less — Misc (kg)</label><input type="number" step="0.01" {...field("less_misc")} /></div>
        <div className="sf-field"><label>Net Weight after deductions (kg)</label><input value={c.finalNetWeight} readOnly /></div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ fontWeight: 600 }}>Items</label>
          <table style={{ width: "100%", marginTop: 4, marginBottom: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 12, color: "#666" }}>
                <th>Item</th><th>Bags</th><th>Weight (kg, blank = net weight)</th><th>Rate (Rs/kg)</th><th>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, idx) => (
                <tr key={idx}>
                  <td><input value={it.item_name} onChange={(e) => updateItem(idx, "item_name", e.target.value)} style={{ width: 100 }} /></td>
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

        <div className="sf-field"><label>TDS (amount)</label><input type="number" step="0.01" {...field("tds_amount")} /></div>
        <div className="sf-field"><label>Less Dana (%)</label><input type="number" step="0.001" {...field("less_dana_pct")} placeholder="e.g. 0.3" /></div>
        <div className="sf-field"><label>Quality Difference (amount)</label><input type="number" step="0.01" {...field("quality_difference")} /></div>
        <div className="sf-field"><label>Commission</label><input {...field("commission_input")} placeholder='e.g. "10/qtl" or "1%"' /></div>
        <div className="sf-field"><label>CD (%)</label><input type="number" step="0.001" {...field("cd_pct")} /></div>
        <div className="sf-field"><label>Less Hammali (amount)</label><input type="number" step="0.01" {...field("less_hammali")} /></div>
        <div className="sf-field"><label>Rounded Value (+/-)</label><input type="number" step="0.01" {...field("rounded_value")} /></div>

        <div className="sf-field">
          <label style={{ fontWeight: 700 }}>Net Payable Amount</label>
          <input value={c.netPayableAmount} readOnly style={{ fontWeight: 700 }} />
        </div>

        <div className="sf-field"><label>Sauda Date</label><input type="date" {...field("sauda_date")} /></div>
        <div className="sf-field"><label>Sauda</label><input {...field("sauda")} placeholder="e.g. 30MT" /></div>
        <div className="sf-field"><label>Inward Date</label><input type="date" {...field("inward_date")} /></div>
        <div className="sf-field"><label>Inward Weight (kg)</label><input type="number" step="0.01" {...field("inward_weight")} /></div>
        <div className="sf-field"><label>Pending Sauda</label><input {...field("pending_sauda")} /></div>

        <div className="sf-field"><label>Payment Through</label><input {...field("payment_through")} /></div>
        <div className="sf-field"><label>Payment Date</label><input type="date" {...field("payment_date")} /></div>
        <div className="sf-field" style={{ gridColumn: "1 / -1" }}>
          <label>Remark</label>
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
          "Enter the party/broker details, load/empty weight (kg) and item rows (Rice + Return, like the paper form).",
          "Commission and Less Dana price per real 100kg quintal — type Commission as '10/qtl' (flat per quintal) or '1%' (percent of total amount).",
          "Net Payable Amount updates live as you type, exactly matching the printed PDF.",
          "Save, then click View on that row to open/download the PDF.",
        ]}
      />
    </div>
  );
}