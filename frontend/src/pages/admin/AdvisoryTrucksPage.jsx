import { useState, useEffect } from "react";
import { getAdvisoryTrucksApi, updateAdvisoryTruckApi } from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";

// Admin + Advisory role. Every truck that has already exited the gate —
// Purchase, Sales or Empty/Misc — that is not yet Completed. For each one you
// set a Status (the choices depend on the truck type, and come from the
// server so they can never drift), a free-text Position remark and an
// Unloading/Loading date. Marking a truck "Completed" removes it from this
// list. Lives entirely on GateEntry — no Dispatch model/page/route is touched.

const emptyForm = { advisory_status: "", advisory_position_note: "", advisory_date: "" };

const typeLabel = (t) => (t === "purchase" ? "Purchase" : t === "sales" ? "Sales (Outbound)" : "Empty / Misc");

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
      advisory_status: row.advisory_status || "",
      advisory_position_note: row.advisory_position_note || "",
      advisory_date: row.advisory_date || "",
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editRow) return;

    const markingCompleted = form.advisory_status === "completed";
    // Completed trucks leave this list and can't be brought back from here,
    // so make sure that's intended before saving.
    if (
      markingCompleted &&
      !window.confirm(
        `Mark ${editRow.token_no} (${editRow.vehicle_no}) as Completed?\n\nIt will be removed from the Advisory Trucks list.`
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateAdvisoryTruckApi(editRow.id, form);
      setInfo(
        markingCompleted
          ? `${editRow.token_no} marked Completed and removed from this list.`
          : `Saved for ${editRow.token_no}.`
      );
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
        Every truck that has exited the gate and isn't Completed yet. Set its Status, add a Position remark and an
        Unloading or Loading date. Once a truck is marked Completed it is removed from this list.
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
            key: "materials",
            label: "Materials",
            render: (row) => row.materials || "—",
          },
          {
            key: "entry_type",
            label: "Type",
            render: (row) => typeLabel(row.entry_type),
          },
          {
            key: "exit_time",
            label: "Exit Time",
            render: (row) => (row.exit_time ? new Date(row.exit_time).toLocaleString() : "—"),
          },
          {
            key: "advisory_status",
            label: "Status",
            render: (row) => (row.advisory_status_label ? <span className="dt-badge">{row.advisory_status_label}</span> : "—"),
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
              {typeLabel(editRow.entry_type)}
              {editRow.party_name ? ` · Party: ${editRow.party_name}` : ""}
              {editRow.entry_type === "other" && editRow.materials ? ` · Materials: ${editRow.materials}` : ""}
            </p>
            <form className="sf-form" onSubmit={handleSave}>
              {(editRow.advisory_status_options || []).length > 0 && (
                <div className="sf-field">
                  <label>Status</label>
                  <select
                    value={form.advisory_status}
                    onChange={(e) => setForm({ ...form, advisory_status: e.target.value })}
                  >
                    <option value="">— Select status —</option>
                    {editRow.advisory_status_options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
          "Shows every truck (Purchase, Sales or Empty/Misc) that has already exited the gate and is not yet Completed — newest exit first.",
          "\"Add / Edit Remarks\" lets you set the truck's Status, a Position note and an Unloading/Loading date.",
          "Status choices depend on the truck: Sales (At Transit, At Location, Unload Complete, Receivable Pending, Completed), Purchase (Unload Complete, On Hold, Pending Payment, Completed), Empty/Misc (Payment Pending, Completed).",
          "Marking a truck Completed removes it from this list. It is not deleted — it still appears in reports.",
          "Empty/Misc trucks also show the materials they carried, along with the party name.",
          "This doesn't change anything about how trucks move through the Gate, Weighbridge or Dispatch flows.",
        ]}
      />
    </div>
  );
}