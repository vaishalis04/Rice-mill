// Status chip + status tabs for the Sales Orders page.
//
// Stored statuses stay as they are in the database; this file only decides how
// they are shown. "dispatched" (every material fully loaded) is displayed as
// COMPLETED.

export const STATUS_META = {
  pending: { label: "Pending", bg: "#fff8e1", fg: "#8a6100", dot: "#f9a825" },
  confirmed: { label: "Confirmed", bg: "#e8f5e9", fg: "#1b5e20", dot: "#43a047" },
  allocated: { label: "Allocated", bg: "#fff3e0", fg: "#a64b00", dot: "#fb8c00" },
  dispatched: { label: "Completed", bg: "#e3f2fd", fg: "#0d47a1", dot: "#1e88e5" },
  closed: { label: "Closed", bg: "#eceff1", fg: "#455a64", dot: "#78909c" },
  cancelled: { label: "Cancelled", bg: "#ffebee", fg: "#b71c1c", dot: "#e53935" },
};

export const statusLabel = (status) => (STATUS_META[status] || { label: status || "—" }).label;

// The tabs above the list. `match` decides which orders (by their order status) belong to it.
export const SO_TABS = [
  { key: "all", label: "All", color: "#1d4ed8", match: () => true },
  { key: "confirmed", label: "Confirmed", color: "#43a047", match: (s) => ["pending", "confirmed", "allocated"].includes(s) },
  { key: "completed", label: "Completed", color: "#1e88e5", match: (s) => s === "dispatched" },
  { key: "closed", label: "Closed", color: "#78909c", match: (s) => s === "closed" },
  { key: "cancelled", label: "Cancelled", color: "#e53935", match: (s) => s === "cancelled" },
];

// Where an order with this status is listed (used to point the user at the right tab).
export const tabForStatus = (status) => (SO_TABS.find((t) => t.key !== "all" && t.match(status)) || SO_TABS[0]).key;

// The order's real status (falls back to the stored one if the API is older).
export const orderStatusOf = (order) => order?.order_status || order?.so_status || "confirmed";
// A material line's real status.
export const lineStatusOf = (item, order) => item?.line_status || item?.so_status || order?.so_status || "confirmed";

export function StatusChip({ status, small }) {
  const m = STATUS_META[status] || { label: status || "—", bg: "#eef2f7", fg: "#475569", dot: "#94a3b8" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "2px 8px" : "3px 10px",
        borderRadius: 999,
        background: m.bg,
        color: m.fg,
        fontSize: small ? "0.7rem" : "0.75rem",
        fontWeight: 700,
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

export function StatusTabs({ active, counts, onChange }) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        margin: "4px 0 16px",
        padding: 4,
        background: "#e8edf4",
        borderRadius: 12,
        width: "fit-content",
        maxWidth: "100%",
      }}
    >
      {SO_TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              cursor: "pointer",
              padding: "7px 14px",
              borderRadius: 9,
              fontSize: "0.84rem",
              fontWeight: 700,
              background: isActive ? "#fff" : "transparent",
              color: isActive ? "#0f172a" : "#475569",
              boxShadow: isActive ? "0 1px 3px rgba(15, 23, 42, 0.18)" : "none",
              transition: "background 0.15s",
            }}
          >
            {t.key !== "all" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.color }} />}
            {t.label}
            <span
              style={{
                minWidth: 22,
                textAlign: "center",
                padding: "1px 7px",
                borderRadius: 999,
                fontSize: "0.72rem",
                fontWeight: 700,
                background: isActive ? t.color : "#d5dce8",
                color: isActive ? "#fff" : "#475569",
              }}
            >
              {counts[t.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
