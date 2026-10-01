import { useState, useEffect } from "react";
import {
  getRegistrationRequestsApi,
  approveRegistrationRequestApi,
  rejectRegistrationRequestApi,
  getUserPermissionsApi,
  setUserPermissionsApi,
  getPermissionsCatalogApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import PagePermissionPicker from "../../components/PagePermissionPicker";

// Admin review queue for the "Register" link on the login page. Approving a
// request creates the real User (login = their mobile number + the
// password they chose), assigns the picked Role, and grants whatever pages
// are ticked here directly to that user (on top of whatever their role
// already gets) — each page is registered in the Permission catalog on the
// spot if it isn't already, so anything in the catalog below can be ticked
// straight away. Already-approved users can have their pages edited again
// any time from the "Approved" tab here.

export default function UserApprovalsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");

  // Shared modal state for both "Approve" (new user) and "Edit Permissions"
  // (existing, already-approved user) — `mode` tells submit what to do.
  const [modal, setModal] = useState(null); // { mode: "approve" | "edit", row }
  const [roleId, setRoleId] = useState("");
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Used only to translate an existing user's granted permission_ids back
  // into "module.page" codes for the picker when editing.
  const [permissionCatalog, setPermissionCatalog] = useState([]);

  const load = () => {
    setLoading(true);
    getRegistrationRequestsApi(statusFilter ? { status: statusFilter } : {})
      .then((res) => setRequests(res.data.data ?? res.data))
      .catch(() => setError("Failed to load registration requests"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  useEffect(() => {
    getPermissionsCatalogApi()
      .then((res) => setPermissionCatalog(res.data.data ?? res.data))
      .catch(() => {});
  }, []);

  const openApprove = (row) => {
    setError("");
    setInfo("");
    setModal({ mode: "approve", row });
    setRoleId("");
    setSelectedCodes(new Set());
  };

  const openEdit = async (row) => {
    setError("");
    setInfo("");
    if (!row.created_user_id) return;
    try {
      const res = await getUserPermissionsApi(row.created_user_id);
      const data = res.data.data ?? res.data;
      const idToCode = new Map(permissionCatalog.map((p) => [p.id, p.code]));
      const codes = (data.permission_ids || []).map((id) => idToCode.get(id)).filter(Boolean);
      setModal({ mode: "edit", row });
      setSelectedCodes(new Set(codes));
    } catch {
      setError("Couldn't load this user's current permissions");
    }
  };

  const codesToPages = (codes) =>
    [...codes].map((code) => {
      const [module, ...rest] = code.split(".");
      return { module, page: rest.join(".") };
    });

  const handleApprove = async (e) => {
    e.preventDefault();
    if (!modal || !roleId) return;
    setSaving(true);
    setError("");
    try {
      await approveRegistrationRequestApi(modal.row.id, {
        role_id: roleId,
        pages: codesToPages(selectedCodes),
      });
      setInfo(`Approved — ${modal.row.name} can now log in with mobile number ${modal.row.mobile}.`);
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.msg || "Approval failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!modal) return;
    setSaving(true);
    setError("");
    try {
      await setUserPermissionsApi(modal.row.created_user_id, codesToPages(selectedCodes));
      setInfo(`Updated pages for ${modal.row.name}.`);
      setModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save pages");
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (row) => {
    const reason = window.prompt(`Reason for rejecting ${row.name}'s request? (optional)`) || "";
    setError("");
    try {
      await rejectRegistrationRequestApi(row.id, reason);
      setInfo(`Rejected ${row.name}'s request.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Rejection failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>User Approvals</h2>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Requests submitted from the "Register" link on the login page. Approve to create their account (they'll log
        in with their mobile number and the password they chose) with a role and whatever pages you tick — edit the
        same pages again any time from the Approved tab.
      </p>

      <div className="section-tabs" style={{ marginBottom: 12 }}>
        {["pending", "approved", "rejected"].map((s) => (
          <button
            key={s}
            className={`section-tab ${statusFilter === s ? "active" : ""}`}
            onClick={() => setStatusFilter(s)}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-info">{info}</div>}

      <DataTable
        loading={loading}
        rows={requests}
        columns={[
          { key: "name", label: "Name" },
          { key: "mobile", label: "Mobile No." },
          { key: "email", label: "Email" },
          {
            key: "created_at",
            label: "Requested At",
            render: (row) => (row.created_at ? new Date(row.created_at).toLocaleString() : "—"),
          },
          { key: "status", label: "Status" },
          {
            key: "actions",
            label: "Actions",
            render: (row) => {
              if (row.status === "pending") {
                return (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="dt-btn" onClick={() => openApprove(row)}>
                      Approve
                    </button>
                    <button className="dt-btn dt-danger" onClick={() => handleReject(row)}>
                      Reject
                    </button>
                  </div>
                );
              }
              if (row.status === "approved") {
                return (
                  <button className="dt-btn" onClick={() => openEdit(row)}>
                    Edit Permissions
                  </button>
                );
              }
              return row.rejection_reason || "—";
            },
          },
        ]}
      />

      {modal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "40px 16px", zIndex: 1000, overflowY: "auto",
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: 620, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              {modal.mode === "approve"
                ? `Approve ${modal.row.name} (${modal.row.mobile})`
                : `Edit Permissions — ${modal.row.name} (${modal.row.mobile})`}
            </h3>
            <form className="sf-form" onSubmit={modal.mode === "approve" ? handleApprove : handleSaveEdit}>
              {modal.mode === "approve" && (
                <EntitySelect entity="role" label="Role" value={roleId} onChange={setRoleId} required />
              )}

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                  Page Permissions{modal.mode === "approve" ? " (optional — on top of the role's usual pages)" : ""}
                </label>
                <PagePermissionPicker selectedCodes={selectedCodes} onChange={setSelectedCodes} />
              </div>

              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                <button
                  className="sf-submit"
                  type="submit"
                  disabled={saving || (modal.mode === "approve" && !roleId)}
                >
                  {saving ? "Saving…" : modal.mode === "approve" ? "Approve & Create Account" : "Save Pages"}
                </button>
                <button type="button" className="dt-btn" onClick={() => setModal(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModuleGuide
        title="User Approvals"
        steps={[
          "Pending requests come from the 'Register' link on the login page — Name, Mobile No., Email and a password they chose.",
          "Approve picks a Role for them and lets you tick exactly the pages they need, across any dashboard (Purchase, Gate, Quality, Warehouse, Sales, or the standalone Admin pages) — tick a group's 'All' box for the whole dashboard, or individual pages within it.",
          "If a user is handed pages outside their role's own dashboard, they land on the general dashboard at login (instead of their role's usual one) so every granted page actually shows up — nothing is lost.",
          "Once approved, they log in with their Mobile No. and the password they set at registration.",
          "Already-approved users can have their pages changed any time from the Approved tab's 'Edit Permissions' button.",
          "Reject just marks the request rejected with an optional reason — no account is created.",
        ]}
      />
    </div>
  );
}