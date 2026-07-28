import { useState, useEffect } from "react";
import { getDashboardKpisApi, getDailyIntakeTrendApi } from "../api/api";
import "./KpiBar.css";

const KPI_FIELDS = [
  { key: "trucks_at_gate", label: "Trucks at Gate" },
  { key: "today_intake_qty", label: "Today Intake Qty" },
  {
    key: "lab_rejection_rate",
    label: "Lab Rejection Rate",
    format: (v) => (v != null ? `${Number(v).toFixed(1)}%` : "—"),
  },
  { key: "active_batches", label: "Active Batches" },
  { key: "fg_stock_qty", label: "FG Stock Qty" },
  { key: "pending_dispatch_count", label: "Pending Dispatch" },
  {
    key: "today_dispatch_value",
    label: "Today Dispatch Value",
    format: (v) => (v != null ? `₹${Number(v).toLocaleString("en-IN")}` : "—"),
  },
];

export default function KpiBar() {
  const [kpis, setKpis] = useState(null);
  const [error, setError] = useState("");
  const [showTrend, setShowTrend] = useState(false);
  const [trend, setTrend] = useState(null);
  const [trendError, setTrendError] = useState("");

  useEffect(() => {
    getDashboardKpisApi()
      .then((res) => setKpis(res.data.data ?? res.data))
      .catch(() => setError("Couldn't load dashboard KPIs"));
  }, []);

  const toggleTrend = () => {
    const next = !showTrend;
    setShowTrend(next);
    if (next && !trend) {
      getDailyIntakeTrendApi()
        .then((res) => setTrend(res.data.data ?? res.data))
        .catch(() => setTrendError("Couldn't load the intake trend"));
    }
  };

  if (error) return null; // don't block the rest of the dashboard over a KPI fetch failure
  if (!kpis) return null;

  const maxIntake = trend?.length
    ? Math.max(...trend.map((d) => Number(d.intake_qty) || 0), 1)
    : 1;

  return (
    <div className="kpi-bar">
      <div className="kpi-cards">
        {KPI_FIELDS.map((f) => (
          <div className="kpi-card" key={f.key}>
            <div className="kpi-value">
              {f.format ? f.format(kpis[f.key]) : kpis[f.key] ?? "—"}
            </div>
            <div className="kpi-label">{f.label}</div>
          </div>
        ))}
      </div>

      <button type="button" className="kpi-trend-toggle" onClick={toggleTrend}>
        {showTrend ? "Hide" : "Show"} 7-day intake trend
      </button>

      {showTrend && (
        <div className="kpi-trend">
          {trendError && <div className="dt-error">{trendError}</div>}
          {!trendError && !trend && <p className="dt-msg">Loading…</p>}
          {trend && (
            <div className="kpi-trend-bars">
              {trend.map((d) => (
                <div className="kpi-trend-col" key={d.date}>
                  <div
                    className="kpi-trend-bar"
                    style={{
                      height: `${Math.max(6, (Number(d.intake_qty) / maxIntake) * 90)}px`,
                    }}
                    title={`${d.date}: ${d.intake_qty}`}
                  />
                  <div className="kpi-trend-date">{d.date?.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
