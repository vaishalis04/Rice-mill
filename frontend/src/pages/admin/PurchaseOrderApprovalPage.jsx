import { useEffect, useState } from "react";
import {
  getPendingPurchaseOrdersApi,
  getPurchaseOrderByIdApi,
  approvePurchaseOrderApi,
  rejectPurchaseOrderApi,
  updatePurchaseOrderBeforeApprovalApi,
  addPurchaseOrderItemApi,
  getVendorsApi,
  getMasterSettingsApi,
  createMasterSettingApi,
  deleteMasterSettingApi,
} from "../../api/api";

import "../../components/DataTable.css";
import "./PurchaseOrderApprovalPage.css";

// Human-readable labels for the approval_status enum coming from the API.
const STATUS_LABELS = {
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

// Pulls the array out of either { data: { data: [...] } } or { data: [...] }.
const extractList = (response) => {
  const data = response?.data?.data ?? response?.data;
  return Array.isArray(data) ? data : data?.rows || [];
};

// ---------------------------------------------------------------------
// Reusable pickers: pick an existing material/variety by name, or add a
// brand new one inline. Used both for editing the PO's existing line and
// for adding an extra line item to the same PO.
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
    <div className="sf-field po-entity-field">
      <label>Material</label>

      <div className="po-entity-row">
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
          className="po-entity-delete-btn"
          onClick={() => onDelete(value)}
          disabled={!value || busy}
          title="Delete selected material"
        >
          🗑
        </button>
      </div>

      {showAdd ? (
        <div className="po-entity-add-row">
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
            className="po-entity-add-confirm-btn"
            onClick={submit}
            disabled={busy || !name.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="po-entity-add-cancel-btn"
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
          className="po-entity-add-toggle"
          onClick={() => setShowAdd(true)}
        >
          + Add new material
        </button>
      )}
    </div>
  );
}

