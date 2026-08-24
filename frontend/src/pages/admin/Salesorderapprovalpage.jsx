import { useEffect, useState } from "react";
import {
  getPendingSalesOrdersApi,
  getSalesOrderByIdApi,
  approveSalesOrderApi,
  rejectSalesOrderApi,
  updateSalesOrderBeforeApprovalApi,
  addSalesOrderItemApi,
  deleteSalesOrderApi,
  getCustomersApi,
  getMasterSettingsApi,
  createMasterSettingApi,
  deleteMasterSettingApi,
} from "../../api/api";

import "../../components/DataTable.css";
import "./SalesOrderApprovalPage.css";

// Human-readable labels for the approval_status enum coming from the API.
const STATUS_LABELS = {
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

// so_status is a separate lifecycle from approval_status — shown as a
// plain label, not a colored badge.
const SO_STATUS_LABELS = {
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  closed: "Closed",
};

// Pulls the array out of either { data: { data: [...] } } or { data: [...] }.
const extractList = (response) => {
  const data = response?.data?.data ?? response?.data;
  return Array.isArray(data) ? data : data?.rows || [];
};

// ---------------------------------------------------------------------
// Reusable picker: pick an existing material by name, or add a brand new
// one inline. Sales Order rows have no variety field, unlike Purchase
// Orders, so only material needs a picker here.
// ---------------------------------------------------------------------

function MaterialPicker({ materials, value, onChange, onAdd, onDelete, busy }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    const createdId = await onAdd(name.trim(), code.trim());
    if (createdId) {
      setName("");
      setCode("");
      setShowAdd(false);
    }
  };

  return (
    <div className="sf-field so-entity-field">
      <label>Material</label>

      <div className="so-entity-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select material</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.material_code ? ` (${m.material_code})` : ""}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="so-entity-delete-btn"
          onClick={() => onDelete(value)}
          disabled={!value || busy}
          title="Delete selected material"
        >
          🗑
        </button>
      </div>

      {showAdd ? (
        <div className="so-entity-add-row">
          <input
            type="text"
            placeholder="New material name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Code (optional)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            className="so-entity-add-confirm-btn"
            onClick={submit}
            disabled={busy || !name.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="so-entity-add-cancel-btn"
            onClick={() => {
              setShowAdd(false);
              setName("");
              setCode("");
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="so-entity-add-toggle"
          onClick={() => setShowAdd(true)}
        >
          + Add new material
        </button>
      )}
    </div>
  );
}

export default function SalesOrderApprovalPage() {
  const [orders, setOrders] = useState([]);
  const [selectedSO, setSelectedSO] = useState(null);

  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState(null);

  // ---- Master data for the pickers (customer / material) ----
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [masterActionLoading, setMasterActionLoading] = useState(false);

  // ---- "Add Material" panel — adds another row sharing the same so_no ----
  const [addItemMaterialId, setAddItemMaterialId] = useState("");
  const [addItemQty, setAddItemQty] = useState("");
  const [addItemRate, setAddItemRate] = useState("");
  const [addItemLoading, setAddItemLoading] = useState(false);

  // ---- Per-row loading state while removing a sibling material row ----
  const [removingId, setRemovingId] = useState(null);

  const loadPendingOrders = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getPendingSalesOrdersApi();
      setOrders(extractList(response));
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to load pending sales orders"
      );
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    try {
      const [customersRes, materialsRes] = await Promise.all([
        getCustomersApi(),
        getMasterSettingsApi("material"),
      ]);

      setCustomers(extractList(customersRes));
      setMaterials(extractList(materialsRes));
    } catch (err) {
      // Non-fatal — the pickers just come up empty and the page still works.
      console.error("Failed to load customer/material lists", err);
    }
  };

  useEffect(() => {
    loadPendingOrders();
    loadMasterData();
  }, []);

  const resetAddItemForm = () => {
    setAddItemMaterialId("");
    setAddItemQty("");
    setAddItemRate("");
  };

  // The API is flat, one row per material (same shape as Purchase Orders) —
  // several rows can share the same so_no. We already have the full pending
  // list loaded, so "all materials on this SO" is just every row in
  // `orders` with a matching so_no. No extra endpoint needed.
  const getSiblingRows = (so, list = orders) => {
    if (!so?.so_no) return [];
    return list.filter((row) => row.so_no === so.so_no);
  };

  const handleViewSO = async (so) => {
    setDetailsLoading(true);
    setError("");
    setSuccess("");

    try {
      const soNo = so.so_no;

      const response = await getSalesOrderByIdApi(so.id);

      const data = response.data?.data ?? response.data;

      setSelectedSO({
        ...data,
        so_no: data.so_no || soNo,
      });

      resetAddItemForm();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to load sales order"
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const refreshSelectedSO = async (freshOrders) => {
    if (!selectedSO) return;

    // Keep pointing at the same row if it still exists; otherwise fall back
    // to any remaining sibling with the same so_no (e.g. after removing the
    // row currently being viewed).
    const list = freshOrders ?? orders;
    const stillThere = list.find((row) => row.id === selectedSO.id);
    const fallback = list.find((row) => row.so_no === selectedSO.so_no);
    const target = stillThere || fallback;

    if (!target) {
      setSelectedSO(null);
      return;
    }

    await handleViewSO({ id: target.id, so_no: target.so_no });
  };

  const handleApprove = async () => {
    if (!selectedSO) return;

    const soNo = selectedSO.so_no;

    if (!window.confirm(`Approve Sales Order ${soNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      await approveSalesOrderApi(soNo);

      setSuccess(`Sales Order ${soNo} approved successfully.`);

      setSelectedSO(null);

      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to approve sales order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedSO) return;

    const soNo = selectedSO.so_no;

    if (!rejectReason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }

    if (!window.confirm(`Reject Sales Order ${soNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      await rejectSalesOrderApi(soNo, { rejection_reason: rejectReason.trim() });

      setSuccess(`Sales Order ${soNo} rejected successfully.`);

      setRejectReason("");
      setShowRejectBox(false);
      setSelectedSO(null);

      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to reject sales order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ---- Field readers, matched exactly to the real API shape ----

  const getCustomerName = (so) => so?.customer?.name || "—";
  const getCustomerCode = (so) => so?.customer?.customer_code || "—";

  const getMaterialName = (so) => so?.material?.name || "—";
  const getMaterialCode = (so) => so?.material?.material_code || "—";

  const getOrderDate = (so) => {
    if (!so?.order_date) return "—";
    return new Date(so.order_date).toLocaleDateString("en-IN");
  };

  const getOrderType = (so) => {
    if (!so?.order_type) return "—";
    return so.order_type.toUpperCase();
  };

  const getSoStatusLabel = (so) =>
    SO_STATUS_LABELS[so?.so_status] || so?.so_status || "—";

  const getQty = (so) => {
    if (so?.qty === undefined || so?.qty === null) return "—";
    return Number(so.qty).toLocaleString("en-IN");
  };

  const getDispatchedQty = (so) => {
    if (so?.dispatched_qty === undefined || so?.dispatched_qty === null)
      return "—";
    return Number(so.dispatched_qty).toLocaleString("en-IN");
  };

  const getRate = (so) => {
    if (so?.rate === undefined || so?.rate === null) return "—";
    return `₹${Number(so.rate).toLocaleString("en-IN")}`;
  };

  const getAmount = (so) => {
    const qty = Number(so?.qty);
    const rate = Number(so?.rate);

    if (Number.isNaN(qty) || Number.isNaN(rate)) return "—";

    return `₹${(qty * rate).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`;
  };

  const getRowAmountValue = (so) => {
    const qty = Number(so?.qty);
    const rate = Number(so?.rate);
    if (Number.isNaN(qty) || Number.isNaN(rate)) return 0;
    return qty * rate;
  };

  const getGroupTotal = (so) => {
    const siblings = getSiblingRows(so);
    if (siblings.length === 0) return getAmount(so);
    const total = siblings.reduce((sum, row) => sum + getRowAmountValue(row), 0);
    return `₹${total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  };

  const getStatus = (so) => {
    const status = so?.approval_status;
    return STATUS_LABELS[status] || status || "Pending";
  };

  const getStatusClass = (so) => {
    const status = so?.approval_status;
    if (status === "approved") return "so-status-approved";
    if (status === "rejected") return "so-status-rejected";
    return "so-status-pending";
  };

  // ---- Edit flow (edits the SO header — customer/order type/date/plant.
  // NOTE: fields here are a best guess at what PUT .../approval-edit
  // accepts, since only customer_id/order_type/order_date/plant_id are
  // header-level in the sample response — confirm against the controller
  // and adjust this list if it accepts more or fewer fields.) ----

  const startEditSO = () => {
    if (!selectedSO) return;

    setEditForm({
      customer_id: selectedSO.customer_id ?? "",
      order_type: selectedSO.order_type || "",
      order_date: selectedSO.order_date
        ? String(selectedSO.order_date).split("T")[0]
        : "",
      plant_id: selectedSO.plant_id ?? "",
    });

    setError("");
    setSuccess("");
    setEditMode(true);
  };

  const cancelEditSO = () => {
    setEditMode(false);
    setEditForm(null);
  };

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveSO = async () => {
    if (!selectedSO || !editForm) return;

    const soNo = selectedSO.so_no;

    if (!window.confirm(`Save changes to Sales Order ${soNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      // Matches PUT /so/:so_no/approval-edit — header-level fields only.
      await updateSalesOrderBeforeApprovalApi(soNo, {
        customer_id: editForm.customer_id || undefined,
        order_type: editForm.order_type || undefined,
        order_date: editForm.order_date || undefined,
        plant_id: editForm.plant_id || undefined,
      });

      setSuccess(`Sales Order ${soNo} updated successfully.`);

      setEditMode(false);
      setEditForm(null);

      await handleViewSO({ id: selectedSO.id, so_no: soNo });
      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to update sales order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ---- Add a material row under this same so_no ----

  const handleAddItemToSO = async () => {
    if (!selectedSO) return;

    if (!addItemMaterialId || addItemQty === "" || addItemRate === "") {
      setError("Select a material, quantity and rate to add an item.");
      return;
    }

    const soNo = selectedSO.so_no;

    if (!window.confirm(`Add this as a new material line on Sales Order ${soNo}?`)) {
      return;
    }

    setAddItemLoading(true);
    setError("");
    setSuccess("");

    try {
      // Matches POST /so/:so_no/items — creates another row sharing so_no.
      await addSalesOrderItemApi(soNo, {
        material_id: addItemMaterialId,
        qty: Number(addItemQty),
        rate: Number(addItemRate),
      });

      setSuccess(`Added a new material line to Sales Order ${soNo}.`);

      resetAddItemForm();

      const response = await getPendingSalesOrdersApi();
      const freshOrders = extractList(response);
      setOrders(freshOrders);
      await refreshSelectedSO(freshOrders);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to add item to sales order"
      );
    } finally {
      setAddItemLoading(false);
    }
  };

  // ---- Remove a sibling material row from this SO ----
  // Each row already has its own `id`, and DELETE /sales-orders/:id (soft
  // delete) already exists in the router — no new backend route needed.

  const handleRemoveRow = async (row) => {
    if (!row?.id) return;

    const siblings = getSiblingRows(selectedSO);

    if (siblings.length <= 1) {
      setError("A sales order must have at least one material line — add a replacement before removing the last one.");
      return;
    }

    if (
      !window.confirm(
        `Remove ${row?.material?.name || "this material"} from Sales Order ${row.so_no}?`
      )
    ) {
      return;
    }

    setRemovingId(row.id);
    setError("");
    setSuccess("");

    try {
      await deleteSalesOrderApi(row.id);

      setSuccess(`Removed ${row?.material?.name || "material"} from Sales Order ${row.so_no}.`);

      const response = await getPendingSalesOrdersApi();
      const freshOrders = extractList(response);
      setOrders(freshOrders);
      await refreshSelectedSO(freshOrders);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to remove material from sales order"
      );
    } finally {
      setRemovingId(null);
    }
  };

  // ---- Material master-data management (add / delete), used by the
  // add-item picker ----

  const createMaterial = async (name, code) => {
    setMasterActionLoading(true);
    setError("");

    try {
      const res = await createMasterSettingApi({
        type: "material",
        name,
        material_code: code || undefined,
      });

      const created = res.data?.data ?? res.data;

      await loadMasterData();

      return created?.id ?? null;
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to add material"
      );
      return null;
    } finally {
      setMasterActionLoading(false);
    }
  };

  const deleteMaterial = async (id) => {
    if (!id) return;

    const material = materials.find((m) => String(m.id) === String(id));

    if (
      !window.confirm(
        `Delete material "${material?.name || id}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setMasterActionLoading(true);
    setError("");

    try {
      await deleteMasterSettingApi(id, "material");

      await loadMasterData();

      if (String(addItemMaterialId) === String(id)) {
        setAddItemMaterialId("");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to delete material. It may be in use on another sales order."
      );
    } finally {
      setMasterActionLoading(false);
    }
  };

  return (
    <div className="so-approval-page">
      <div className="so-page-header">
        <div>
          <h2>Sales Order Approval</h2>
          <p>Review and approve pending sales orders.</p>
        </div>

        <button
          className="sf-submit"
          onClick={loadPendingOrders}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="dt-error">{error}</div>}

      {success && <div className="so-success">{success}</div>}

      {!selectedSO && (
        <>
          <div className="so-summary-cards">
            <div className="so-summary-card">
              <div className="so-summary-number">{orders.length}</div>
              <div className="so-summary-label">Pending Sales Order Lines</div>
            </div>

            <div className="so-summary-card">
              <div className="so-summary-number">
                {new Set(orders.map((so) => so.so_no)).size}
              </div>
              <div className="so-summary-label">Distinct Sales Orders</div>
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="so-section-header">
              <div>
                <h3>Pending Sales Orders</h3>
                <p>Select a sales order to review its details. Orders with more than one material line appear as multiple rows sharing the same SO number.</p>
              </div>
            </div>

            {loading ? (
              <p className="dt-msg">Loading pending sales orders...</p>
            ) : orders.length === 0 ? (
              <div className="so-empty">
                <div className="so-empty-icon">✓</div>
                <h3>No Pending Sales Orders</h3>
                <p>All sales orders have been processed.</p>
              </div>
            ) : (
              <div className="dt-wrapper">
                <table className="dt-table so-table">
                  <thead>
                    <tr>
                      <th>SO Number</th>
                      <th>Customer</th>
                      <th>Material</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Amount</th>
                      <th>Order Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map((so) => (
                      <tr key={so.id}>
                        <td>
                          <strong>{so.so_no}</strong>
                        </td>
                        <td>{getCustomerName(so)}</td>
                        <td>{getMaterialName(so)}</td>
                        <td>{getQty(so)}</td>
                        <td>{getRate(so)}</td>
                        <td>{getAmount(so)}</td>
                        <td>{getOrderDate(so)}</td>
                        <td>
                          <span className={`dt-badge ${getStatusClass(so)}`}>
                            {getStatus(so)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="so-view-btn"
                            onClick={() => handleViewSO(so)}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {editMode && editForm && (
        <div className="dashboard-panel so-edit-panel">
          <div className="so-section-header">
            <div>
              <h3>Edit Sales Order</h3>
              <p>Make the required changes before approving this sales order.</p>
            </div>
          </div>

          <div className="so-edit-grid">
            <div className="sf-field">
              <label>Customer</label>
              <select
                value={editForm.customer_id}
                onChange={(e) => handleEditChange("customer_id", e.target.value)}
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.customer_code ? ` (${c.customer_code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="sf-field">
              <label>Order Type</label>
              <input
                type="text"
                value={editForm.order_type}
                onChange={(e) => handleEditChange("order_type", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>Order Date</label>
              <input
                type="date"
                value={editForm.order_date}
                onChange={(e) => handleEditChange("order_date", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>Plant ID</label>
              <input
                type="number"
                value={editForm.plant_id}
                onChange={(e) => handleEditChange("plant_id", e.target.value)}
              />
            </div>
          </div>

          <div className="so-edit-actions">
            <button
              className="so-cancel-btn"
              onClick={cancelEditSO}
              disabled={actionLoading}
            >
              Cancel
            </button>

            <button
              className="so-approve-btn"
              onClick={handleSaveSO}
              disabled={actionLoading}
            >
              {actionLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {detailsLoading && (
        <div className="dashboard-panel">
          <p className="dt-msg">Loading sales order details...</p>
        </div>
      )}

      {selectedSO && !detailsLoading && !editMode && (
        <div className="so-details-wrapper">
          <div className="so-detail-header">
            <div>
              <button className="so-back-btn" onClick={() => setSelectedSO(null)}>
                ← Back to Pending Orders
              </button>

              <h2>Sales Order {selectedSO.so_no}</h2>
              <p>Review the sales order before taking an action.</p>
            </div>

            <span className={`dt-badge so-large-status ${getStatusClass(selectedSO)}`}>
              {getStatus(selectedSO)}
            </span>
          </div>

          <div className="so-info-grid">
            <div className="dashboard-panel">
              <h3>Sales Order Information</h3>

              <div className="so-info-list">
                <div>
                  <span>SO Number</span>
                  <strong>{selectedSO.so_no || "—"}</strong>
                </div>

                <div>
                  <span>Order Date</span>
                  <strong>{getOrderDate(selectedSO)}</strong>
                </div>

                <div>
                  <span>Order Type</span>
                  <strong>{getOrderType(selectedSO)}</strong>
                </div>

                <div>
                  <span>SO Status</span>
                  <strong>{getSoStatusLabel(selectedSO)}</strong>
                </div>

                <div>
                  <span>Customer</span>
                  <strong>{getCustomerName(selectedSO)}</strong>
                </div>

                <div>
                  <span>Customer Code</span>
                  <strong>{getCustomerCode(selectedSO)}</strong>
                </div>

                <div>
                  <span>Plant ID</span>
                  <strong>{selectedSO.plant_id ?? "—"}</strong>
                </div>

                <div>
                  <span>Dispatched Qty</span>
                  <strong>{getDispatchedQty(selectedSO)}</strong>
                </div>
              </div>
            </div>

            <div className="dashboard-panel">
              <h3>Amount Summary</h3>

              <div className="so-amount-list">
                <div>
                  <span>Material Lines</span>
                  <strong>{getSiblingRows(selectedSO).length || 1}</strong>
                </div>

                <div className="so-grand-total">
                  <span>Total Amount (all lines)</span>
                  <strong>{getGroupTotal(selectedSO)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="so-section-header">
              <div>
                <h3>Material Details</h3>
                <p>Verify each material, quantity, and rate before approving.</p>
              </div>
            </div>

            <div className="dt-wrapper">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Quantity</th>
                    <th>Dispatched</th>
                    <th>Rate</th>
                    <th>Amount</th>
                    {selectedSO.approval_status === "pending_approval" && (
                      <th>Action</th>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {(getSiblingRows(selectedSO).length
                    ? getSiblingRows(selectedSO)
                    : [selectedSO]
                  ).map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{getMaterialName(row)}</strong>
                        <div className="so-subtext">{getMaterialCode(row)}</div>
                      </td>
                      <td>{getQty(row)}</td>
                      <td>{getDispatchedQty(row)}</td>
                      <td>{getRate(row)}</td>
                      <td>{getAmount(row)}</td>
                      {selectedSO.approval_status === "pending_approval" && (
                        <td>
                          <button
                            className="so-entity-delete-btn"
                            onClick={() => handleRemoveRow(row)}
                            disabled={removingId === row.id}
                            title="Remove this material line"
                          >
                            {removingId === row.id ? "…" : "🗑"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedSO.approval_status === "pending_approval" && (
            <div className="dashboard-panel so-additem-panel">
              <div className="so-section-header">
                <div>
                  <h3>Add Material</h3>
                  <p>
                    Add another material line to this sales order — pick an
                    existing material or add a new one.
                  </p>
                </div>
              </div>

              <div className="so-additem-grid">
                <MaterialPicker
                  materials={materials}
                  value={addItemMaterialId}
                  onChange={setAddItemMaterialId}
                  onAdd={async (name, code) => {
                    const id = await createMaterial(name, code);
                    if (id) setAddItemMaterialId(id);
                    return id;
                  }}
                  onDelete={deleteMaterial}
                  busy={masterActionLoading}
                />

                <div className="sf-field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={addItemQty}
                    onChange={(e) => setAddItemQty(e.target.value)}
                  />
                </div>

                <div className="sf-field">
                  <label>Rate</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={addItemRate}
                    onChange={(e) => setAddItemRate(e.target.value)}
                  />
                </div>
              </div>

              <div className="so-additem-actions">
                <button
                  className="so-approve-btn"
                  onClick={handleAddItemToSO}
                  disabled={addItemLoading || masterActionLoading}
                >
                  {addItemLoading ? "Adding..." : "+ Add Material to SO"}
                </button>
              </div>
            </div>
          )}

          {selectedSO.rejection_reason && (
            <div className="dashboard-panel">
              <h3>Rejection Reason</h3>
              <p className="so-notes">{selectedSO.rejection_reason}</p>
            </div>
          )}

          <div className="so-action-panel">
            <div>
              <h3>Approval Decision</h3>
              <p>Review the sales order, edit it if required, then approve or reject it.</p>
            </div>

            <div className="so-actions">
              <button
                className="so-edit-btn"
                onClick={startEditSO}
                disabled={actionLoading}
              >
                ✏️ Edit SO
              </button>

              <button
                className="so-reject-btn"
                onClick={() => {
                  setShowRejectBox(!showRejectBox);
                  setError("");
                }}
                disabled={actionLoading}
              >
                Reject SO
              </button>

              <button
                className="so-approve-btn"
                onClick={handleApprove}
                disabled={actionLoading}
              >
                {actionLoading ? "Processing..." : "Approve SO"}
              </button>
            </div>
          </div>

          {showRejectBox && (
            <div className="dashboard-panel so-reject-box">
              <h3>Reject Sales Order</h3>

              <label>Reason for rejection</label>

              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter reason for rejecting this sales order..."
                rows={4}
              />

              <div className="so-reject-actions">
                <button
                  className="so-cancel-btn"
                  onClick={() => {
                    setShowRejectBox(false);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </button>

                <button
                  className="so-reject-confirm-btn"
                  onClick={handleReject}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Rejecting..." : "Confirm Rejection"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}