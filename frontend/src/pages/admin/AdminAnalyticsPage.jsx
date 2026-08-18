import { useState, useEffect, useRef } from "react";
import {
  getAnalyticsSummaryApi,
  getProductionTrendApi,
  getMaterialFlowSnapshotApi,
  getFleetSnapshotApi,
  getGateActivityApi,
} from "../../api/api";
import { useEntityLookup } from "../../hooks/useEntityLookup";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "../../components/DataTable.css";
import "./AdminAnalyticsPage.css";

const PIE_COLORS = ["#3b6fb4", "#8a7f5a", "#2b2b2b", "#b7c3d6"];

function KpiCard({ label, value, delta, deltaLabel }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {delta !== null && delta !== undefined && (
        <div style={{ fontSize: 12, color: delta >= 0 ? "#2b7a2b" : "#b23a3a", marginTop: 4 }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}
          {deltaLabel ? ` ${deltaLabel}` : ""}
        </div>
      )}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const plants = useEntityLookup("plant");

  const [filters, setFilters] = useState({ from: "", to: "", plant_id: "" });
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [materialFlow, setMaterialFlow] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [gateActivity, setGateActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const reportRef = useRef(null);

  const buildParams = () => {
    const params = {};
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.plant_id) params.plant_id = filters.plant_id;
    return params;
  };

  const load = () => {
    setLoading(true);
    setError("");
    const params = buildParams();
    Promise.all([
      getAnalyticsSummaryApi(params),
      getProductionTrendApi(params),
      getMaterialFlowSnapshotApi(params),
      getFleetSnapshotApi(params),
      getGateActivityApi({ ...params, limit: 5 }),
    ])
      .then(([s, t, m, f, g]) => {
        setSummary(s.data.data ?? s.data);
        setTrend(t.data.data ?? t.data);
        setMaterialFlow(m.data.data ?? m.data);
        setFleet(f.data.data ?? f.data);
        setGateActivity(g.data.data ?? g.data);
      })
      .catch((err) =>
        setError(err.response?.data?.message || "Failed to load dashboard data")
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (e) =>
    setFilters({ ...filters, [e.target.name]: e.target.value });

  const handleApplyFilters = (e) => {
    e.preventDefault();
    load();
  };

  const handleDownloadPdf = async () => {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`rice-mill-dashboard-${stamp}.pdf`);
    } catch (err) {
      setError("Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Dashboard</h2>
        <button className="sf-submit" onClick={handleDownloadPdf} disabled={downloading || loading}>
          {downloading ? "Generating PDF…" : "Download as PDF"}
        </button>
      </div>

      {error && <div className="dt-error">{error}</div>}

      <form className="sf-form" onSubmit={handleApplyFilters} style={{ marginBottom: 20 }}>
        <div className="sf-field">
          <label>From</label>
          <input name="from" type="date" value={filters.from} onChange={handleFilterChange} />
        </div>
        <div className="sf-field">
          <label>To</label>
          <input name="to" type="date" value={filters.to} onChange={handleFilterChange} />
        </div>
        <div className="sf-field">
          <label>Plant</label>
          <select name="plant_id" value={filters.plant_id} onChange={handleFilterChange}>
            <option value="">All plants</option>
            {plants.rows.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <button className="sf-submit" type="submit">Apply Filters</button>
      </form>

      {loading && <p className="dt-msg">Loading dashboard…</p>}

      {!loading && summary && (
        <div ref={reportRef} style={{ background: "#fff", padding: 16 }}>
          <div className="kpi-cards" style={{ marginBottom: 20 }}>
            <KpiCard
              label="Gate Entries Today"
              value={summary.gate_entries_today}
              delta={summary.gate_entries_delta_pct}
              deltaLabel="% vs. yesterday"
            />
            <KpiCard
              label="Batches Processed (in range)"
              value={summary.batches_in_range}
              delta={summary.batches_delta}
              deltaLabel="vs. yesterday"
            />
            <KpiCard label="Avg. Recovery %" value={`${summary.avg_recovery_pct}%`} />
            <KpiCard label="Active Vehicles" value={summary.active_vehicles} />
          </div>

          <div
            className="dashboard-panel-row"
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div className="dashboard-panel">
              <h3>Production: Input vs. Output</h3>
              {trend.length === 0 ? (
                <p className="dt-msg">No production data in this range yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" unit="%" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="input_qty" fill="#3b6fb4" name="Input Qty" />
                    <Bar yAxisId="left" dataKey="output_qty" fill="#8a7f5a" name="Output Qty" />
                    <Line yAxisId="right" type="monotone" dataKey="recovery_pct" stroke="#2b2b2b" name="Recovery %" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="dashboard-panel">
              <h3>Warehouse Material Flow</h3>
              {materialFlow && (
                <div style={{ display: "flex", justifyContent: "space-around", marginTop: 20 }}>
                  {[
                    { label: "Raw Stock", pct: materialFlow.raw_stock_pct, qty: materialFlow.raw_stock_qty },
                    { label: "By-Product Stock", pct: materialFlow.by_product_pct, qty: materialFlow.by_product_qty },
                    { label: "Finished Goods Stock", pct: materialFlow.fg_stock_pct, qty: materialFlow.fg_stock_qty },
                  ].map((item) => (
                    <div key={item.label} style={{ textAlign: "center" }}>
                      <div
                        style={{
                          width: 40,
                          height: 140,
                          background: "#eef0f3",
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "flex-end",
                          margin: "0 auto",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ width: "100%", height: `${item.pct}%`, background: "#3b6fb4" }} />
                      </div>
                      <div style={{ fontWeight: 700, marginTop: 8 }}>{item.pct}%</div>
                      <div style={{ fontSize: 12 }}>{item.qty} qtl</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{item.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-panel-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div className="dashboard-panel">
              <h3>Gate Register — Live Activity</h3>
              <div className="dt-wrapper">
                <table className="dt-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Time</th>
                    <th>Vehicle</th>
                    <th>Driver</th>
                    <th>Material</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {gateActivity.length === 0 && (
                    <tr><td colSpan={6}>No recent gate activity.</td></tr>
                  )}
                  {gateActivity.map((row) => (
                    <tr key={row.id}>
                      <td>{row.token_no}</td>
                      <td>{new Date(row.entry_time).toLocaleTimeString()}</td>
                      <td>{row.vehicle?.vehicle_no || "—"}</td>
                      <td>{row.driver?.name || "—"}</td>
                      <td>{row.material?.name || "—"}</td>
                      <td><span className="dt-badge">{row.gate_status}</span></td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>

            <div className="dashboard-panel">
              <h3>Fleet Snapshot</h3>
              {fleet && (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={fleet.by_type}
                        dataKey="count"
                        nameKey="type"
                        innerRadius={45}
                        outerRadius={70}
                        label={(entry) => `${entry.type}: ${entry.count}`}
                      >
                        {fleet.by_type.map((entry, i) => (
                          <Cell key={entry.type} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ textAlign: "center", fontWeight: 700 }}>
                    {fleet.total_vehicles} total vehicles
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
                    {fleet.top_drivers.map((d) => (
                      <li key={d.license_no} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                        <span>{d.name}</span>
                        <span style={{ color: "#3b6fb4", fontWeight: 600 }}>{d.trips} trips</span>
                      </li>
                    ))}
                    {fleet.top_drivers.length === 0 && <li>No dispatch trips recorded yet.</li>}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}