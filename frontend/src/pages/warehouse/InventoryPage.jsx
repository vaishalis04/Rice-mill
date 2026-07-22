import { useState, useEffect } from "react";
import { getInventoryApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

// Read-only per the API docs — rows are written automatically by Lot
// creation, not created/edited/deleted here.
export default function InventoryPage() {
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = (warehouse_id = warehouseFilter, stage = stageFilter) => {
    setLoading(true);
    const params = {};
    if (warehouse_id) params.warehouse_id = warehouse_id;
    if (stage) params.stage = stage;
    getInventoryApi(params)
      .then((res) => setRows(res.data.data ?? res.data))
      .catch(() => setError("Failed to load inventory"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Inventory</h2>
      {error && <div className="dt-error">{error}</div>}

      <div className="sf-form">
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={warehouseFilter}
          onChange={(id) => {
            setWarehouseFilter(id);
            load(id, stageFilter);
          }}
        />
        <div className="sf-field">
          <label>Stage</label>
          <input
            value={stageFilter}
            placeholder="e.g. raw"
            onChange={(e) => setStageFilter(e.target.value)}
            onBlur={() => load(warehouseFilter, stageFilter)}
          />
        </div>
      </div>

      {/* Column list is a best-effort guess at the Inventory row shape —
          adjust to match whatever the API actually returns. */}
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: "lot_id", label: "Lot ID" },
          { key: "warehouse_id", label: "Warehouse ID" },
          { key: "bin_id", label: "Bin ID" },
          { key: "material_id", label: "Material ID" },
          { key: "stage", label: "Stage" },
          { key: "qty", label: "Qty" },
        ]}
      />
    </div>
  );
}
