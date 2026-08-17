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

// Outbound loading capture for Sales (entry_type = "sales") gate entries.
// A truck must already be checked in (gate_status = "waiting_loading")
// before it can be loaded here. Submitting moves the gate entry to "loaded"
// (ready for check-out) and adds to the linked Sales Order's running
// dispatched_qty. A Sales Order can be loaded across multiple trucks —
// it only auto-closes as "dispatched" once fully loaded; until then it
// stays "allocated" and this page offers "Load New Truck" (jump to Gate
// Entry with the same Sales Order pre-selected) or "Mark Order Completed"
// (stop early, e.g. the buyer accepts a partial delivery).
const emptyForm = { gate_entry_id: "", loaded_qty: "", remarks: "" };

export default function LoadingPage({ onLoadNewTruck } = {}) {
  const [loadings, setLoadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  // Set right after a successful "Record Loading" — drives the follow-up
  // "Load New Truck" / "Order Completed" panel below the form.
  const [lastResult, setLastResult] = useState(null);
  const [completingSoId, setCompletingSoId] = useState(null);


  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const salesOrders = useEntityLookup("sales_order");

  const getGateEntryRow = (gate_entry_id) =>
    gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id));

  const selectedGateEntry = getGateEntryRow(form.gate_entry_id);
  const selectedSalesOrder = selectedGateEntry
    ? salesOrders.rows.find((r) => String(r.id) === String(selectedGateEntry.so_id))
    : null;
  const selectedRemainingQty = selectedSalesOrder
    ? Math.round((Number(selectedSalesOrder.qty) - Number(selectedSalesOrder.dispatched_qty || 0)) * 100) / 100
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
        const res = await createLoadingApi(payload);
        setInfo(
          res.data.msg ||
            "Loading recorded — gate entry moved to 'loaded', ready for check-out."
        );
        // Drives the follow-up panel: Load New Truck / Order Completed,
        // only relevant when the order wasn't fully loaded by this truck.
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
      }
      setForm(emptyForm);
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

  const handleLoadNewTruckClick = () => {
    if (lastResult && onLoadNewTruck) onLoadNewTruck(lastResult.so_id);
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
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
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
          onChange={(id) => setForm({ ...form, gate_entry_id: id })}
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
              <div><strong>Sales Order:</strong> {salesOrders.getLabel(selectedGateEntry.so_id)}</div>
              {selectedSalesOrder && (
                <>
                  <div><strong>Ordered Qty:</strong> {selectedSalesOrder.qty}</div>
                  <div><strong>Already Loaded:</strong> {selectedSalesOrder.dispatched_qty || 0}</div>
                  <div><strong>Remaining:</strong> {selectedRemainingQty}</div>
                </>
              )}
            </div>
          </div>
        )}
        <div className="sf-field">
          <label>Loaded Qty</label>
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
              Cannot exceed the Sales Order's remaining qty ({selectedRemainingQty}
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
            This truck didn't finish the order. Load another truck for the rest, or close the
            order out now if no more will be loaded against it.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="dt-btn" onClick={handleLoadNewTruckClick}>
              Load New Truck for Remaining Qty ({lastResult.remaining_qty})
            </button>
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
          { key: "loaded_qty", label: "Loaded Qty" },
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
          "Selecting a Gate Entry shows the vehicle, driver, linked Sales Order, and how much of it is already loaded vs still remaining.",
          "Enter the actual quantity loaded onto the truck — it can't exceed the Sales Order's REMAINING quantity (not the full ordered quantity, if an earlier truck already loaded part of it).",
          "Submitting moves the gate entry to 'loaded' (ready for check-out on the Gate Entry tab).",
          "If the order isn't fully loaded yet, you'll get two options: 'Load New Truck for Remaining Qty' jumps to Gate Entry with the same Sales Order pre-selected so you can token in the next truck, or 'Order Completed' closes the order out early (e.g. the buyer accepts a partial delivery).",
          "Once fully loaded, the Sales Order automatically closes as 'dispatched' — no further trucks can be opened against it.",
          "This is a simplified, quantity-only record. For granular per-bag/pallet picking of Finished Goods and a printable delivery challan, use the separate Dispatch module instead.",
        ]}
      />
    </div>
  );
}