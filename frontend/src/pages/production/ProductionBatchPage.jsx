import { useState, useEffect } from "react";
import {
  getProductionBatchesApi,
  createProductionBatchApi,
  getProductionBatchByIdApi,
  patchDryerStageApi,
  patchMillingStageApi,
  patchSeparatorStageApi,
  patchShinerStageApi,
  patchColorSorterStageApi,
  patchLengthGradingStageApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// One entry per possible `current_stage` value. `apply` calls the right
// PATCH endpoint. start_time/end_time are NOT listed as fields here — they
// come from the Start/Done timer instead (see StageForm). `machineHints`
// are lowercase keywords matched against each machine's machine_type, used
// to auto-suggest the right machine for this stage — the person can still
// change the pick, this just saves them hunting for it every time.
const STAGE_CONFIG = {
  dryer: {
    label: "Dryer",
    apply: patchDryerStageApi,
    machineHints: ["dryer", "dry"],
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine", required: true },
      { name: "moisture_before", label: "Moisture Before (%)", type: "number", required: true },
      { name: "moisture_after", label: "Moisture After (%)", type: "number", required: true },
    ],
    note: "Pass = moisture_after ≤ 14% (unless a target_moisture override applies). Fail keeps the batch here and sets it on_hold — just resubmit after re-drying.",
  },
  milling: {
    label: "Milling",
    apply: patchMillingStageApi,
    machineHints: ["hull", "mill"],
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine", required: true },
      { name: "output_qty", label: "Output Qty", type: "number", required: true },
      { name: "husk_qty", label: "Husk Qty", type: "number" },
      { name: "broken_qty", label: "Broken Qty", type: "number" },
    ],
    note: "husk_qty/broken_qty also write by-product Inventory — needs Material Master rows with category husk/broken to exist first, or that write is silently skipped.",
  },
  separator: {
    label: "Separator",
    apply: patchSeparatorStageApi,
    machineHints: ["separat"],
    fields: [
      { name: "machine_id", label: "Machine (optional)", type: "entity", entity: "machine" },
      { name: "cleaned_qty", label: "Cleaned Qty", type: "number", required: true },
      { name: "impurity_qty", label: "Impurity Qty", type: "number" },
      { name: "stone_qty", label: "Stone Qty", type: "number" },
      { name: "dust_qty", label: "Dust Qty", type: "number" },
    ],
  },
  shiner: {
    label: "Shiner",
    apply: patchShinerStageApi,
    machineHints: ["shin"],
    fields: [
      { name: "stage_no", label: "Pass No. (1–5)", type: "number", required: true },
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine", required: true },
      { name: "output_qty", label: "Output Qty", type: "number", required: true },
      { name: "loss_qty", label: "Loss Qty", type: "number" },
      { name: "bran_qty", label: "Bran Qty", type: "number" },
      { name: "is_final", label: "This is the final pass (advances to Color Sorter)", type: "checkbox" },
    ],
    note: "Batch stays at shiner between passes — submit again with the next stage_no. Mark is_final (or use stage_no 5) on the last one.",
  },
  color_sorter: {
    label: "Color Sorter",
    apply: patchColorSorterStageApi,
    machineHints: ["color", "sort"],
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine", required: true },
      { name: "good_qty", label: "Good Qty", type: "number", required: true },
      { name: "rejected_qty", label: "Rejected Qty", type: "number" },
    ],
  },
  length_grading: {
    label: "Length Grading (final stage)",
    apply: patchLengthGradingStageApi,
    machineHints: ["grad", "length"],
    fields: [
      { name: "machine_id", label: "Machine", type: "entity", entity: "machine", required: true },
      { name: "long_qty", label: "Long Qty", type: "number", required: true },
      { name: "medium_qty", label: "Medium Qty", type: "number" },
      { name: "broken_qty", label: "Broken Qty", type: "number" },
      { name: "small_broken_qty", label: "Small Broken Qty", type: "number" },
    ],
    note: "This is the terminal stage — submitting it marks the batch completed.",
  },
};

