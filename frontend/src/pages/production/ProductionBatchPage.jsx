import { useEffect, useState } from "react";
import { createProductionBatchApi, finalizeProductionBatchApi, getProductionBatchesApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyCreateForm = {
  lot_id: "",
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
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const lots = useEntityLookup("lot");

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
        lot_id: Number(createForm.lot_id),
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
        First select a lot, process type, and input quantity. After the batch is created, enter the final output.
      </p>
      <form className="sf-form" onSubmit={handleCreate}>
        <EntitySelect
          entity="lot"
          label="Lot"
          value={createForm.lot_id}
          onChange={(id) => setCreateForm({ ...createForm, lot_id: id })}
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
          <label>Input Qty</label>
          <input name="input_qty" type="number" step="0.01" min="0.01" value={createForm.input_qty} onChange={handleCreateChange} required />
        </div>
        <button className="sf-submit" type="submit">Create Batch</button>
      </form>

      {selectedBatch && (
        <form className="sf-form" onSubmit={handleFinalize}>
          <h3 style={{ gridColumn: "1 / -1" }}>Production Output: {selectedBatch.batch_no}</h3>
          <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
            Enter the final quantities. Completing this output sends the batch to the Packing tab.
          </p>
          <div className="sf-field">
            <label>Input Qty</label>
            <input name="input_qty" type="number" step="0.01" min="0.01" value={outputForm.input_qty} onChange={handleOutputChange} required />
          </div>
        {[
          ["long_qty", "Long Qty", true],
          ["medium_qty", "Medium Qty", false],
          ["broken_qty", "Broken Qty", false],
          ["small_broken_qty", "Small Broken Qty", false],
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
          { key: "lot_id", label: "Lot", render: (row) => lots.getLabel(row.lot_id) },
          { key: "process_type", label: "Process" },
          { key: "batch_status", label: "Status" },
          { key: "current_stage", label: "Stage", render: (row) => <span className="dt-badge">{row.current_stage}</span> },
        ]}
      />
      <ModuleGuide
        title="Production"
        steps={[
          "Select a completed unloading lot and choose Wet or Dry process type.",
          "After batch creation, enter the final long, medium, broken, and small-broken quantities.",
          "Saving the output completes production and makes the batch available in Packing.",
        ]}
      />
    </div>
  );
}
