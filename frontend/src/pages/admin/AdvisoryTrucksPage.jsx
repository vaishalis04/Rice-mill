import { useState, useEffect } from "react";
import { getAdvisoryTrucksApi, updateAdvisoryTruckApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";

// Admin-only. Every truck that has already exited the gate — Purchase,
// Sales or Empty/Misc — with a place to type free-text Location/Position
// remarks and an Unloading/Loading date. These three fields feed straight
// into the Daily Outward PDF (Reports page) for the same vehicle/day.
// Lives entirely on GateEntry (advisory_location_note / advisory_position_note
// / advisory_date) — no Dispatch model/page/route is touched by this feature.

const emptyForm = { advisory_location_note: "", advisory_position_note: "", advisory_date: "" };

export default function AdvisoryTrucksPage() {
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getAdvisoryTrucksApi()
      .then((res) => setTrucks(res.data.data ?? res.data))
      .catch(() => setError("Failed to load advisory trucks"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openEdit = (row) => {
    setError("");
    setInfo("");
    setEditRow(row);
    setForm({
      advisory_location_note: row.advisory_location_note || "",
      advisory_position_note: row.advisory_position_note || "",
      advisory_date: row.advisory_date || "",
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editRow) return;
    setSaving(true);
    setError("");
    try {
      await updateAdvisoryTruckApi(editRow.id, form);
      setInfo(`Saved for ${editRow.token_no}.`);
      setEditRow(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.msg || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Advisory Trucks</h2>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Every truck that has exited the gate. Add a Location / Position remark and an Unloading or Loading date —
        these show up on the Daily Outward report (Reports page) for the same vehicle and date.
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-info">{info}</div>}

      <DataTable
        loading={loading}
        rows={trucks}
        columns={[
          { key: "token_no", label: "Token No." },
          { key: "vehicle_no", label: "Vehicle No." },
          {
            key: "driver_name",
            label: "Driver Name",
            render: (row) => row.driver_name || "—",
          },
          {
            key: "driver_mobile",
            label: "Driver No.",
            render: (row) => row.driver_mobile || "—",
          },
          {
            key: "po_so_id",
            label: "PO / SO ID",
            render: (row) => row.po_so_id || "—",
          },
          {
            key: "party_name",
            label: "Party Name",
            render: (row) => row.party_name || "—",
          },
          {
            key: "entry_type",
            label: "Type",
            render: (row) =>
              row.entry_type === "purchase" ? "Purchase" : row.entry_type === "sales" ? "Sales (Outbound)" : "Empty / Misc",
          },
          {
            key: "exit_time",
            label: "Exit Time",
            render: (row) => (row.exit_time ? new Date(row.exit_time).toLocaleString() : "—"),
          },
          {
            key: "advisory_location_note",
            label: "Location",
            render: (row) => row.advisory_location_note || "—",
          },
          {
            key: "advisory_position_note",
            label: "Position",
            render: (row) => row.advisory_position_note || "—",
          },
          {
            key: "advisory_date",
            label: "Unloading / Loading Date",
            render: (row) => row.advisory_date || "—",
          },
          {
            key: "actions",
            label: "Actions",
            render: (row) => (
              <button className="dt-btn" onClick={() => openEdit(row)}>
                Add / Edit Remarks
              </button>
            ),
          },
        ]}
      />

      {editRow && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            zIndex: 1000,
            overflowY: "auto",
          }}
          onClick={() => setEditRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 480, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              Advisory Remarks — {editRow.token_no} ({editRow.vehicle_no})
            </h3>
            <p className="field-hint" style={{ marginTop: -6 }}>
              Shown on the Daily Outward report for this vehicle on the matching date.
            </p>
            <form className="sf-form" onSubmit={handleSave}>
              <div className="sf-field">
                <label>Location</label>
                <input
                  value={form.advisory_location_note}
                  onChange={(e) => setForm({ ...form, advisory_location_note: e.target.value })}
                  placeholder="e.g. on the way / reached destination"
                />
              </div>
              <div className="sf-field">
                <label>Position</label>
                <input
                  value={form.advisory_position_note}
                  onChange={(e) => setForm({ ...form, advisory_position_note: e.target.value })}
                  placeholder="e.g. 1 Day / Call Not Received"
                />
              </div>
              <div className="sf-field">
                <label>Unloading / Loading Date</label>
                <input
                  type="date"
                  value={form.advisory_date || ""}
                  onChange={(e) => setForm({ ...form, advisory_date: e.target.value })}
                />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                <button className="sf-submit" type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="dt-btn" onClick={() => setEditRow(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModuleGuide
        title="Advisory Trucks"
        steps={[
          "Shows every truck (Purchase, Sales or Empty/Misc) that has already exited the gate — newest exit first.",
          "\"Add / Edit Remarks\" lets you type a Location and Position note and set an Unloading/Loading date for that truck.",
          "These three fields feed the Daily Outward PDF on the Reports page — matched to the same vehicle on the same date.",
          "This is admin-only and doesn't change anything about how trucks move through the Gate, Weighbridge or Dispatch flows.",
        ]}
      />
    </div>
  );
}