function emptyStageForm(stage) {
  const form = {};
  (STAGE_CONFIG[stage]?.fields || []).forEach((f) => {
    form[f.name] = f.type === "checkbox" ? false : "";
  });
  return form;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Auto-select-machine + Start/Timer/Done stage form. Keyed by
// batch.current_stage from the parent so it fully remounts (fresh timer,
// fresh auto-pick) every time the stage advances.
function StageForm({ batch, machineRows, onDone }) {
  const stage = STAGE_CONFIG[batch.current_stage];
  const [form, setForm] = useState(() => emptyStageForm(batch.current_stage));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Auto-suggest the machine for this stage as soon as the machine list is
  // available — matches machine_type against this stage's keyword hints.
  // The dropdown stays fully editable if the guess is wrong.
  useEffect(() => {
    if (!stage) return;
    const machineField = stage.fields.find((f) => f.type === "entity" && f.entity === "machine");
    if (!machineField || form[machineField.name]) return;
    const hints = stage.machineHints || [];
    const match = machineRows.find((m) =>
      hints.some((h) => (m.machine_type || m.name || "").toLowerCase().includes(h))
    );
    if (match) setForm((prev) => ({ ...prev, [machineField.name]: match.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineRows]);

  // Live ticking clock while running.
  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, finishedAt]);

  if (!stage) return null; // e.g. current_stage === "completed" — nothing to submit

  const elapsedSec = startedAt ? Math.floor(((finishedAt ?? now) - startedAt) / 1000) : 0;
  const clock = `${pad2(Math.floor(elapsedSec / 60))}:${pad2(elapsedSec % 60)}`;

  const handleFieldChange = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const handleStart = () => {
    setError("");
    setStartedAt(Date.now());
    setFinishedAt(null);
  };

  const handleMarkDone = () => setFinishedAt(Date.now());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!startedAt) {
      setError("Click Start first — the run needs a start time before it can be submitted.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {};
      stage.fields.forEach((f) => {
        const v = form[f.name];
        if (f.type === "checkbox") {
          if (v) payload[f.name] = true;
          return;
        }
        if (v === "" || v == null) return; // skip blank optionals
        payload[f.name] = f.type === "number" ? Number(v) : v;
      });
      payload.start_time = new Date(startedAt).toISOString();
      payload.end_time = new Date(finishedAt ?? Date.now()).toISOString();
      await stage.apply(batch.id, payload);
      onDone();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Stage update failed — check required fields, or this stage may be out of order."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="sf-form" onSubmit={handleSubmit}>
      <h3 style={{ marginTop: 0, gridColumn: "1 / -1" }}>Stage: {stage.label}</h3>
      {stage.note && (
        <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: -6, gridColumn: "1 / -1" }}>
          {stage.note}
        </p>
      )}
      {error && <div className="dt-error" style={{ gridColumn: "1 / -1" }}>{error}</div>}

      <div className="stage-timer" style={{ gridColumn: "1 / -1" }}>
        {!startedAt && (
          <button type="button" className="stage-start-btn" onClick={handleStart}>
            ▶ Start {stage.label}
          </button>
        )}
        {startedAt && !finishedAt && (
          <>
            <span className="stage-clock running">{clock}</span>
            <button type="button" className="stage-done-btn" onClick={handleMarkDone}>
              ✔ Done — stop timer
            </button>
          </>
        )}
        {startedAt && finishedAt && (
          <span className="stage-clock finished">
            Finished in {clock} — fill in the results below and submit.
          </span>
        )}
      </div>

      {stage.fields.map((f) =>
        f.type === "entity" ? (
          <EntitySelect
            key={f.name}
            entity={f.entity}
            label={f.label}
            value={form[f.name] ?? ""}
            onChange={(id) => handleFieldChange(f.name, id)}
            required={f.required}
            creatable={f.entity === "machine"}
          />
        ) : f.type === "checkbox" ? (
          <label key={f.name} className="sf-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={!!form[f.name]}
              onChange={(e) => handleFieldChange(f.name, e.target.checked)}
            />
            {f.label}
          </label>
        ) : (
          <div className="sf-field" key={f.name}>
            <label>{f.label}</label>
            <input
              type={f.type === "number" ? "number" : f.type || "text"}
              step={f.type === "number" ? "any" : undefined}
              value={form[f.name] ?? ""}
              onChange={(e) => handleFieldChange(f.name, e.target.value)}
              required={f.required}
            />
          </div>
        )
      )}

      <button className="sf-submit" type="submit" disabled={submitting} style={{ gridColumn: "1 / -1" }}>
        {submitting ? "Submitting…" : `Submit ${stage.label}`}
      </button>
    </form>
  );
}

