import { useState, useEffect } from "react";
import {
  getVisitorsApi,
  createVisitorApi,
  checkOutVisitorApi,
  deleteVisitorApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";

const emptyForm = {
  visitor_name: "",
  purpose: "",
  no_of_persons: 1,
  phone: "",
  to_meet: "",
  remarks: "",
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "checked_in", label: "Checked In" },
  { key: "checked_out", label: "Checked Out" },
];

export default function VisitorSection() {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastGatePass, setLastGatePass] = useState(null);

  const load = (status = statusFilter) => {
    setLoading(true);
    getVisitorsApi(status ? { status } : {})
      .then((res) => setVisitors(res.data.data ?? res.data))
      .catch(() => setError("Failed to load visitor gate passes"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLastGatePass(null);

    if (!form.visitor_name.trim() || !form.purpose.trim()) {
      setError("Name and purpose of visit are required");
      return;
    }
    if (!(Number(form.no_of_persons) > 0)) {
      setError("Number of persons must be greater than 0");
      return;
    }

    try {
      const payload = {
        visitor_name: form.visitor_name.trim(),
        purpose: form.purpose.trim(),
        no_of_persons: Number(form.no_of_persons),
      };
      if (form.phone.trim()) payload.phone = form.phone.trim();
      if (form.to_meet.trim()) payload.to_meet = form.to_meet.trim();
      if (form.remarks.trim()) payload.remarks = form.remarks.trim();

      const res = await createVisitorApi(payload);
      const created = res.data.data ?? res.data;
      setInfo(res.data.msg || "Gate pass issued.");
      setLastGatePass(created);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not issue gate pass");
    }
  };

  const handleCheckOut = async (id) => {
    setError("");
    setInfo("");
    try {
      const res = await checkOutVisitorApi(id);
      setInfo(res.data.msg || "Visitor checked out.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Check-out failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this visitor record?")) return;
    setError("");
    setInfo("");
    try {
      await deleteVisitorApi(id);
      setInfo("Visitor record deleted.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Delete failed");
    }
  };

  const formatTime = (value) => (value ? new Date(value).toLocaleString() : "—");

  return (
    <div>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-success">
          {info}
          {lastGatePass && (
            <div style={{ marginTop: 8 }}>
              <span className="token-chip token-chip-lg">{lastGatePass.gate_pass_no}</span>
            </div>
          )}
        </div>
      )}

      <h3 style={{ marginBottom: 4 }}>Issue Gate Pass</h3>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        For normal visitors — no vehicle or material involved. A gate pass number is
        generated on check-in; use "Check Out" below once the visit is over.
      </p>

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>Name</label>
          <input name="visitor_name" value={form.visitor_name} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>Purpose of Visit</label>
          <input name="purpose" value={form.purpose} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>No. of Persons</label>
          <input
            type="number"
            name="no_of_persons"
            min="1"
            step="1"
            value={form.no_of_persons}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Phone (optional)</label>
          <input name="phone" value={form.phone} onChange={handleChange} />
        </div>
        <div className="sf-field">
          <label>To Meet (optional)</label>
          <input name="to_meet" value={form.to_meet} onChange={handleChange} placeholder="Person or department" />
        </div>
        <div className="sf-field">
          <label>Remarks (optional)</label>
          <input name="remarks" value={form.remarks} onChange={handleChange} />
        </div>
        <button className="sf-submit" type="submit">
          Issue Gate Pass &amp; Check In
        </button>
      </form>

      <div className="section-tabs" style={{ marginTop: 24 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${statusFilter === f.key ? "active" : ""}`}
            onClick={() => {
              setStatusFilter(f.key);
              load(f.key);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={visitors}
        columns={[
          {
            key: "gate_pass_no",
            label: "Gate Pass No.",
            render: (row) => <span className="token-chip">{row.gate_pass_no}</span>,
          },
          { key: "visitor_name", label: "Name" },
          { key: "purpose", label: "Purpose" },
          { key: "no_of_persons", label: "Persons" },
          { key: "to_meet", label: "To Meet", render: (row) => row.to_meet || "—" },
          { key: "check_in_time", label: "Check-In", render: (row) => formatTime(row.check_in_time) },
          { key: "check_out_time", label: "Check-Out", render: (row) => formatTime(row.check_out_time) },
          {
            key: "status",
            label: "Status",
            render: (row) => (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  background: row.status === "checked_out" ? "#e2e8f0" : "#dcfce7",
                  color: row.status === "checked_out" ? "#475569" : "#166534",
                }}
              >
                {row.status === "checked_out" ? "Checked Out" : "Checked In"}
              </span>
            ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                {row.status === "checked_in" && (
                  <button className="dt-btn" onClick={() => handleCheckOut(row.id)}>
                    Check Out
                  </button>
                )}
                <button className="dt-btn dt-btn-danger" onClick={() => handleDelete(row.id)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />

      <ModuleGuide
        title="Visitor Gate Pass"
        steps={[
          "Fill in the visitor's name, purpose of visit, and number of persons — a gate pass number is generated automatically and the visitor is checked in immediately.",
          "Phone, who they're meeting, and remarks are optional extra details.",
          "Use the tabs above the list to filter by Checked In / Checked Out.",
          "Click 'Check Out' once the visit is over — this records the check-out time and closes the gate pass.",
        ]}
      />
    </div>
  );
}