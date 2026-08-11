import { useState, useEffect } from "react";
import { getInventoryApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

export default function InventoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  // The API docs only show `stage=raw` as an example without listing the
  // full enum, so this stays a free-text filter rather than a guessed
  // dropdown — confirm the real stage values with the backend and this can
  // become an EntitySelect/<select> later.
  const [stageFilter, setStageFilter] = useState("");

  const warehouses = useEntityLookup("warehouse");
  const materials = useEntityLookup("material");
  const lots = useEntityLookup("lot");

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

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Inventory</h2>
      {error && <div className="dt-error">{error}</div>}

      <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
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
            placeholder="e.g. raw"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            onBlur={() => load(warehouseFilter, stageFilter)}
          />
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          {
            key: "lot_id",
            label: "Lot",
            render: (row) => row.lot?.lot_no ?? lots.getLabel(row.lot_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => row.material?.name ?? materials.getLabel(row.material_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) => row.warehouse?.name ?? warehouses.getLabel(row.warehouse_id),
          },
          { key: "stage", label: "Stage" },
          { key: "balance_qty", label: "Qty" },
        ]}
      />
    </div>
  );
}