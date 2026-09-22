import { useState, useEffect } from "react";
import {
  getVisitorsApi,
  createVisitorApi,
  checkOutVisitorApi,
  deleteVisitorApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";

const emptyForm = {
  visitor_name: "",
  purpose: "",
  no_of_persons: "1",
  phone: "",
  to_meet: "",
  remarks: "",
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : "—");

export default function VisitorsPage() {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [checkOutLoadingId, setCheckOutLoadingId] = useState(null);

  const load = (status = statusFilter) => {
    setLoading(true);
    getVisitorsApi(status ? { status } : {})
      .then((res) => setVisitors(res.data.data ?? res.data))
      .catch(() => setError("Failed to load visitor history"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const payload = {
      visitor_name: form.visitor_name,
      purpose: form.purpose,
      no_of_persons: Number(form.no_of_persons) || 1,
      phone: form.phone || undefined,
      to_meet: form.to_meet || undefined,
      remarks: form.remarks || undefined,
    };

    try {
      const res = await createVisitorApi(payload);
      setInfo(res.data.msg || "Gate pass issued.");
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not issue gate pass");
    }
  };

  const handleCheckOut = async (row) => {
    if (!window.confirm(`Check out ${row.visitor_name}?`)) return;
    setError("");
    setInfo("");
    setCheckOutLoadingId(row.id);
    try {
      const res = await checkOutVisitorApi(row.id);
      setInfo(res.data.msg || "Visitor checked out.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not check out visitor");
    } finally {
      setCheckOutLoadingId(null);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete this visitor record for ${row.visitor_name}? This can't be undone.`)) return;
    setError("");
    try {
      await deleteVisitorApi(row.id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Delete failed");
    }
  };

  const handleFilterChange = (e) => {
    const value = e.target.value;
    setStatusFilter(value);
    load(value);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Visitors</h2>
      <p style={{ color: "#666", marginTop: -8 }}>
        Issue a gate pass for anyone entering the premises and check them out when they leave.
        Every visit is kept here as a permanent record.
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <div className="sf-field">
          <label>Visitor Name</label>
          <input name="visitor_name" value={form.visitor_name} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>Purpose of Visit</label>
          <input name="purpose" value={form.purpose} onChange={handleChange} required />
        </div>
        <div className="sf-field">
          <label>No. of Persons</label>
          <input
            name="no_of_persons"
            type="number"
            min="1"
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
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            Issue Gate Pass
          </button>
        </div>
      </form>

      <div className="sf-field" style={{ maxWidth: 240, marginBottom: 12 }}>
        <label>Filter by Status</label>
        <select value={statusFilter} onChange={handleFilterChange}>
          <option value="">All</option>
          <option value="checked_in">Checked In</option>
          <option value="checked_out">Checked Out</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        rows={visitors}
        onDelete={handleDelete}
        columns={[
          { key: "gate_pass_no", label: "Gate Pass No." },
          { key: "visitor_name", label: "Visitor Name" },
          { key: "purpose", label: "Purpose" },
          { key: "no_of_persons", label: "Persons" },
          { key: "phone", label: "Phone" },
          { key: "to_meet", label: "To Meet" },
          {
            key: "check_in_time",
            label: "Check-In",
            render: (row) => formatDateTime(row.check_in_time),
          },
          {
            key: "check_out_time",
            label: "Check-Out",
            render: (row) => formatDateTime(row.check_out_time),
          },
          {
            key: "status",
            label: "Status",
            render: (row) => (
              <span className="dt-badge">
                {row.status === "checked_in" ? "Checked In" : "Checked Out"}
              </span>
            ),
          },
          {
            key: "visitor_actions",
            label: "Actions",
            render: (row) =>
              row.status === "checked_in" ? (
                <button
                  className="dt-btn"
                  disabled={checkOutLoadingId === row.id}
                  onClick={() => handleCheckOut(row)}
                >
                  {checkOutLoadingId === row.id ? "..." : "Check Out"}
                </button>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </div>
  );
}