function VarietyPicker({ varieties, value, onChange, onAdd, onDelete, busy }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    const createdId = await onAdd(name.trim());
    if (createdId) {
      setName("");
      setShowAdd(false);
    }
  };

  return (
    <div className="sf-field po-entity-field">
      <label>Variety</label>

      <div className="po-entity-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select variety</option>
          {varieties.map((v) => (
            <option key={v.id} value={v.id}>
              {v.variety_name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="po-entity-delete-btn"
          onClick={() => onDelete(value)}
          disabled={!value || busy}
          title="Delete selected variety"
        >
          🗑
        </button>
      </div>

      {showAdd ? (
        <div className="po-entity-add-row">
          <input
            type="text"
            placeholder="New variety name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="po-entity-add-confirm-btn"
            onClick={submit}
            disabled={busy || !name.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="po-entity-add-cancel-btn"
            onClick={() => {
              setShowAdd(false);
              setName("");
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="po-entity-add-toggle"
          onClick={() => setShowAdd(true)}
        >
          + Add new variety
        </button>
      )}
    </div>
  );
}

export default function PurchaseOrderApprovalPage() {
  const [orders, setOrders] = useState([]);
  const [selectedPO, setSelectedPO] = useState(null);

  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState(null);

  // ---- Master data for the pickers (vendor / material / variety) ----
  const [vendors, setVendors] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [masterActionLoading, setMasterActionLoading] = useState(false);

  // ---- "Add another material" panel — attaches an extra line item to
  // the same PO, separate from the line already selected/edited above ----
  const [addItemMaterialId, setAddItemMaterialId] = useState("");
  const [addItemVarietyId, setAddItemVarietyId] = useState("");
  const [addItemQty, setAddItemQty] = useState("");
  const [addItemRate, setAddItemRate] = useState("");
  const [addItemLoading, setAddItemLoading] = useState(false);

  const loadPendingOrders = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getPendingPurchaseOrdersApi();
      setOrders(extractList(response));
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to load pending purchase orders"
      );
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    try {
      const [vendorsRes, materialsRes, varietiesRes] = await Promise.all([
        getVendorsApi(),
        getMasterSettingsApi("material"),
        getMasterSettingsApi("variety"),
      ]);

      setVendors(extractList(vendorsRes));
      setMaterials(extractList(materialsRes));
      setVarieties(extractList(varietiesRes));
    } catch (err) {
      // Non-fatal — the pickers just come up empty and the page still works.
      console.error("Failed to load vendor/material/variety lists", err);
    }
  };

  useEffect(() => {
    loadPendingOrders();
    loadMasterData();
  }, []);

  const resetAddItemForm = () => {
    setAddItemMaterialId("");
    setAddItemVarietyId("");
    setAddItemQty("");
    setAddItemRate("");
  };

  const handleViewPO = async (po) => {
    setDetailsLoading(true);
    setError("");
    setSuccess("");

    try {
      const poNo = po.po_no;

      const response = await getPurchaseOrderByIdApi(po.id);

      const data = response.data?.data ?? response.data;

      setSelectedPO({
        ...data,
        po_no: data.po_no || poNo,
      });

      resetAddItemForm();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to load purchase order"
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedPO) return;

    const poNo = selectedPO.po_no;

    if (!window.confirm(`Approve Purchase Order ${poNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      await approvePurchaseOrderApi(poNo);

      setSuccess(`Purchase Order ${poNo} approved successfully.`);

      setSelectedPO(null);

      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to approve purchase order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedPO) return;

    const poNo = selectedPO.po_no;

    if (!rejectReason.trim()) {
      setError("Please enter a rejection reason.");
      return;
    }

    if (!window.confirm(`Reject Purchase Order ${poNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      await rejectPurchaseOrderApi(poNo, { rejection_reason: rejectReason.trim() });

      setSuccess(`Purchase Order ${poNo} rejected successfully.`);

      setRejectReason("");
      setShowRejectBox(false);
      setSelectedPO(null);

      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to reject purchase order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ---- Field readers, matched to the real API shape ----

  const getVendorName = (po) => po?.vendor?.name || "—";
  const getVendorCode = (po) => po?.vendor?.vendor_code || "—";

  const getMaterialName = (po) => po?.material?.name || "—";
  const getMaterialCode = (po) => po?.material?.material_code || "—";

  const getVarietyName = (po) => po?.variety?.variety_name || "—";

  const getPODate = (po) => {
    if (!po?.po_date) return "—";
    return new Date(po.po_date).toLocaleDateString("en-IN");
  };

  const getValidity = (po) => {
    if (!po?.validity) return "—";
    return new Date(po.validity).toLocaleDateString("en-IN");
  };

  const getQty = (po) => {
    if (po?.qty === undefined || po?.qty === null) return "—";
    return Number(po.qty).toLocaleString("en-IN");
  };

  const getRate = (po) => {
    if (po?.rate === undefined || po?.rate === null) return "—";
    return `₹${Number(po.rate).toLocaleString("en-IN")}`;
  };

  const getAmount = (po) => {
    const qty = Number(po?.qty);
    const rate = Number(po?.rate);

    if (Number.isNaN(qty) || Number.isNaN(rate)) return "—";

    return `₹${(qty * rate).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`;
  };

  const getStatus = (po) => {
    const status = po?.approval_status;
    return STATUS_LABELS[status] || status || "Pending";
  };

  const getStatusClass = (po) => {
    const status = po?.approval_status;
    if (status === "approved") return "po-status-approved";
    if (status === "rejected") return "po-status-rejected";
    return "po-status-pending";
  };

  // ---- Edit flow (edits the PO's already-selected line) ----

  const startEditPO = () => {
    if (!selectedPO) return;

    setEditForm({
      vendor_id: selectedPO.vendor_id ?? "",
      material_id: selectedPO.material_id ?? "",
      variety_id: selectedPO.variety_id ?? "",
      qty: selectedPO.qty ?? "",
      rate: selectedPO.rate ?? "",
      po_date: selectedPO.po_date
        ? String(selectedPO.po_date).split("T")[0]
        : "",
      validity: selectedPO.validity
        ? String(selectedPO.validity).split("T")[0]
        : "",
      do_no: selectedPO.do_no || "",
      plant_id: selectedPO.plant_id ?? "",
    });

    setError("");
    setSuccess("");
    setEditMode(true);
  };

  const cancelEditPO = () => {
    setEditMode(false);
    setEditForm(null);
  };

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSavePO = async () => {
    if (!selectedPO || !editForm) return;

    const poNo = selectedPO.po_no;

    if (!window.confirm(`Save changes to Purchase Order ${poNo}?`)) {
      return;
    }

    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      // updatePurchaseOrderBeforeApprovalApi is keyed by po_no, not id.
      await updatePurchaseOrderBeforeApprovalApi(poNo, {
        vendor_id: editForm.vendor_id || undefined,
        material_id: editForm.material_id || undefined,
        variety_id: editForm.variety_id || undefined,
        qty: editForm.qty !== "" ? Number(editForm.qty) : undefined,
        rate: editForm.rate !== "" ? Number(editForm.rate) : undefined,
        po_date: editForm.po_date || undefined,
        validity: editForm.validity || undefined,
        do_no: editForm.do_no || undefined,
        plant_id: editForm.plant_id || undefined,
      });

      setSuccess(`Purchase Order ${poNo} updated successfully.`);

      setEditMode(false);
      setEditForm(null);

      await handleViewPO({ id: selectedPO.id, po_no: poNo });
      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to update purchase order"
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ---- Add an extra material/variety line to this same PO ----

  const handleAddItemToPO = async () => {
    if (!selectedPO) return;

    if (
      !addItemMaterialId ||
      !addItemVarietyId ||
      addItemQty === "" ||
      addItemRate === ""
    ) {
      setError("Select a material, variety, quantity and rate to add an item.");
      return;
    }

    const poNo = selectedPO.po_no;

    if (!window.confirm(`Add this as a new item on Purchase Order ${poNo}?`)) {
      return;
    }

    setAddItemLoading(true);
    setError("");
    setSuccess("");

    try {
      await addPurchaseOrderItemApi(poNo, {
        material_id: addItemMaterialId,
        variety_id: addItemVarietyId,
        qty: Number(addItemQty),
        rate: Number(addItemRate),
      });

      setSuccess(`Added a new material line to Purchase Order ${poNo}.`);

      resetAddItemForm();

      await loadPendingOrders();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to add item to purchase order"
      );
    } finally {
      setAddItemLoading(false);
    }
  };

  // ---- Material master-data management (add / delete), shared by both
  // the edit-line picker and the add-item picker ----

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

      if (editForm && String(editForm.material_id) === String(id)) {
        handleEditChange("material_id", "");
      }
      if (String(addItemMaterialId) === String(id)) {
        setAddItemMaterialId("");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to delete material. It may be in use on another purchase order."
      );
    } finally {
      setMasterActionLoading(false);
    }
  };

  // ---- Variety master-data management (add / delete) ----

  const createVariety = async (name) => {
    setMasterActionLoading(true);
    setError("");

    try {
      const res = await createMasterSettingApi({
        type: "variety",
        variety_name: name,
      });

      const created = res.data?.data ?? res.data;

      await loadMasterData();

      return created?.id ?? null;
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to add variety"
      );
      return null;
    } finally {
      setMasterActionLoading(false);
    }
  };

  const deleteVariety = async (id) => {
    if (!id) return;

    const variety = varieties.find((v) => String(v.id) === String(id));

    if (
      !window.confirm(
        `Delete variety "${variety?.variety_name || id}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setMasterActionLoading(true);
    setError("");

    try {
      await deleteMasterSettingApi(id, "variety");

      await loadMasterData();

      if (editForm && String(editForm.variety_id) === String(id)) {
        handleEditChange("variety_id", "");
      }
      if (String(addItemVarietyId) === String(id)) {
        setAddItemVarietyId("");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Failed to delete variety. It may be in use on another purchase order."
      );
    } finally {
      setMasterActionLoading(false);
    }
  };

  return (
    <div className="po-approval-page">
      <div className="po-page-header">
        <div>
          <h2>Purchase Order Approval</h2>
          <p>Review and approve pending purchase orders.</p>
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

      {success && <div className="po-success">{success}</div>}

      {!selectedPO && (
        <>
          <div className="po-summary-cards">
            <div className="po-summary-card">
              <div className="po-summary-number">{orders.length}</div>
              <div className="po-summary-label">Pending Purchase Orders</div>
            </div>

            <div className="po-summary-card">
              <div className="po-summary-number">
                {
                  orders.filter((po) => po.approval_status === "pending_approval")
                    .length
                }
              </div>
              <div className="po-summary-label">Awaiting Approval</div>
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="po-section-header">
              <div>
                <h3>Pending Purchase Orders</h3>
                <p>Select a purchase order to review its details.</p>
              </div>
            </div>

            {loading ? (
              <p className="dt-msg">Loading pending purchase orders...</p>
            ) : orders.length === 0 ? (
              <div className="po-empty">
                <div className="po-empty-icon">✓</div>
                <h3>No Pending Purchase Orders</h3>
                <p>All purchase orders have been processed.</p>
              </div>
            ) : (
              <div className="dt-wrapper">
                <table className="dt-table po-table">
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Vendor</th>
                      <th>Material</th>
                      <th>Variety</th>
                      <th>Qty (Tons)</th>
                      <th>Rate</th>
                      <th>Amount</th>
                      <th>PO Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.map((po) => (
                      <tr key={po.id}>
                        <td>
                          <strong>{po.po_no}</strong>
                        </td>
                        <td>{getVendorName(po)}</td>
                        <td>{getMaterialName(po)}</td>
                        <td>{getVarietyName(po)}</td>
                        <td>{getQty(po)}</td>
                        <td>{getRate(po)}</td>
                        <td>{getAmount(po)}</td>
                        <td>{getPODate(po)}</td>
                        <td>
                          <span className={`dt-badge ${getStatusClass(po)}`}>
                            {getStatus(po)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="po-view-btn"
                            onClick={() => handleViewPO(po)}
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
        <div className="dashboard-panel po-edit-panel">
          <div className="po-section-header">
            <div>
              <h3>Edit Purchase Order</h3>
              <p>Make the required changes before approving this purchase order.</p>
            </div>
          </div>

          <div className="po-edit-grid">
            <div className="sf-field">
              <label>Vendor</label>
              <select
                value={editForm.vendor_id}
                onChange={(e) => handleEditChange("vendor_id", e.target.value)}
              >
                <option value="">Select vendor</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.vendor_code ? ` (${v.vendor_code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <MaterialPicker
              materials={materials}
              value={editForm.material_id}
              onChange={(v) => handleEditChange("material_id", v)}
              onAdd={async (name, code) => {
                const id = await createMaterial(name, code);
                if (id) handleEditChange("material_id", id);
                return id;
              }}
              onDelete={deleteMaterial}
              busy={masterActionLoading}
            />

            <VarietyPicker
              varieties={varieties}
              value={editForm.variety_id}
              onChange={(v) => handleEditChange("variety_id", v)}
              onAdd={async (name) => {
                const id = await createVariety(name);
                if (id) handleEditChange("variety_id", id);
                return id;
              }}
              onDelete={deleteVariety}
              busy={masterActionLoading}
            />

            <div className="sf-field">
              <label>Quantity</label>
              <input
                type="number"
                min="0"
                value={editForm.qty}
                onChange={(e) => handleEditChange("qty", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>Rate</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.rate}
                onChange={(e) => handleEditChange("rate", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>PO Date</label>
              <input
                type="date"
                value={editForm.po_date}
                onChange={(e) => handleEditChange("po_date", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>Validity</label>
              <input
                type="date"
                value={editForm.validity}
                onChange={(e) => handleEditChange("validity", e.target.value)}
              />
            </div>

            <div className="sf-field">
              <label>DO No.</label>
              <input
                type="text"
                value={editForm.do_no}
                onChange={(e) => handleEditChange("do_no", e.target.value)}
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

          <div className="po-edit-actions">
            <button
              className="po-cancel-btn"
              onClick={cancelEditPO}
              disabled={actionLoading}
            >
              Cancel
            </button>

            <button
              className="po-approve-btn"
              onClick={handleSavePO}
              disabled={actionLoading}
            >
              {actionLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {detailsLoading && (
        <div className="dashboard-panel">
          <p className="dt-msg">Loading purchase order details...</p>
        </div>
      )}

      {selectedPO && !detailsLoading && !editMode && (
        <div className="po-details-wrapper">
          <div className="po-detail-header">
            <div>
              <button className="po-back-btn" onClick={() => setSelectedPO(null)}>
                ← Back to Pending Orders
              </button>

              <h2>Purchase Order {selectedPO.po_no}</h2>
              <p>Review the purchase order before taking an action.</p>
            </div>

            <span className={`dt-badge po-large-status ${getStatusClass(selectedPO)}`}>
              {getStatus(selectedPO)}
            </span>
          </div>

          <div className="po-info-grid">
            <div className="dashboard-panel">
              <h3>Purchase Order Information</h3>

              <div className="po-info-list">
                <div>
                  <span>PO Number</span>
                  <strong>{selectedPO.po_no || "—"}</strong>
                </div>

                <div>
                  <span>PO Date</span>
                  <strong>{getPODate(selectedPO)}</strong>
                </div>

                <div>
                  <span>Validity</span>
                  <strong>{getValidity(selectedPO)}</strong>
                </div>

                <div>
                  <span>DO No.</span>
                  <strong>{selectedPO.do_no || "—"}</strong>
                </div>

                <div>
                  <span>Vendor</span>
                  <strong>{getVendorName(selectedPO)}</strong>
                </div>

                <div>
                  <span>Vendor Code</span>
                  <strong>{getVendorCode(selectedPO)}</strong>
                </div>

                <div>
                  <span>Plant ID</span>
                  <strong>{selectedPO.plant_id ?? "—"}</strong>
                </div>

                <div>
                  <span>Uploaded By Vendor</span>
                  <strong>{selectedPO.uploaded_by_vendor ? "Yes" : "No"}</strong>
                </div>
              </div>
            </div>

            <div className="dashboard-panel">
              <h3>Amount Summary</h3>

              <div className="po-amount-list">
                <div>
                  <span>Quantity</span>
                  <strong>{getQty(selectedPO)}</strong>
                </div>

                <div>
                  <span>Rate</span>
                  <strong>{getRate(selectedPO)}</strong>
                </div>

                <div className="po-grand-total">
                  <span>Total Amount</span>
                  <strong>{getAmount(selectedPO)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="dashboard-panel">
            <div className="po-section-header">
              <div>
                <h3>Material Details</h3>
                <p>Verify the material, variety, quantity, and rate before approving.</p>
              </div>
            </div>

            <div className="dt-wrapper">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Variety</th>
                    <th>Quantity</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>
                      <strong>{getMaterialName(selectedPO)}</strong>
                      <div className="po-subtext">{getMaterialCode(selectedPO)}</div>
                    </td>
                    <td>{getVarietyName(selectedPO)}</td>
                    <td>{getQty(selectedPO)}</td>
                    <td>{getRate(selectedPO)}</td>
                    <td>{getAmount(selectedPO)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {selectedPO.approval_status === "pending_approval" && (
            <div className="dashboard-panel po-additem-panel">
              <div className="po-section-header">
                <div>
                  <h3>Add Another Material</h3>
                  <p>
                    Attach an extra material/variety line to this PO — pick an
                    existing one or add a new one, in addition to what's
                    already selected above.
                  </p>
                </div>
              </div>

              <div className="po-additem-grid">
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

                <VarietyPicker
                  varieties={varieties}
                  value={addItemVarietyId}
                  onChange={setAddItemVarietyId}
                  onAdd={async (name) => {
                    const id = await createVariety(name);
                    if (id) setAddItemVarietyId(id);
                    return id;
                  }}
                  onDelete={deleteVariety}
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

              <div className="po-additem-actions">
                <button
                  className="po-approve-btn"
                  onClick={handleAddItemToPO}
                  disabled={addItemLoading || masterActionLoading}
                >
                  {addItemLoading ? "Adding..." : "+ Add Item to PO"}
                </button>
              </div>
            </div>
          )}

          {selectedPO.rejection_reason && (
            <div className="dashboard-panel">
              <h3>Rejection Reason</h3>
              <p className="po-notes">{selectedPO.rejection_reason}</p>
            </div>
          )}

          <div className="po-action-panel">
            <div>
              <h3>Approval Decision</h3>
              <p>Review the purchase order, edit it if required, then approve or reject it.</p>
            </div>

            <div className="po-actions">
              <button
                className="po-edit-btn"
                onClick={startEditPO}
                disabled={actionLoading}
              >
                ✏️ Edit PO
              </button>

              <button
                className="po-reject-btn"
                onClick={() => {
                  setShowRejectBox(!showRejectBox);
                  setError("");
                }}
                disabled={actionLoading}
              >
                Reject PO
              </button>

              <button
                className="po-approve-btn"
                onClick={handleApprove}
                disabled={actionLoading}
              >
                {actionLoading ? "Processing..." : "Approve PO"}
              </button>
            </div>
          </div>

          {showRejectBox && (
            <div className="dashboard-panel po-reject-box">
              <h3>Reject Purchase Order</h3>

              <label>Reason for rejection</label>

              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter reason for rejecting this purchase order..."
                rows={4}
              />

              <div className="po-reject-actions">
                <button
                  className="po-cancel-btn"
                  onClick={() => {
                    setShowRejectBox(false);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </button>

                <button
                  className="po-reject-confirm-btn"
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