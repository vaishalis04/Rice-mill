import { useState, useEffect } from "react";
import { getLotsApi, updateLotApi, routeLotApi, deleteLotApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// Lots is now the master view/management screen for every lot that exists —
// both routed and still-pending. Recording a *new* unload (which opens a
// lot) lives on the separate Unloading page; this page is for looking a lot
// up, correcting its qty/material/variety, tracing its warehouse/bin
// placement, or routing it if that step was skipped on the Unloading page.
export default function LotsPage() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ qty: "", material_id: "", variety_id: "" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const gateEntries = useEntityLookup("gate_entry");

  const load = () => {
    setLoading(true);
    getLotsApi()
      .then((res) => setLots(res.data.data ?? res.data))
      .catch(() => setError("Failed to load lots"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleEdit = (row) => {
    setEditingId(row.id);
    setEditForm({
      qty: row.qty ?? "",
      material_id: row.material?.id ?? "",
      variety_id: row.variety?.id ?? "",
    });
    setError("");
    setInfo("");
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {};
      if (editForm.qty !== "") payload.qty = Number(editForm.qty);
      if (editForm.material_id !== "") payload.material_id = Number(editForm.material_id);
      if (editForm.variety_id !== "") payload.variety_id = Number(editForm.variety_id);

      await updateLotApi(editingId, payload);
      setInfo("Lot updated.");
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  const handleCancelEdit = () => setEditingId(null);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lot?")) return;
    try {
      await deleteLotApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRoute = async (id, destination) => {
    setError("");
    setInfo("");
    try {
      await routeLotApi(id, destination);
      setInfo(`Lot routed to ${destination} — linked gate entry moved to unloaded.`);
      gateEntries.refetch();
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Routing failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Lots</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {editingId && (
        <form className="sf-form" onSubmit={handleUpdate}>
          <div className="sf-field">
            <label>Qty</label>
            <input
              type="number"
              value={editForm.qty}
              onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
            />
          </div>
          <EntitySelect
            entity="material"
            label="Material"
            value={editForm.material_id}
            onChange={(id) => setEditForm({ ...editForm, material_id: id })}
          />
          <EntitySelect
            entity="variety"
            label="Variety"
            value={editForm.variety_id}
            onChange={(id) => setEditForm({ ...editForm, variety_id: id })}
            creatable
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Save Changes
            </button>
            <button type="button" className="sf-cancel" onClick={handleCancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <DataTable
        loading={loading}
        rows={lots}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "lot_no", label: "Lot No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) =>
              row.purchase?.gate_entry_id
                ? gateEntries.getLabel(row.purchase.gate_entry_id)
                : "—",
          },
          {
            key: "material",
            label: "Material",
            render: (row) => row.material?.name || "—",
          },
          {
            key: "variety",
            label: "Variety",
            render: (row) => row.variety?.variety_name || "—",
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) =>
              row.stacks?.[0]?.warehouse
                ? `${row.stacks[0].warehouse.name} (${row.stacks[0].warehouse.warehouse_code})`
                : "—",
          },
          {
            key: "bin_id",
            label: "Bin",
            render: (row) => row.stacks?.[0]?.bin?.bin_code || "—",
          },
          {
            key: "unloading_status",
            label: "Unloading",
            render: (row) =>
              row.unloading_status === "completed" ? (
                <span className="dt-badge">completed</span>
              ) : (
                <span style={{ color: "#a08c6b" }}>bags not counted yet</span>
              ),
          },
          { key: "accepted_bags", label: "Accepted Bags" },
          { key: "rejected_bags", label: "Rejected Bags" },
          { key: "qty", label: "Accepted Qty" },
          { key: "rejected_qty", label: "Rejected Qty" },
          {
            key: "parent_lot",
            label: "Parent Lot",
            render: (row) => row.parentLot?.lot_no || "—",
          },
          {
            key: "destination",
            label: "Destination",
            render: (row) =>
              row.destination ? (
                <span className="dt-badge">{row.destination}</span>
              ) : row.unloading_status === "completed" ? (
                <span style={{ color: "#a08c6b" }}>Not routed</span>
              ) : (
                <span style={{ color: "#a08c6b" }}>—</span>
              ),
          },
          {
            key: "route_actions",
            label: "Route",
            render: (row) =>
              row.destination || row.unloading_status !== "completed" ? null : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="dt-btn" onClick={() => handleRoute(row.id, "warehouse")}>
                    To Warehouse
                  </button>
                  <button className="dt-btn" onClick={() => handleRoute(row.id, "production")}>
                    To Production
                  </button>
                </div>
              ),
          },
        ]}
      />
      <ModuleGuide
        title="Lots"
        steps={[
          "This is the full master list of every lot — the traceable batch tied back to one truckload — whether it's still being unloaded, bag-counted, or already routed.",
          "New lots are opened from the Unloading page's 'Start Unloading' step; bag size and accepted/rejected bag counts are entered there too. This page is for looking lots up and managing them afterwards.",
          "Edit lets you correct qty, material or variety after the fact (e.g. a lab re-grade). Delete soft-removes a lot.",
          "Routing to Warehouse or Production is only available once unloading is completed (bags counted) — if it was skipped on the Unloading page, you can still route it from here.",
        ]}
      />
    </div>
  );
}