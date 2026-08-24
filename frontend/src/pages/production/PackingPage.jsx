import { useState, useEffect, useMemo } from "react";
import {
  getPackingsApi,
  createPackingApi,
  updatePackingApi,
  deletePackingApi,
  getGradedOutputsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// Quick-pick presets, plus "__custom__" — a UI-only sentinel for "type your own
// kg-per-bag value". The actual value sent to the backend is always a real number
// (either the preset or whatever was typed into the custom field), never the literal
// string "custom" — that's what made custom pack sizes silently fail to save before.
const PACK_SIZE_PRESETS = ["5", "10", "25", "50"];
const CUSTOM_SENTINEL = "__custom__";

const emptyForm = {
  batch_id: "",
  warehouse_id: "",
  pack_size: "25",
  custom_pack_size: "", // kg per bag, only used when pack_size === CUSTOM_SENTINEL
  bag_count: "",
  production_date: "",
  qty_override: "", // optional manual total override, any pack size
  rack_id: "",
  pallet_id: "",
};

// The backend response for graded-outputs isn't 100% pinned down, so this
// tries several common shapes/casings instead of only ever reading
// long_qty/medium_qty/broken_qty/small_broken_qty off the top level. If
// NONE of these match, `matched` comes back false and the UI shows the raw
// JSON instead of silently rendering blank dashes — that's the fastest way
// to see the real field names and fix this for good.
function extractGraded(raw) {
  if (!raw) return null;
  const envelopes = [raw, raw.graded_output, raw.gradedOutput, raw.output, raw.length_grading, raw.lengthGrading, raw.data].filter(
    (x) => x && typeof x === "object"
  );

  for (const c of envelopes) {
    const long_qty = c.long_qty ?? c.longQty ?? c.long;
    const medium_qty = c.medium_qty ?? c.mediumQty ?? c.medium;
    const broken_qty = c.broken_qty ?? c.brokenQty ?? c.broken;
    const small_broken_qty = c.small_broken_qty ?? c.smallBrokenQty ?? c.small_broken;
    if ([long_qty, medium_qty, broken_qty, small_broken_qty].some((v) => v != null)) {
      return {
        matched: true,
        long_qty,
        medium_qty,
        broken_qty,
        small_broken_qty,
        bags_packed_so_far:
          raw.bags_packed_so_far ?? raw.bagsPackedSoFar ?? c.bags_packed_so_far ?? c.bagsPackedSoFar,
        remaining_qty: raw.remaining_qty ?? raw.remainingQty ?? c.remaining_qty ?? c.remainingQty,
        raw,
      };
    }
  }
  return { matched: false, raw };
}

export default function PackingPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ bag_count: "", pack_size: "25", custom_pack_size: "" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [gradedOutputs, setGradedOutputs] = useState(null);
  const [gradedLoading, setGradedLoading] = useState(false);
  const [gradedError, setGradedError] = useState("");
  const [showRawGraded, setShowRawGraded] = useState(false);

  const batches = useEntityLookup("production_batch");
  const warehouses = useEntityLookup("warehouse");

  const load = () => {
    setLoading(true);
    getPackingsApi()
      .then((res) => setRecords(res.data.data ?? res.data))
      .catch(() => setError("Failed to load packing records"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Step 1 of the doc's flow: picking a batch immediately shows its
  // length-grading breakdown + bags already packed so far.
  useEffect(() => {
    if (!form.batch_id) {
      setGradedOutputs(null);
      return;
    }
    setGradedLoading(true);
    setGradedError("");
    setShowRawGraded(false);
    getGradedOutputsApi(form.batch_id)
      .then((res) => setGradedOutputs(extractGraded(res.data.data ?? res.data)))
      .catch(() =>
        setGradedError(
          "Couldn't load graded outputs — this batch may not have finished Length Grading yet."
        )
      )
      .finally(() => setGradedLoading(false));
  }, [form.batch_id]);

  // Total graded qty = sum of the 4 grading buckets. Remaining = whatever
  // the backend explicitly reports as remaining/available, or — if it
  // doesn't send that — the full graded total (best guess when nothing
  // has been packed against this batch yet).
  const totalGraded = useMemo(() => {
    if (!gradedOutputs?.matched) return null;
    const vals = [
      gradedOutputs.long_qty,
      gradedOutputs.medium_qty,
      gradedOutputs.broken_qty,
      gradedOutputs.small_broken_qty,
    ]
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }, [gradedOutputs]);

  const remainingQty = useMemo(() => {
    if (gradedOutputs?.remaining_qty != null) return Number(gradedOutputs.remaining_qty);
    return totalGraded;
  }, [gradedOutputs, totalGraded]);

  // The actual kg-per-bag value to use: either the selected preset, or whatever
  // was typed into the custom field.
  const resolvedPackSize =
    form.pack_size === CUSTOM_SENTINEL ? form.custom_pack_size : form.pack_size;

  // Auto-suggest bag count from remaining qty ÷ pack size. Still editable —
  // this just saves the "get out a calculator" step. Works for custom sizes too now,
  // as soon as a valid custom weight has been typed in.
  useEffect(() => {
    if (remainingQty == null) return;
    const size = Number(resolvedPackSize);
    if (!size || size <= 0) return;
    const bags = Math.max(0, Math.floor(remainingQty / size));
    setForm((prev) => ({ ...prev, bag_count: String(bags) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingQty, resolvedPackSize]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (form.pack_size === CUSTOM_SENTINEL) {
        if (form.custom_pack_size === "" || Number(form.custom_pack_size) <= 0) {
          setError("Enter a valid custom pack size (kg per bag, greater than 0)");
          return;
        }
      }

      const payload = {
        batch_id: Number(form.batch_id),
        warehouse_id: Number(form.warehouse_id),
        pack_size: Number(resolvedPackSize),
        bag_count: Number(form.bag_count),
      };
      if (form.production_date) payload.production_date = form.production_date;
      if (form.qty_override !== "") payload.qty_override = Number(form.qty_override);
      if (form.rack_id) payload.rack_id = form.rack_id;
      if (form.pallet_id) payload.pallet_id = form.pallet_id;

      const res = await createPackingApi(payload);
      const body = res.data.data ?? res.data;
      const packing = body.packing ?? body;
      setInfo(
        `Packing created${packing?.batch_no ? ` (${packing.batch_no})` : ""}` +
          `${packing?.barcode ? ` — barcode ${packing.barcode}` : ""}` +
          " — a matching Finished Goods record was opened with status 'ready'."
      );
      setForm(emptyForm);
      setGradedOutputs(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    const sizeStr = row.pack_size != null ? String(row.pack_size) : "25";
    const isPreset = PACK_SIZE_PRESETS.includes(sizeStr);
    setEditForm({
      bag_count: row.bag_count ?? "",
      pack_size: isPreset ? sizeStr : CUSTOM_SENTINEL,
      custom_pack_size: isPreset ? "" : sizeStr,
    });
  };

  const editResolvedPackSize =
    editForm.pack_size === CUSTOM_SENTINEL ? editForm.custom_pack_size : editForm.pack_size;

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (editForm.pack_size === CUSTOM_SENTINEL && !(Number(editForm.custom_pack_size) > 0)) {
        setError("Enter a valid custom pack size (kg per bag, greater than 0)");
        return;
      }
      await updatePackingApi(editingId, {
        bag_count: Number(editForm.bag_count),
        pack_size: Number(editResolvedPackSize),
      });
      setEditingId(null);
      load();
    } catch {
      setError("Update failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this packing record?")) return;
    try {
      await deletePackingApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Packing</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      {editingId ? (
        <form className="sf-form" onSubmit={handleUpdate}>
          <div className="sf-field">
            <label>Bag Count</label>
            <input
              type="number"
              value={editForm.bag_count}
              onChange={(e) => setEditForm({ ...editForm, bag_count: e.target.value })}
              required
            />
          </div>
          <div className="sf-field">
            <label>Pack Size (kg)</label>
            <select
              value={editForm.pack_size}
              onChange={(e) => setEditForm({ ...editForm, pack_size: e.target.value })}
            >
              {PACK_SIZE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {`${s} kg`}
                </option>
              ))}
              <option value={CUSTOM_SENTINEL}>Custom…</option>
            </select>
          </div>
          {editForm.pack_size === CUSTOM_SENTINEL && (
            <div className="sf-field">
              <label>Custom Pack Size (kg per bag)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editForm.custom_pack_size}
                onChange={(e) => setEditForm({ ...editForm, custom_pack_size: e.target.value })}
                required
                autoFocus
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Save Changes
            </button>
            <button type="button" className="sf-cancel" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form className="sf-form" onSubmit={handleSubmit}>
          <EntitySelect
            entity="production_batch"
            label="Production Batch"
            value={form.batch_id}
            onChange={(id) => setForm({ ...form, batch_id: id })}
            filter={(row) => row.batch_status === "completed"}
            required
          />
          <EntitySelect
            entity="warehouse"
            label="Warehouse"
            value={form.warehouse_id}
            onChange={(id) => setForm({ ...form, warehouse_id: id })}
            required
            creatable
          />
          <div className="sf-field">
            <label>Pack Size (kg)</label>
            <select name="pack_size" value={form.pack_size} onChange={handleChange}>
              {PACK_SIZE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {`${s} kg`}
                </option>
              ))}
              <option value={CUSTOM_SENTINEL}>Custom…</option>
            </select>
          </div>
          {form.pack_size === CUSTOM_SENTINEL && (
            <div className="sf-field">
              <label>Custom Pack Size (kg per bag)</label>
              <input
                name="custom_pack_size"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="e.g. 15"
                value={form.custom_pack_size}
                onChange={handleChange}
                required
                autoFocus
              />
              <p className="field-hint">
                Enter the actual weight of one bag — this is saved as the real pack size,
                not just labelled "custom".
              </p>
            </div>
          )}
          <div className="sf-field">
            <label>
              Bag Count {remainingQty != null && Number(resolvedPackSize) > 0 && "(auto-suggested)"}
            </label>
            <input
              name="bag_count"
              type="number"
              value={form.bag_count}
              onChange={handleChange}
              required
            />
            {remainingQty != null && Number(resolvedPackSize) > 0 && (
              <p className="field-hint">
                Calculated as remaining qty ÷ pack size ({resolvedPackSize} kg) — adjust if needed.
              </p>
            )}
          </div>
          <div className="sf-field">
            <label>Qty (Tons) Override (total kg, optional)</label>
            <input
              name="qty_override"
              type="number"
              value={form.qty_override}
              onChange={handleChange}
              placeholder={
                Number(resolvedPackSize) > 0 && form.bag_count
                  ? `Defaults to ${(Number(resolvedPackSize) * Number(form.bag_count)) || 0} kg`
                  : "Defaults to pack size × bag count"
              }
            />
            <p className="field-hint">
              Only fill this in to correct the total (e.g. a part-filled bag) — otherwise it's
              worked out automatically from pack size × bag count.
            </p>
          </div>
          <div className="sf-field">
            <label>Production Date</label>
            <input
              name="production_date"
              type="date"
              value={form.production_date}
              onChange={handleChange}
            />
          </div>
          <div className="sf-field">
            <label>Rack ID (optional)</label>
            <input name="rack_id" value={form.rack_id} onChange={handleChange} />
          </div>
          <div className="sf-field">
            <label>Pallet ID (optional)</label>
            <input name="pallet_id" value={form.pallet_id} onChange={handleChange} />
          </div>

          {form.batch_id && (
            <div style={{ gridColumn: "1 / -1" }}>
              {gradedLoading && <p className="dt-msg">Loading graded outputs…</p>}
              {gradedError && <div className="dt-error">{gradedError}</div>}
              {gradedOutputs?.matched && (
                <div className="dt-wrapper" style={{ padding: 12 }}>
                  <strong>Graded output for this batch:</strong>
                  <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
                    <span>Long: {gradedOutputs.long_qty ?? "—"}</span>
                    <span>Medium: {gradedOutputs.medium_qty ?? "—"}</span>
                    <span>Broken: {gradedOutputs.broken_qty ?? "—"}</span>
                    <span>Small Broken: {gradedOutputs.small_broken_qty ?? "—"}</span>
                    {gradedOutputs.bags_packed_so_far != null && (
                      <span>Already packed: {gradedOutputs.bags_packed_so_far} bags</span>
                    )}
                    {remainingQty != null && (
                      <span style={{ fontWeight: 700, color: "#1d4ed8" }}>
                        Remaining to pack: {remainingQty} kg
                      </span>
                    )}
                  </div>
                </div>
              )}
              {gradedOutputs && !gradedOutputs.matched && (
                <div className="dt-error">
                  The batch loaded, but none of the expected field names (long_qty, medium_qty,
                  broken_qty, small_broken_qty — or camelCase variants) were found in the
                  response, so nothing can be shown here yet.{" "}
                  <button
                    type="button"
                    className="dt-btn"
                    style={{ marginLeft: 6 }}
                    onClick={() => setShowRawGraded((v) => !v)}
                  >
                    {showRawGraded ? "Hide" : "Show"} raw response
                  </button>
                  {showRawGraded && (
                    <pre
                      style={{
                        marginTop: 8,
                        background: "#0f172a",
                        color: "#e2e8f0",
                        padding: 10,
                        borderRadius: 6,
                        fontSize: "0.75rem",
                        overflowX: "auto",
                      }}
                    >
                      {JSON.stringify(gradedOutputs.raw, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          <button className="sf-submit" type="submit" style={{ gridColumn: "1 / -1" }}>
            Create Packing Record
          </button>
        </form>
      )}

      <DataTable
        loading={loading}
        rows={records}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "batch_no", label: "Packing No." },
          {
            key: "batch_id",
            label: "Batch",
            render: (row) => batches.getLabel(row.batch_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) =>
              row.finishedGoodsRecords?.[0]?.warehouse
                ? `${row.finishedGoodsRecords[0].warehouse.name} (${row.finishedGoodsRecords[0].warehouse.warehouse_code})`
                : "—",
          },
          {
            key: "pack_size",
            label: "Pack Size",
            render: (row) => (row.pack_size != null ? `${row.pack_size} kg` : "—"),
          },
          { key: "bag_count", label: "Bags" },
          { key: "barcode", label: "Barcode" },
        ]}
      />
      <ModuleGuide
        title="Packing"
        steps={[
          "Pick a Production Batch that's finished Length Grading — its graded breakdown and remaining quantity show up automatically.",
          "Choose a pack size from the presets, or pick 'Custom…' and type in any exact weight (e.g. 15 kg, 2 kg) — it's saved as a real number either way.",
          "The bag count is worked out for you (remaining qty ÷ pack size) — adjust it if needed.",
          "Qty (Tons) Override is optional — only use it to correct the total by hand (e.g. a part-filled last bag); otherwise it's pack size × bag count.",
          "Submitting generates a packing number and barcode, and opens a matching Finished Goods record with status 'ready'.",
          "From there, Sales can book an order against it and Dispatch can allocate it to a delivery.",
        ]}
      />
    </div>
  );
}