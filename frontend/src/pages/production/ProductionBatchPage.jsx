import { useEffect, useState } from "react";
import {
  createProductionBatchApi,
  finalizeProductionBatchApi,
  getProductionBatchesApi,
  getWarehouseStockApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyCreateForm = {
  warehouse_id: "",
  material_id: "",
  process_type: "wet",
  input_qty: "",
};

const emptyOutputForm = {
  input_qty: "",
  long_qty: "",
  medium_qty: "",
  broken_qty: "",
  small_broken_qty: "",
};

export default function ProductionBatchPage() {
  const [batches, setBatches] = useState([]);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [outputForm, setOutputForm] = useState(emptyOutputForm);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [availableStock, setAvailableStock] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const lots = useEntityLookup("lot");
  const warehouses = useEntityLookup("warehouse");
  const materials = useEntityLookup("material");

  useEffect(() => {
    if (!createForm.warehouse_id || !createForm.material_id) {
      setAvailableStock(0);
      return;
    }

    getWarehouseStockApi({
      warehouse_id: createForm.warehouse_id,
      material_id: createForm.material_id,
    })
      .then((res) => {
        const rows = res.data.data ?? res.data ?? [];
        const total = rows.reduce((sum, row) => sum + Number(row.balance_qty ?? row.qty ?? 0), 0);
        setAvailableStock(total);
      })
      .catch(() => setAvailableStock(0));
  }, [createForm.warehouse_id, createForm.material_id]);

  const load = () => {
    setLoading(true);
    getProductionBatchesApi()
      .then((res) => setBatches(res.data.data ?? res.data))
      .catch(() => setError("Failed to load production batches"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreateChange = (event) => {
    setCreateForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  };

  const handleOutputChange = (event) => {
    setOutputForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    setInfo("");
    try {
      const res = await createProductionBatchApi({
        warehouse_id: Number(createForm.warehouse_id),
        material_id: Number(createForm.material_id),
        process_type: createForm.process_type,
        input_qty: Number(createForm.input_qty),
      });
      const created = res.data.data ?? res.data;
      setInfo(res.data.msg || "Batch created. Enter the final production output below.");
      setCreateForm(emptyCreateForm);
      setSelectedBatch(created);
      setOutputForm({ ...emptyOutputForm, input_qty: created.input_qty ?? createForm.input_qty });
      lots.refetch();
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.msg || "Could not complete production");
    }
  };

  const handleFinalize = async (event) => {
    event.preventDefault();
    setError("");
    setInfo("");
    try {
      const res = await finalizeProductionBatchApi(selectedBatch.id, {
        input_qty: Number(outputForm.input_qty),
        long_qty: Number(outputForm.long_qty),
        medium_qty: Number(outputForm.medium_qty || 0),
        broken_qty: Number(outputForm.broken_qty || 0),
        small_broken_qty: Number(outputForm.small_broken_qty || 0),
      });
      setInfo(res.data.msg || "Production completed and sent to Packing.");
      setSelectedBatch(null);
      setOutputForm(emptyOutputForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.msg || "Could not save production output");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Production Batches</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <h3>Create Batch</h3>
      <p className="field-hint">
        Select the warehouse and raw material to consume. The system will pull the available stock in tons and create a production batch against that stock.
      </p>
      <form className="sf-form" onSubmit={handleCreate}>
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={createForm.warehouse_id}
          onChange={(id) => setCreateForm({ ...createForm, warehouse_id: id })}
          required
        />
        <EntitySelect
          entity="material"
          label="Material"
          value={createForm.material_id}
          onChange={(id) => setCreateForm({ ...createForm, material_id: id })}
          required
        />
        <div className="sf-field">
          <label>Process Type</label>
          <select name="process_type" value={createForm.process_type} onChange={handleCreateChange}>
            <option value="wet">Wet</option>
            <option value="dry">Dry</option>
          </select>
        </div>
        <div className="sf-field">
          <label>Available Stock (Tons)</label>
          <input type="number" value={availableStock} readOnly />
        </div>
        <div className="sf-field">
          <label>Input Qty (Tons)</label>
          <input name="input_qty" type="number" step="0.01" min="0.01" value={createForm.input_qty} onChange={handleCreateChange} required />
        </div>
        <button className="sf-submit" type="submit" disabled={!createForm.warehouse_id || !createForm.material_id}>Create Batch</button>
      </form>

      {selectedBatch && (
        <form className="sf-form" onSubmit={handleFinalize}>
          <h3 style={{ gridColumn: "1 / -1" }}>Production Output: {selectedBatch.batch_no}</h3>
          <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
            Enter the final quantities. Completing this output sends the batch to the Packing tab.
          </p>
          <div className="sf-field">
            <label>Input Qty (Tons)</label>
            <input name="input_qty" type="number" step="0.01" min="0.01" value={outputForm.input_qty} onChange={handleOutputChange} required />
          </div>
        {[
          ["long_qty", "Long Qty (Tons)", true],
          ["medium_qty", "Medium Qty (Tons)", false],
          ["broken_qty", "Broken Qty (Tons)", false],
          ["small_broken_qty", "Small Broken Qty (Tons)", false],
        ].map(([name, label, required]) => (
          <div className="sf-field" key={name}>
            <label>{label}</label>
            <input name={name} type="number" min="0" step="0.01" value={outputForm[name]} onChange={handleOutputChange} required={required} />
          </div>
        ))}
          <button className="sf-submit" type="submit">Save Output &amp; Send to Packing</button>
        </form>
      )}

      <h3>Production History</h3>
      <DataTable
        loading={loading}
        rows={batches}
        columns={[
          { key: "batch_no", label: "Batch No." },
          {
            key: "material",
            label: "Material",
            render: (row) => {
              const materialId = row.lot?.material_id ?? row.material_id;
              return materialId ? materials.getLabel(materialId) : "—";
            },
          },
          {
            key: "warehouse",
            label: "Warehouse",
            render: (row) => {
              const warehouseId = row.lot?.warehouse_id ?? row.warehouse_id;
              return warehouseId ? warehouses.getLabel(warehouseId) : "—";
            },
          },
          { key: "input_qty", label: "Input (Tons)" },
          { key: "process_type", label: "Process" },
          { key: "batch_status", label: "Status" },
          { key: "current_stage", label: "Stage", render: (row) => <span className="dt-badge">{row.current_stage}</span> },
        ]}
      />
      <ModuleGuide
        title="Production"
        steps={[
          "Choose the warehouse and raw material that has stock available in tons.",
          "Set the input quantity against that stock and choose Wet or Dry process type.",
          "After batch creation, enter the final long, medium, broken, and small-broken output quantities in tons.",
          "The system reduces the raw stock and records the produced output back into warehouse stock so it can later be dispatched.",
        ]}
      />
    </div>
  );
}