function BatchDetail({ batchId, machineRows, onClose, onChanged }) {
  const [batch, setBatch] = useState(null);
  const [error, setError] = useState("");

  const reload = () => {
    getProductionBatchByIdApi(batchId)
      .then((res) => setBatch(res.data.data ?? res.data))
      .catch(() => setError("Failed to load batch detail"));
  };

  useEffect(reload, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="dt-error">{error}</div>;
  if (!batch) return <p className="dt-msg">Loading…</p>;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>
          {batch.batch_no || `Batch #${batch.id}`}{" "}
          <span className="dt-badge">{batch.current_stage}</span>
        </h3>
        <button type="button" className="sf-cancel" onClick={onClose}>
          Close
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: "0.85rem" }}>
        Process: {batch.process_type} · Status: {batch.batch_status}
      </p>

      {batch.current_stage === "completed" ? (
        <p style={{ color: "#15803d" }}>
          ✓ This batch is complete — full stage history is in the batch record from the backend.
        </p>
      ) : (
        <StageForm
          key={batch.current_stage}
          batch={batch}
          machineRows={machineRows}
          onDone={() => {
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function ProductionBatchPage() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [lotId, setLotId] = useState("");
  const [processType, setProcessType] = useState("wet");

  const lots = useEntityLookup("lot");
  const machines = useEntityLookup("machine");

  const load = () => {
    setLoading(true);
    getProductionBatchesApi()
      .then((res) => setBatches(res.data.data ?? res.data))
      .catch(() => setError("Failed to load batches"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const res = await createProductionBatchApi({
        lot_id: Number(lotId),
        process_type: processType,
      });
      const created = res.data.data ?? res.data;
      setInfo(
        `Batch created${created?.batch_no ? ` (${created.batch_no})` : ""} — starting at "${
          created?.current_stage || (processType === "dry" ? "milling" : "dryer")
        }".`
      );
      setLotId("");
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't create batch");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Production Batches</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <form className="sf-form" onSubmit={handleCreate}>
        <EntitySelect
          entity="lot"
          label="Lot"
          value={lotId}
          onChange={setLotId}
          required
        />
        <div className="sf-field">
          <label>Process Type</label>
          <select value={processType} onChange={(e) => setProcessType(e.target.value)}>
            <option value="wet">Wet (starts at Dryer)</option>
            <option value="dry">Dry (starts at Milling)</option>
          </select>
        </div>
        <button className="sf-submit" type="submit">
          Create Batch
        </button>
      </form>

      {selectedId && (
        <BatchDetail
          batchId={selectedId}
          machineRows={machines.rows}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}

      <DataTable
        loading={loading}
        rows={batches}
        columns={[
          { key: "batch_no", label: "Batch No." },
          {
            key: "lot_id",
            label: "Lot",
            render: (row) => lots.getLabel(row.lot_id),
          },
          { key: "process_type", label: "Process" },
          {
            key: "current_stage",
            label: "Stage",
            render: (row) => <span className="dt-badge">{row.current_stage}</span>,
          },
          { key: "batch_status", label: "Status" },
          {
            key: "open",
            label: "",
            render: (row) => (
              <button className="dt-btn" onClick={() => setSelectedId(row.id)}>
                {row.current_stage === "completed" ? "View" : "Continue"}
              </button>
            ),
          },
        ]}
      />
      <ModuleGuide
        title="Production Batches"
        steps={[
          "Create a batch from a Lot. Wet grain starts at Dryer; dry grain skips straight to Milling.",
          "Click Continue on a batch to open its current stage — the machine is pre-picked for you, click Start when work begins, and Done when it finishes to record the run time automatically.",
          "Fill in the stage's results and Submit — the batch moves to the next stage on its own, and the next stage's machine gets pre-picked too.",
          "Once Length Grading is submitted the batch is 'completed' and ready to appear in Packing.",
        ]}
      />
    </div>
  );
}
