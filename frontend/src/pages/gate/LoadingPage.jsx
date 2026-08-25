import { useState, useEffect } from "react";
import {
  getLoadingsApi,
  createLoadingApi,
  updateLoadingApi,
  deleteLoadingApi,
  updateSalesOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = { gate_entry_id: "", loaded_qty: "", remarks: "" };

export default function LoadingPage() {
  const [loadings, setLoadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [selectedSoItemId, setSelectedSoItemId] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [completingSoId, setCompletingSoId] = useState(null);


  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const salesOrders = useEntityLookup("sales_order");
  const salesOrderGroups = useEntityLookup("sales_order_grouped");

  const getGateEntryRow = (gate_entry_id) =>
    gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id));

  const selectedGateEntry = getGateEntryRow(form.gate_entry_id);
  const selectedSalesOrder = selectedSoItemId
    ? salesOrders.rows.find((r) => String(r.id) === String(selectedSoItemId))
    : null;
  const selectedRemainingQty = selectedSalesOrder
    ? Math.round((Number(selectedSalesOrder.qty) - Number(selectedSalesOrder.dispatched_qty || 0)) * 100) / 100
    : null;
  const soGroup = selectedGateEntry
    ? salesOrderGroups.rows.find(
        (g) => Array.isArray(g.items) && g.items.some((i) => String(i.id) === String(selectedGateEntry.so_id))
      )
    : null;

  const load = () => {
    setLoading(true);
    getLoadingsApi()
      .then((res) => setLoadings(res.data.data ?? res.data))
      .catch(() => setError("Failed to load loading records"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleGateEntryChange = (gate_entry_id) => {
    setForm({ ...form, gate_entry_id });
    const ge = getGateEntryRow(gate_entry_id);
    setSelectedSoItemId(ge ? ge.so_id : "");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLastResult(null);
    try {
      if (editingId) {
        await updateLoadingApi(editingId, { loaded_qty: Number(form.loaded_qty), remarks: form.remarks });
        setInfo("Loading record updated.");
      } else {
        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          loaded_qty: Number(form.loaded_qty),
        };
        if (form.remarks) payload.remarks = form.remarks;
        if (selectedSoItemId && selectedGateEntry && String(selectedSoItemId) !== String(selectedGateEntry.so_id)) {
          payload.so_id = Number(selectedSoItemId);
        }
        const res = await createLoadingApi(payload);
        setInfo(
          res.data.msg ||
            "Loading recorded — gate entry moved to 'loaded', ready for check-out."
        );
        setLastResult({
          so_id: res.data.so_id,
          so_no: res.data.so_no,
          ordered_qty: res.data.ordered_qty,
          dispatched_qty: res.data.dispatched_qty,
          remaining_qty: res.data.remaining_qty,
          is_fully_loaded: res.data.is_fully_loaded,
        });
        gateEntries.refetch();
        salesOrders.refetch();
        salesOrderGroups.refetch();
      }
      setForm(emptyForm);
      setSelectedSoItemId("");
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.msg ||
          err.response?.data?.message ||
          "Save failed — the gate entry may not be a sales truck at 'waiting_loading' yet."
      );
    }
  };

  const handleMarkCompleted = async () => {
    if (!lastResult) return;
    setCompletingSoId(lastResult.so_id);
    setError("");
    try {
      await updateSalesOrderApi(lastResult.so_id, { so_status: "closed" });
      setInfo(
        `Sales Order ${lastResult.so_no} marked completed (closed) with ${lastResult.remaining_qty} left unloaded.`
      );
      setLastResult(null);
      salesOrders.refetch();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not mark the order completed");
    } finally {
      setCompletingSoId(null);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      loaded_qty: row.loaded_qty ?? "",
      remarks: row.remarks || "",
    });
    setSelectedSoItemId(row.so_id || "");
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedSoItemId("");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this loading record?")) return;
    try {
      await deleteLoadingApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Loading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={handleGateEntryChange}
          filter={(row) => row.entry_type === "sales" && row.gate_status === "waiting_loading"}
          required={!editingId}
          disabled={!!editingId}
        />
        {!editingId && selectedGateEntry && (
          <div className="sf-field">
            <label>Details</label>
            <div
              style={{
                padding: "8px 10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <div><strong>Vehicle:</strong> {vehicles.getLabel(selectedGateEntry.vehicle_id)}</div>
              <div><strong>Driver:</strong> {drivers.getLabel(selectedGateEntry.driver_id)}</div>
              <div><strong>Sales Order:</strong> {soGroup ? soGroup.so_no : salesOrders.getLabel(selectedGateEntry.so_id)}</div>
              {soGroup && <div><strong>Customer:</strong> {soGroup.customer?.name || "—"}</div>}
            </div>
          </div>
        )}
        {!editingId && soGroup && (
          <div className="sf-field">
            <label>Which material is this truck loading?</label>
            <div
              style={{
                padding: "8px 10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {soGroup.items.length > 1 && (
                <div style={{ color: "#b45309", marginBottom: 6, fontWeight: 600 }}>
                  This Sales Order covers {soGroup.items.length} materials — tap the one on this truck ↓
                </div>
              )}
              {soGroup.items.map((i, idx) => {
                const remaining = Math.round((Number(i.qty || 0) - Number(i.dispatched_qty || 0)) * 100) / 100;
                const isSelected = String(i.id) === String(selectedSoItemId);
                const isDone = ["dispatched", "closed", "cancelled"].includes(i.so_status);
                const clickable = soGroup.items.length > 1 && !isDone;
                return (
                  <div
                    key={i.id}
                    onClick={clickable ? () => setSelectedSoItemId(i.id) : undefined}
                    style={{
                      marginTop: idx === 0 ? 0 : 6,
                      paddingTop: idx === 0 ? 0 : 6,
                      borderTop: idx === 0 ? "none" : "1px dashed #e2e8f0",
                      color: isDone ? "#94a3b8" : isSelected ? "#1d4ed8" : undefined,
                      textDecoration: isDone ? "line-through" : "none",
                      cursor: clickable ? "pointer" : "default",
                      background: isSelected ? "#eff6ff" : "transparent",
                      borderRadius: 4,
                      padding: isSelected ? "4px 6px" : "0",
                      margin: isSelected ? "2px -6px" : undefined,
                    }}
                  >
                    <strong>{i.material?.name || "—"}</strong> — Ordered {i.qty}, Remaining {remaining}
                    {isDone ? " (fully loaded)" : isSelected ? " ← loading this" : clickable ? " (tap to select)" : ""}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="sf-field">
          <label>Loaded Qty (Tons)</label>
          <input
            name="loaded_qty"
            type="number"
            step="0.01"
            value={form.loaded_qty}
            onChange={handleChange}
            required
          />
          {!editingId && selectedSalesOrder && (
            <p className="field-hint">
              Cannot exceed the Sales Order's remaining qty for this material ({selectedRemainingQty}
              {selectedRemainingQty < selectedSalesOrder.qty ? " — some was already loaded by an earlier truck" : ""}).
            </p>
          )}
        </div>
        <div className="sf-field">
          <label>Remarks (optional)</label>
          <input name="remarks" value={form.remarks} onChange={handleChange} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Loading" : "Record Loading"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {lastResult && !lastResult.is_fully_loaded && (
        <div
          className="sf-form"
          style={{ background: "#fffbeb", border: "1px solid #f5d76e", marginTop: 0 }}
        >
          <h4 style={{ marginTop: 0 }}>
            Sales Order {lastResult.so_no} — {lastResult.remaining_qty} of {lastResult.ordered_qty} still remaining
          </h4>
          <p className="field-hint" style={{ marginTop: -6 }}>
            This truck didn't finish the material — ask Gate to check in another truck against{" "}
            <strong>{lastResult.so_no}</strong> for the remaining {lastResult.remaining_qty}, or close it out
            now if no more will be loaded against it.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="sf-cancel"
              onClick={handleMarkCompleted}
              disabled={completingSoId === lastResult.so_id}
            >
              {completingSoId === lastResult.so_id ? "Marking Completed…" : "Order Completed"}
            </button>
          </div>
        </div>
      )}
      {lastResult && lastResult.is_fully_loaded && (
        <div className="dt-success" style={{ marginTop: 0 }}>
          ✅ Sales Order {lastResult.so_no} is now fully loaded ({lastResult.dispatched_qty}/
          {lastResult.ordered_qty}) and automatically marked 'dispatched'.
        </div>
      )}

      <DataTable
        loading={loading}
        rows={loadings}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "loading_no", label: "Loading No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          {
            key: "vehicle",
            label: "Vehicle No.",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? vehicles.getLabel(ge.vehicle_id) : "—";
            },
          },
          {
            key: "so_id",
            label: "Sales Order",
            render: (row) => salesOrders.getLabel(row.so_id),
          },
          { key: "loaded_qty", label: "Loaded Qty (Tons)" },
          {
            key: "lab_comment",
            label: "Lab Comment",
            render: (row) => row.gateEntry?.samplings?.find((s) => s.labTest?.comment)?.labTest?.comment || "—",
          },
          {
            key: "loaded_at",
            label: "Loaded At",
            render: (row) => (row.loaded_at ? new Date(row.loaded_at).toLocaleString() : "—"),
          },
        ]}
      />

      <ModuleGuide
        title="Loading"
        steps={[
          "Only sales (outbound) gate entries that are checked in and 'waiting_loading' show up here — generate a Sales token and check it in on the Gate Entry tab first.",
          "Selecting a Gate Entry shows the vehicle, driver, and its Sales Order. If that Sales Order covers more than one material, tap which one this truck is actually collecting — Gate Entry itself doesn't ask this.",
          "Enter the actual quantity loaded onto the truck — it can't exceed that material's REMAINING quantity (not the full ordered quantity, if an earlier truck already loaded part of it).",
          "Submitting moves the gate entry to 'loaded' (ready for check-out on the Gate Entry tab).",
          "If that material isn't fully loaded yet, ask Gate to check in another truck against the same Sales Order for the rest, or use 'Order Completed' to close it out early (e.g. the buyer accepts a partial delivery).",
          "Once a material is fully loaded, it stops showing up as pickable here — the Sales Order itself only auto-closes as 'dispatched' once every material on it is fully loaded.",
          "This is a simplified, quantity-only record. For granular per-bag/pallet picking of Finished Goods and a printable delivery challan, use the separate Dispatch module instead.",
        ]}
      />
    </div>
  );
}