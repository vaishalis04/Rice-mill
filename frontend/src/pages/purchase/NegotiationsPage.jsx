import { useState, useEffect } from "react";
import {
  getNegotiationsApi,
  createNegotiationApi,
  updateNegotiationApi,
  respondNegotiationApi,
  deleteNegotiationApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";

const emptyForm = {
  lab_test_id: "",
  old_rate: "",
  proposed_rate: "",
};

export default function NegotiationsPage() {
  const [negotiations, setNegotiations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    getNegotiationsApi()
      .then((res) => setNegotiations(res.data.data ?? res.data))
      .catch(() => setError("Failed to load negotiations"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    const payload = {
      ...form,
      lab_test_id: Number(form.lab_test_id),
      old_rate: Number(form.old_rate),
      proposed_rate: Number(form.proposed_rate),
    };
    try {
      if (editingId) {
        await updateNegotiationApi(editingId, {
          proposed_rate: payload.proposed_rate,
        });
      } else {
        await createNegotiationApi(payload);
        setInfo("Negotiation opened — waiting on vendor response.");
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — the linked lab test's verdict may not be \"negotiation\"."
      );
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      lab_test_id: row.lab_test_id || "",
      old_rate: row.old_rate ?? "",
      proposed_rate: row.proposed_rate ?? "",
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this negotiation?")) return;
    try {
      await deleteNegotiationApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRespond = async (id, vendor_response) => {
    setError("");
    setInfo("");
    try {
      await respondNegotiationApi(id, vendor_response);
      setInfo(
        vendor_response === "accept"
          ? "Accepted — PO rate updated, gate entry moved to lab_accepted."
          : "Rejected — gate entry moved to rejected."
      );
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Respond failed — this negotiation may already have a response."
      );
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Negotiations</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="lab_test"
          label="Lab Test"
          value={form.lab_test_id}
          onChange={(id) => setForm({ ...form, lab_test_id: id })}
          filter={(row) => row.verdict === "negotiation"}
          disabled={!!editingId}
          required={!editingId}
        />
        <div className="sf-field">
          <label>Old Rate</label>
          <input
            name="old_rate"
            type="number"
            step="0.01"
            value={form.old_rate}
            onChange={handleChange}
            disabled={!!editingId}
            required={!editingId}
          />
        </div>
        <div className="sf-field">
          <label>Proposed Rate</label>
          <input
            name="proposed_rate"
            type="number"
            step="0.01"
            value={form.proposed_rate}
            onChange={handleChange}
            required
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId ? "Update Proposed Rate" : "Open Negotiation"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={negotiations}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "lab_test_id", label: "Lab Test ID" },
          { key: "old_rate", label: "Old Rate" },
          { key: "proposed_rate", label: "Proposed Rate" },
          {
            key: "vendor_response",
            label: "Vendor Response",
            render: (row) => (
              <span className="dt-badge">
                {row.vendor_response || "pending"}
              </span>
            ),
          },
          {
            key: "respond",
            label: "Respond",
            render: (row) =>
              row.vendor_response ? (
                "—"
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="dt-btn"
                    onClick={() => handleRespond(row.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="dt-btn dt-btn-danger"
                    onClick={() => handleRespond(row.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              ),
          },
        ]}
      />
    </div>
  );
}
