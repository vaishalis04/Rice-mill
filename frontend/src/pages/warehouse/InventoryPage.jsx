import { useState, useEffect, useMemo } from "react";
import { getInventoryStockSummaryApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";

function formatIdleLabel(row) {
  if (row.idle_days == null) return "No movement recorded";
  if (row.idle_days <= 0) return "Moved today";
  if (row.idle_days === 1) return "Idle for 1 day";
  return `Idle for ${row.idle_days} days`;
}

function formatLastMovement(row) {
  if (row.idle_days == null) return "—";
  if (row.idle_days <= 0) return "Today";
  if (row.idle_days === 1) return "1 day ago";
  return `${row.idle_days} days ago`;
}

export default function InventoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [itemFilter, setItemFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [bagSizeFilter, setBagSizeFilter] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    getInventoryStockSummaryApi()
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load inventory"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredRows = useMemo(() => {
    const item = itemFilter.trim().toLowerCase();
    const location = locationFilter.trim().toLowerCase();
    const bagSize = bagSizeFilter.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesItem = !item || row.material_name?.toLowerCase().includes(item);
      const matchesLocation = !location || row.warehouse_name?.toLowerCase().includes(location);

      let matchesBagSize = true;
      if (bagSize) {
        if (row.bag_size == null) {
          matchesBagSize = "bulk".includes(bagSize) || bagSize.includes("bulk");
        } else {
          matchesBagSize = String(row.bag_size).toLowerCase().includes(bagSize);
        }
      }

      return matchesItem && matchesLocation && matchesBagSize;
    });
  }, [rows, itemFilter, locationFilter, bagSizeFilter]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Inventory</h2>
      {error && <div className="dt-error">{error}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="sf-field" style={{ marginBottom: 0 }}>
          <label>Search Item</label>
          <input
            type="text"
            placeholder="Search item…"
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14 }}
          />
        </div>
        <div className="sf-field" style={{ marginBottom: 0 }}>
          <label>Search Location</label>
          <input
            type="text"
            placeholder="Search location…"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14 }}
          />
        </div>
        <div className="sf-field" style={{ marginBottom: 0 }}>
          <label>Search Bag Size</label>
          <input
            type="text"
            placeholder="Search bag size (kg), or 'Bulk'…"
            value={bagSizeFilter}
            onChange={(e) => setBagSizeFilter(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 14 }}
          />
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filteredRows}
        columns={[
          {
            key: "material_name",
            label: "Item Details",
            render: (row) => (
              <div>
                <div style={{ fontWeight: 500 }}>{row.material_name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{formatIdleLabel(row)}</div>
              </div>
            ),
          },
          {
            key: "warehouse_name",
            label: "Location",
            render: (row) => row.warehouse_name || "—",
          },
          {
            key: "bag_size",
            label: "Bag Size",
            render: (row) => (row.bag_size != null ? `${row.bag_size} kg` : "Bulk"),
          },
          {
            key: "bag_count",
            label: "Stock (Bags)",
            render: (row) => (row.bag_count != null ? row.bag_count : "—"),
          },
          {
            key: "qty_tons",
            label: "Stock (Tons)",
            render: (row) => row.qty_tons.toFixed(3),
          },
          {
            key: "last_movement",
            label: "Last Movement",
            render: (row) => formatLastMovement(row),
          },
        ]}
      />

      <ModuleGuide
        title="Inventory"
        steps={[
          "Every row here is a material sitting at a specific location, broken out by bag size.",
          "Raw stock shows a bag size when it was recorded during unloading (bag count is an estimate from remaining tons, since consumption is tracked in tons); otherwise it shows as 'Bulk'.",
          "Packed material is grouped by its actual pack size, with the total bag count and tons for that group.",
          "'Last Movement' reflects the most recent stock change for that group — a raw stock deduction/addition, or a packing/dispatch update for packed stock.",
          "Use the three search boxes to narrow down by item name, warehouse, or bag size.",
        ]}
      />
    </div>
  );
}