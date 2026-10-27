import { useState, useEffect, useRef } from "react";
import {
  getLabTestsApi,
  getMasterSettingsApi,
  getCompositeReportsApi,
  getCompositeReportSourceApi,
  createCompositeReportApi,
  updateCompositeReportApi,
  deleteCompositeReportApi,
  getCompositeReportPdfApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import PdfPreviewModal from "../../components/PdfPreviewModal";

// Composite Report (Incoming Approval Slip). Standalone: it is generated from a
// tested sample (a lab test report) and has nothing to do with production,
// loading, unloading or the vehicle exit. Pick the sample report, enter the
// composite readings next to the exposed-sample analysis, add parameters if
// needed, generate.

// Parameters printed on the physical slip — a quick way to add one inline.
const QUICK_PARAMS = [
  "General", "Admixture %", "Short Grain", "Moisture", "Ave Length (mm)", "Broken %",
  "Immature %", "Dead Paddy", "Chalky %", "Damaged / Discoloured", "Milled", "Tip Broken %",
  "Whiteness %", "Brown", "Green %", "Paddy %", "Green 5/10 gms", "Choba + Red", "Cracus",
  "Total Yield", "Head Rice Yield", "Combine Bkn",
];

const RESULT_LABELS = { approved: "Approved", rejected: "Rejected", non_conforming: "Non Conforming" };

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const emptyForm = {
  approval_no: "",
  ref_no: "",
  report_date: today(),
  party_name: "",
  truck_no: "",
  qty: "",
  quality: "",
  result_exposed: "",
  result_composite: "",
  remarks: "",
};

const emptyNewParam = { name: "", exposed: "", composite: "" };

// params is a JSON column — it can come back as a raw string.
const parseParams = (value) => {
  let list = value;
  if (typeof value === "string" && value.trim()) {
    try {
      list = JSON.parse(value);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list)
    ? list.map((p) => ({ name: p?.name ?? "", exposed: p?.exposed ?? "", composite: p?.composite ?? "" }))
    : [];
};

const parseIdList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return value ? [value] : [];
};

const s = {
  container: { padding: "20px", maxWidth: "1200px", margin: "0 auto" },
  title: { fontSize: "24px", fontWeight: 600, color: "#14201d", margin: "0 0 4px 0" },
  subtitle: { fontSize: "14px", color: "#5b6660", margin: "0 0 20px 0" },
  card: {
    background: "white",
    borderRadius: "8px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)",
    padding: "24px",
    marginBottom: "24px",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    paddingBottom: "16px",
    borderBottom: "1px solid #e8e0cc",
  },
  h3: { fontSize: "18px", fontWeight: 600, color: "#14201d", margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px" },
  group: { display: "flex", flexDirection: "column", gap: "6px" },
  full: { gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "6px" },
  label: { fontSize: "14px", fontWeight: 500, color: "#2f3a36" },
  input: {
    padding: "8px 12px",
    border: "1px solid #d9d0bb",
    borderRadius: "4px",
    fontSize: "14px",
    background: "white",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  btn: {
    padding: "8px 16px",
    background: "white",
    border: "1px solid #d9d0bb",
    borderRadius: "4px",
    fontSize: "13px",
    cursor: "pointer",
    color: "#2f3a36",
  },
  btnPrimary: {
    padding: "10px 24px",
    background: "#0f766e",
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
  },
  btnDisabled: { background: "#9fd0c8", cursor: "not-allowed" },
  alert: { padding: "12px 16px", borderRadius: "6px", marginBottom: "16px", fontSize: "14px" },
  alertError: { background: "#fbeae7", color: "#b3261e", border: "1px solid #efc4be" },
  alertOk: { background: "#e3f1ee", color: "#0b5f58", border: "1px solid #c4e0da" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { textAlign: "left", padding: "8px 10px", background: "#f1ebda", border: "1px solid #e8e0cc", fontWeight: 600 },
  td: { padding: "6px 8px", border: "1px solid #e8e0cc", verticalAlign: "middle" },
  hint: { fontSize: "12px", color: "#5b6660" },
};

export default function CompositeReportPage() {
  const [tests, setTests] = useState([]);
  const [materials, setMaterials] = useState({});
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testId, setTestId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [params, setParams] = useState([]);
  const [newParam, setNewParam] = useState(emptyNewParam);
  const [editingId, setEditingId] = useState(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pdfPreview, setPdfPreview] = useState(null); // { url, fileName, title }
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const formRef = useRef(null);

  // `spinner` is false on the first load (the table already starts in its loading state).
  const loadReports = (spinner = true) => {
    if (spinner) setLoading(true);
    getCompositeReportsApi({ limit: 500 })
      .then((res) => setReports(res.data.data ?? res.data))
      .catch(() => setError("Failed to load composite reports"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    getLabTestsApi({ limit: 1000 })
      .then((res) => setTests(res.data.data ?? res.data))
      .catch(() => setError("Failed to load sample reports"));
    getMasterSettingsApi("material")
      .then((res) => {
        const map = {};
        (res.data.data ?? res.data).forEach((m) => {
          map[m.id] = m.name;
        });
        setMaterials(map);
      })
      .catch(() => {});
    loadReports(false);
  }, []);

  const materialNames = (row) =>
    parseIdList(row.material_id)
      .map((id) => materials[id] || `Material ${id}`)
      .join(", ") || "—";

  const testLabel = (t) => {
    const code = t.sampling?.sample_code || `Test ${t.id}`;
    const party = t.sampling?.gateEntry?.vendor?.name;
    return [code, party, materialNames(t)].filter(Boolean).join(" — ") + ` (${t.verdict})`;
  };

  const resetForm = () => {
    setEditingId(null);
    setTestId("");
    setForm(emptyForm);
    setParams([]);
    setNewParam(emptyNewParam);
  };

  // Pick a sample report: pre-fill the header and the exposed-sample analysis.
  const handlePickTest = async (id) => {
    setTestId(id);
    setError("");
    setInfo("");
    if (!id) {
      setForm(emptyForm);
      setParams([]);
      return;
    }
    setLoadingSource(true);
    try {
      const res = await getCompositeReportSourceApi(id);
      const src = res.data.data ?? res.data;
      setForm({
        ...emptyForm,
        ref_no: src.ref_no || "",
        report_date: src.report_date || today(),
        party_name: src.party_name || "",
        truck_no: src.truck_no || "",
        quality: src.quality || "",
        result_exposed: src.result_exposed || "",
      });
      setParams(parseParams(src.params));
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load that sample report");
    } finally {
      setLoadingSource(false);
    }
  };

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const updateParam = (idx, field, value) =>
    setParams((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  const removeParam = (idx) => setParams((prev) => prev.filter((_, i) => i !== idx));

  const addParam = () => {
    const name = newParam.name.trim();
    if (!name) {
      setError("Enter a parameter name (or pick one from the list) before adding it.");
      return;
    }
    setError("");
    setParams((prev) => [...prev, { name, exposed: newParam.exposed.trim(), composite: newParam.composite.trim() }]);
    setNewParam(emptyNewParam);
  };

  const openPdf = async (id, code) => {
    setPdfLoadingId(id);
    try {
      const res = await getCompositeReportPdfApi(id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPdfPreview({ url, fileName: `composite-report-${code}.pdf`, title: `Composite Report — ${code}` });
    } catch {
      setError("Couldn't generate the Composite Report PDF");
    } finally {
      setPdfLoadingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!testId) {
      setError("Select the sample report first.");
      return;
    }
    if (params.length === 0) {
      setError("Add at least one parameter to the report.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        lab_test_id: Number(testId),
        ...form,
        result_exposed: form.result_exposed || null,
        result_composite: form.result_composite || null,
        params,
      };
      let saved;
      if (editingId) {
        const res = await updateCompositeReportApi(editingId, payload);
        saved = res.data.data ?? res.data;
        setInfo("Composite report updated.");
      } else {
        const res = await createCompositeReportApi(payload);
        saved = res.data.data ?? res.data;
        setInfo("Composite report generated.");
      }
      resetForm();
      loadReports();
      if (saved?.id) openPdf(saved.id, saved.report_no || saved.id);
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setTestId(String(row.lab_test_id));
    setForm({
      approval_no: row.approval_no || "",
      ref_no: row.ref_no || "",
      report_date: row.report_date || today(),
      party_name: row.party_name || "",
      truck_no: row.truck_no || "",
      qty: row.qty || "",
      quality: row.quality || "",
      result_exposed: row.result_exposed || "",
      result_composite: row.result_composite || "",
      remarks: row.remarks || "",
    });
    setParams(parseParams(row.params));
    setNewParam(emptyNewParam);
    setError("");
    setInfo("");
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this composite report?")) return;
    try {
      await deleteCompositeReportApi(id);
      setInfo("Composite report deleted.");
      if (editingId === id) resetForm();
      loadReports();
    } catch {
      setError("Delete failed");
    }
  };

  const canSubmit = !submitting && !loadingSource && testId && params.length > 0;

  return (
    <div style={s.container}>
      <div ref={formRef}>
        <h2 style={s.title}>Composite Report</h2>
        <p style={s.subtitle}>
          Generate the composite (incoming approval) report from a tested sample. It is independent of the rest of the mill flow.
        </p>
      </div>

      {error && <div style={{ ...s.alert, ...s.alertError }}>{error}</div>}
      {info && <div style={{ ...s.alert, ...s.alertOk }}>{info}</div>}

      <form style={s.card} onSubmit={handleSubmit}>
        <div style={s.cardHead}>
          <h3 style={s.h3}>{editingId ? "Edit Composite Report" : "Generate Composite Report"}</h3>
          {editingId && (
            <button type="button" style={s.btn} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>

        <div style={s.grid}>
          <div style={s.full}>
            <label style={s.label}>
              Sample Report (Lab Test) <span style={{ color: "#b3261e" }}>*</span>
            </label>
            <select
              style={s.input}
              value={testId}
              disabled={Boolean(editingId)}
              onChange={(e) => handlePickTest(e.target.value)}
            >
              <option value="">Select a tested sample…</option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {testLabel(t)}
                </option>
              ))}
            </select>
            {loadingSource && <span style={s.hint}>Loading the sample analysis…</span>}
          </div>

          {testId && !loadingSource && (
            <>
              <div style={s.group}>
                <label style={s.label}>Approval No.</label>
                <input name="approval_no" style={s.input} value={form.approval_no} onChange={handleChange} maxLength={60} />
              </div>
              <div style={s.group}>
                <label style={s.label}>Ref No.</label>
                <input name="ref_no" style={s.input} value={form.ref_no} onChange={handleChange} maxLength={60} />
              </div>
              <div style={s.group}>
                <label style={s.label}>Date</label>
                <input name="report_date" type="date" style={s.input} value={form.report_date} onChange={handleChange} />
              </div>
              <div style={s.group}>
                <label style={s.label}>Party Name</label>
                <input name="party_name" style={s.input} value={form.party_name} onChange={handleChange} maxLength={150} />
              </div>
              <div style={s.group}>
                <label style={s.label}>Truck No.</label>
                <input name="truck_no" style={s.input} value={form.truck_no} onChange={handleChange} maxLength={40} />
              </div>
              <div style={s.group}>
                <label style={s.label}>Qty</label>
                <input name="qty" style={s.input} value={form.qty} onChange={handleChange} maxLength={60} placeholder="e.g. 250 Qtl" />
              </div>
              <div style={s.full}>
                <label style={s.label}>Quality</label>
                <input name="quality" style={s.input} value={form.quality} onChange={handleChange} maxLength={150} />
              </div>

              <div style={s.full}>
                <label style={s.label}>Sample Analysis</label>
                <span style={s.hint}>
                  The exposed-sample column comes from the sample report. Enter the composite readings next to it.
                </span>
                <div style={{ overflowX: "auto" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Specification</th>
                        <th style={s.th}>Exposed Sample Analysis</th>
                        <th style={s.th}>Composite Sample Analysis</th>
                        <th style={{ ...s.th, width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {params.length === 0 && (
                        <tr>
                          <td style={{ ...s.td, color: "#5b6660" }} colSpan={4}>
                            This sample report has no readings. Add parameters below.
                          </td>
                        </tr>
                      )}
                      {params.map((p, idx) => (
                        <tr key={idx}>
                          <td style={s.td}>
                            <input
                              style={s.input}
                              value={p.name}
                              maxLength={60}
                              onChange={(e) => updateParam(idx, "name", e.target.value)}
                            />
                          </td>
                          <td style={s.td}>
                            <input
                              style={s.input}
                              value={p.exposed}
                              maxLength={40}
                              onChange={(e) => updateParam(idx, "exposed", e.target.value)}
                            />
                          </td>
                          <td style={s.td}>
                            <input
                              style={s.input}
                              value={p.composite}
                              maxLength={40}
                              onChange={(e) => updateParam(idx, "composite", e.target.value)}
                            />
                          </td>
                          <td style={s.td}>
                            <button type="button" style={s.btn} onClick={() => removeParam(idx)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={s.full}>
                <label style={s.label}>
                  Add Parameter <span style={{ fontWeight: 400, color: "#5b6660", fontSize: 12 }}>(optional — for any extra quality feature)</span>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr 1fr auto", gap: "10px" }}>
                  <select
                    style={s.input}
                    value=""
                    onChange={(e) => e.target.value && setNewParam({ ...newParam, name: e.target.value })}
                  >
                    <option value="">Pick a slip parameter…</option>
                    {QUICK_PARAMS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                  <input
                    style={s.input}
                    placeholder="…or type a name"
                    value={newParam.name}
                    maxLength={60}
                    onChange={(e) => setNewParam({ ...newParam, name: e.target.value })}
                  />
                  <input
                    style={s.input}
                    placeholder="Exposed"
                    value={newParam.exposed}
                    maxLength={40}
                    onChange={(e) => setNewParam({ ...newParam, exposed: e.target.value })}
                  />
                  <input
                    style={s.input}
                    placeholder="Composite"
                    value={newParam.composite}
                    maxLength={40}
                    onChange={(e) => setNewParam({ ...newParam, composite: e.target.value })}
                  />
                  <button type="button" style={s.btn} onClick={addParam}>
                    + Add
                  </button>
                </div>
              </div>

              <div style={s.group}>
                <label style={s.label}>Result (Exposed Bag Sample)</label>
                <select name="result_exposed" style={s.input} value={form.result_exposed} onChange={handleChange}>
                  <option value="">Not set</option>
                  {Object.entries(RESULT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div style={s.group}>
                <label style={s.label}>Result (Composite Bag Sample)</label>
                <select name="result_composite" style={s.input} value={form.result_composite} onChange={handleChange}>
                  <option value="">Not set</option>
                  {Object.entries(RESULT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div style={s.full}>
                <label style={s.label}>Remarks</label>
                <textarea
                  name="remarks"
                  style={{ ...s.input, resize: "vertical" }}
                  rows={3}
                  maxLength={1000}
                  value={form.remarks}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e8e0cc" }}>
          <button
            type="submit"
            style={{ ...s.btnPrimary, ...(canSubmit ? {} : s.btnDisabled) }}
            disabled={!canSubmit}
          >
            {submitting ? "Saving…" : editingId ? "Update Report" : "Generate Report"}
          </button>
        </div>
      </form>

      <div style={s.card}>
        <h3 style={{ ...s.h3, marginBottom: 16 }}>Composite Reports</h3>
        <DataTable
          loading={loading}
          rows={reports}
          onEdit={handleEdit}
          onDelete={handleDelete}
          columns={[
            { key: "report_no", label: "Report No." },
            {
              key: "sample",
              label: "Sample",
              render: (row) => row.labTest?.sampling?.sample_code || "—",
            },
            { key: "party_name", label: "Party", render: (row) => row.party_name || "—" },
            { key: "quality", label: "Quality", render: (row) => row.quality || "—" },
            { key: "report_date", label: "Date", render: (row) => row.report_date || "—" },
            {
              key: "result_composite",
              label: "Composite Result",
              render: (row) => RESULT_LABELS[row.result_composite] || "—",
            },
            {
              key: "pdf",
              label: "Report",
              render: (row) => (
                <button className="dt-btn" disabled={pdfLoadingId === row.id} onClick={() => openPdf(row.id, row.report_no || row.id)}>
                  {pdfLoadingId === row.id ? "Generating…" : "PDF"}
                </button>
              ),
            },
          ]}
        />
      </div>

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
        title="Composite Report"
        steps={[
          "Select a tested sample (its lab test / sample report). The party, truck, quality and the exposed-sample analysis are filled in from it.",
          "Enter the composite readings in the Composite column next to each parameter.",
          "Need another parameter? Pick one from the slip list or type your own in Add Parameter, with its exposed / composite values.",
          "Set the two results (Approved / Rejected / Non Conforming), add remarks if needed, then click Generate Report.",
          "The report opens as a PDF in the Incoming Approval Slip format. Use the PDF button on any report in the list to open it again, or Edit to correct it.",
          "A composite report is independent of the mill flow - it never changes the gate entry, unloading, loading, production or stock.",
        ]}
      />
    </div>
  );
}
