import { useState, useEffect } from "react";
import {
  getGateEntriesApi,
  attachGateEntryDetailsApi,
  getPurchaseOrderByIdApi,
  getGateMiscItemsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";
import "../gate/GateEntry.css";

// This is the other half of the split Gate Entry flow: the Gate only
// captures Vehicle + Driver + Driver Photo, prints a token, and checks
// the truck in (see GateEntryPage.jsx). Once checked in, the entry lands
// here at gate_status "pending_details". Admin picks it, decides its
// Entry Type, and attaches the approved Purchase Order(s) / Sales
// Order(s) + materials + Challan No. + Expected Qty — or, for an
// Empty/Misc truck, logs what items it dropped off and where they were
// stored. Submitting routes the truck straight into its next queue
// (Sampling for Purchase, Weighment for Empty/Misc & Sales) — everything
// downstream from there (Lab, Weighbridge, Warehouse, Loading…) is
// untouched.

const emptyAttachForm = {
  entry_type: "purchase",
  vendor_id: "",
  customer_id: "",
  challan_no: "",
  expected_qty: "",
  remarks: "",
};

const emptyMiscItemRow = { item_name: "", qty: "", unit: "nos", storage_location: "" };

const STATUS_FILTERS = [
  { key: "pending_details", label: "Waiting on Admin" },
  { key: "", label: "All" },
  { key: "waiting_token", label: "Waiting Token" },
  { key: "waiting_sampling", label: "Waiting Sampling" },
  { key: "waiting_weighment", label: "Waiting Weighment" },
  { key: "waiting_loading", label: "Waiting Loading" },
  { key: "exited", label: "Exited" },
];

export default function GateEntryAdminPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending_details");

  const [selectedGateEntryId, setSelectedGateEntryId] = useState("");
  const [selectedGateEntry, setSelectedGateEntry] = useState(null);
  // Independent of the status-filter tab below, so the "Token waiting on
  // Admin" picker always has fresh data to resolve the id it returns into
  // a full row (vehicle/driver/photo), no matter which tab is active.
  const [pendingEntries, setPendingEntries] = useState([]);

  const [form, setForm] = useState(emptyAttachForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchingPODetails, setFetchingPODetails] = useState(false);
  const [fetchingSODetails, setFetchingSODetails] = useState(false);

  const [selectedPOs, setSelectedPOs] = useState([]);
  const [selectedMaterials, setSelectedMaterials] = useState({});

  const [selectedSOs, setSelectedSOs] = useState([]);
  const [selectedSalesMaterials, setSelectedSalesMaterials] = useState({});

  // "Other" (empty/misc) trucks — what arrived & where it was stored.
  // Kept out of the formal Inventory system; this is just a log.
  const [miscItems, setMiscItems] = useState([{ ...emptyMiscItemRow }]);
  const [miscLog, setMiscLog] = useState([]);
  const [miscLogLoading, setMiscLogLoading] = useState(false);

  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const purchaseOrders = useEntityLookup("purchase_order");
  const salesOrderGroups = useEntityLookup("sales_order_grouped");

  const load = (status = statusFilter) => {
    setLoading(true);
    getGateEntriesApi(status || undefined, undefined)
      .then((res) => setEntries(res.data.data ?? res.data))
      .catch(() => setError("Failed to load gate entries"))
      .finally(() => setLoading(false));
  };

  const loadPending = () => {
    getGateEntriesApi("pending_details", undefined, 200)
      .then((res) => setPendingEntries(res.data.data ?? res.data))
      .catch(() => {});
  };

  const loadMiscLog = () => {
    setMiscLogLoading(true);
    getGateMiscItemsApi()
      .then((res) => setMiscLog(res.data.data ?? res.data))
      .catch(() => {})
      .finally(() => setMiscLogLoading(false));
  };

  useEffect(() => {
    load();
    loadPending();
    loadMiscLog();
  }, []);

  const handleStatusFilterChange = (status) => {
    setStatusFilter(status);
    load(status);
  };

  // ============================================================
  // SELECT A PENDING TOKEN
  // ============================================================
  const handlePickGateEntry = (id) => {
    setSelectedGateEntryId(id);
    const row =
      pendingEntries.find((r) => String(r.id) === String(id)) ||
      entries.find((r) => String(r.id) === String(id)) ||
      null;
    setSelectedGateEntry(row);
    setForm(emptyAttachForm);
    setSelectedPOs([]);
    setSelectedMaterials({});
    setSelectedSOs([]);
    setSelectedSalesMaterials({});
    setMiscItems([{ ...emptyMiscItemRow }]);
    setError("");
    setInfo("");
  };

  const handleEntryTypeChange = (e) => {
    const entry_type = e.target.value;
    setForm((prev) => ({ ...emptyAttachForm, entry_type }));
    setSelectedPOs([]);
    setSelectedMaterials({});
    setSelectedSOs([]);
    setSelectedSalesMaterials({});
    setMiscItems([{ ...emptyMiscItemRow }]);
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const isOther = form.entry_type === "other";
  const isSales = form.entry_type === "sales";

  // ============================================================
  // MISC ITEM ROW HELPERS ("other" entry_type — what/how much/where)
  // ============================================================
  const handleMiscItemChange = (index, field, value) => {
    setMiscItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const handleAddMiscItemRow = () => {
    setMiscItems((prev) => [...prev, { ...emptyMiscItemRow }]);
  };

  const handleRemoveMiscItemRow = (index) => {
    setMiscItems((prev) => prev.filter((_, i) => i !== index));
  };

  // ============================================================
  // PURCHASE ORDER HELPERS
  // ============================================================
  const fetchPODetails = async (poId) => {
    try {
      setFetchingPODetails(true);
      const response = await getPurchaseOrderByIdApi(poId);
      const data = response.data;

      if (data.success && data.data) {
        let items = data.data.items || [];
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        const enrichedItems = items.map((item) => ({
          ...item,
          material: item.material || {
            id: item.material_id,
            name: `Material ${item.material_id}`,
          },
          variety: item.variety || {
            id: item.variety_id,
            variety_name: item.variety_id ? `Variety ${item.variety_id}` : null,
          },
        }));
        return { ...data.data, items: enrichedItems };
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch PO details:", error);
      return null;
    } finally {
      setFetchingPODetails(false);
    }
  };

  const handleAddPurchaseOrder = async (po_id) => {
    if (!po_id) return;

    const po = purchaseOrders.rows.find((r) => String(r.id) === String(po_id));
    if (!po) {
      setError("Purchase order not found");
      return;
    }
    if (selectedPOs.some((p) => String(p.id) === String(po.id))) {
      setError(`PO #${po.po_no || po.id} is already selected`);
      return;
    }

    let poWithDetails = po;
    let items = po.items || [];
    const hasValidItems =
      Array.isArray(items) && items.length > 0 && items.some((item) => item.material_id);

    if (!hasValidItems) {
      const detailedPO = await fetchPODetails(po_id);
      if (detailedPO) {
        poWithDetails = detailedPO;
        items = detailedPO.items || [];
      } else {
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        poWithDetails = {
          ...po,
          items: items.map((item) => ({
            ...item,
            material: { id: item.material_id, name: `Material ${item.material_id}` },
            variety: item.variety_id
              ? { id: item.variety_id, variety_name: `Variety ${item.variety_id}` }
              : null,
          })),
        };
      }
    }

    const finalItems = Array.isArray(poWithDetails.items) ? poWithDetails.items : [];
    if (finalItems.length === 0) {
      setError(`PO #${po.po_no || po.id} has no materials assigned`);
      return;
    }

    setSelectedPOs((prev) => [...prev, poWithDetails]);
    setSelectedMaterials((prev) => ({
      ...prev,
      [poWithDetails.id]: finalItems.map((m) => ({
        material_id: m.material_id,
        qty: m.qty || "",
      })),
    }));

    if (poWithDetails.vendor_id) {
      setForm((prev) => ({ ...prev, vendor_id: poWithDetails.vendor_id }));
    }
    setError("");
  };

  const handleRemovePurchaseOrder = (poId) => {
    setSelectedPOs((prev) => prev.filter((po) => String(po.id) !== String(poId)));
    setSelectedMaterials((prev) => {
      const updated = { ...prev };
      delete updated[poId];
      return updated;
    });
    if (selectedPOs.length <= 1) {
      setForm((prev) => ({ ...prev, vendor_id: "" }));
    }
  };

  const handleToggleMaterial = (poId, material) => {
    setSelectedMaterials((prev) => {
      const current = prev[poId] || [];
      const exists = current.some(
        (m) => String(m.material_id) === String(material.material_id)
      );
      return {
        ...prev,
        [poId]: exists
          ? current.filter((m) => String(m.material_id) !== String(material.material_id))
          : [...current, { material_id: material.material_id, qty: material.qty || "" }],
      };
    });
  };

  const handleMaterialQtyChange = (poId, materialId, qty) => {
    setSelectedMaterials((prev) => ({
      ...prev,
      [poId]: (prev[poId] || []).map((m) =>
        String(m.material_id) === String(materialId) ? { ...m, qty } : m
      ),
    }));
  };

  // ============================================================
  // SALES ORDER HELPERS
  // ============================================================
  const fetchSODetails = async (soId) => {
    try {
      setFetchingSODetails(true);
      const response = await fetch(`/api/sales-order/${soId}`);
      const data = await response.json();

      if (data.success && data.data) {
        let items = data.data.items || [];
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        const enrichedItems = items.map((item) => ({
          id: item.id || `${data.data.id}_${item.material_id}`,
          material_id: item.material_id,
          material: item.material || { id: item.material_id, name: `Material ${item.material_id}` },
          qty: item.qty || 0,
          rate: item.rate || 0,
          so_status: item.so_status || "confirmed",
          dispatched_qty: item.dispatched_qty || 0,
          variety: item.variety || {
            id: item.variety_id,
            variety_name: item.variety_id ? `Variety ${item.variety_id}` : null,
          },
        }));
        return { ...data.data, items: enrichedItems };
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch SO details:", error);
      return null;
    } finally {
      setFetchingSODetails(false);
    }
  };

  const handleAddSalesOrder = async (so_id) => {
    if (!so_id) return;

    const so = salesOrderGroups.rows.find((r) => String(r.id) === String(so_id));
    if (!so) {
      setError("Sales order not found");
      return;
    }
    if (selectedSOs.some((s) => String(s.id) === String(so.id))) {
      setError(`SO #${so.so_no || so.id} is already selected`);
      return;
    }

    let soWithDetails = so;
    let items = so.items || [];
    const hasValidItems =
      Array.isArray(items) && items.length > 0 && items.some((item) => item.material_id);

    if (!hasValidItems) {
      const detailedSO = await fetchSODetails(so_id);
      if (detailedSO) {
        soWithDetails = detailedSO;
        items = detailedSO.items || [];
      } else {
        if (typeof items === "string") {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        items = items.map((item) => ({
          ...item,
          material_id: item.material_id || item.id,
          material: { id: item.material_id || item.id, name: `Material ${item.material_id || item.id}` },
        }));
        soWithDetails = { ...so, items };
      }
    }

    const finalItems = Array.isArray(soWithDetails.items) ? soWithDetails.items : [];
    if (finalItems.length === 0) {
      setError(`SO #${so.so_no || so.id} has no materials assigned`);
      return;
    }

    setSelectedSOs((prev) => [...prev, soWithDetails]);

    const selectableItems = finalItems.filter((m) => {
      const ordered = Number(m.qty || 0);
      const dispatched = Number(m.dispatched_qty || 0);
      return ordered - dispatched > 0;
    });

    setSelectedSalesMaterials((prev) => ({
      ...prev,
      [soWithDetails.id]: selectableItems.map((m) => ({
        material_id: Number(m.material_id),
        qty: "",
      })),
    }));

    if (soWithDetails.customer_id) {
      setForm((prev) => ({ ...prev, customer_id: soWithDetails.customer_id }));
    }
    setError("");
  };

  const handleRemoveSalesOrder = (soId) => {
    setSelectedSOs((prev) => prev.filter((so) => String(so.id) !== String(soId)));
    setSelectedSalesMaterials((prev) => {
      const updated = { ...prev };
      delete updated[soId];
      return updated;
    });
    if (selectedSOs.length <= 1) {
      setForm((prev) => ({ ...prev, customer_id: "" }));
    }
  };

  const handleToggleSalesMaterial = (soId, material) => {
    setSelectedSalesMaterials((prev) => {
      const current = prev[soId] || [];
      const exists = current.some(
        (m) => String(m.material_id) === String(material.material_id)
      );
      return {
        ...prev,
        [soId]: exists
          ? current.filter((m) => String(m.material_id) !== String(material.material_id))
          : [...current, { material_id: material.material_id, qty: material.qty || "" }],
      };
    });
  };

  const handleSalesMaterialQtyChange = (soId, materialId, qty) => {
    setSelectedSalesMaterials((prev) => ({
      ...prev,
      [soId]: (prev[soId] || []).map((m) =>
        String(m.material_id) === String(materialId) ? { ...m, qty } : m
      ),
    }));
  };

  // ============================================================
  // SUBMIT — ATTACH DETAILS TO THE SELECTED TOKEN
  // ============================================================
  const handleAttach = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!selectedGateEntryId) {
      setError("Pick a token waiting on Admin first.");
      return;
    }

    try {
      const payload = {
        gate_entry_id: Number(selectedGateEntryId),
        entry_type: form.entry_type,
      };

      if (form.entry_type === "purchase") {
        if (selectedPOs.length === 0) {
          setError("Please select at least one Purchase Order.");
          return;
        }
        const allMaterialsSelected = selectedPOs.every((po) => {
          const materials = selectedMaterials[po.id] || [];
          return materials.length > 0;
        });
        if (!allMaterialsSelected) {
          setError("Please select at least one material for each Purchase Order.");
          return;
        }

        const purchase_orders = selectedPOs.map((po) => {
          const materials = selectedMaterials[po.id] || [];
          return {
            po_id: Number(po.id),
            materials: materials.map((material) => ({
              material_id: Number(material.material_id),
              qty: material.qty ? Number(material.qty) : null,
            })),
          };
        });

        const invalidPO = purchase_orders.find(
          (po) =>
            po.materials.length === 0 ||
            po.materials.some((m) => !m.material_id || !m.qty || m.qty <= 0)
        );
        if (invalidPO) {
          setError(`Please ensure all materials have valid IDs and quantities for PO ${invalidPO.po_id}.`);
          return;
        }

        if (!form.challan_no) {
          setError("Challan No. is required for a Purchase entry.");
          return;
        }
        if (!form.expected_qty) {
          setError("Expected Qty is required for a Purchase entry.");
          return;
        }

        payload.vendor_id = Number(form.vendor_id);
        payload.purchase_orders = purchase_orders;
        payload.challan_no = form.challan_no;
        payload.expected_qty = Number(form.expected_qty);
      } else if (form.entry_type === "sales") {
        if (selectedSOs.length === 0) {
          setError("Please select at least one Sales Order.");
          return;
        }
        const allMaterialsSelected = selectedSOs.every((so) => {
          const materials = selectedSalesMaterials[so.id] || [];
          return materials.length > 0;
        });
        if (!allMaterialsSelected) {
          setError("Please select at least one material for each Sales Order.");
          return;
        }

        const sales_orders = selectedSOs.map((so) => {
          const materials = selectedSalesMaterials[so.id] || [];
          return {
            so_id: Number(so.id),
            materials: materials.map((material) => ({
              material_id: Number(material.material_id),
              qty: material.qty ? Number(material.qty) : null,
            })),
          };
        });

        const invalidSO = sales_orders.find(
          (so) =>
            so.materials.length === 0 ||
            so.materials.some((m) => !m.material_id || !m.qty || m.qty <= 0)
        );
        if (invalidSO) {
          setError(`Please ensure all materials have valid IDs and quantities for SO ${invalidSO.so_id}.`);
          return;
        }

        payload.customer_id = Number(form.customer_id);
        payload.sales_orders = sales_orders;
        payload.challan_no = form.challan_no;
        payload.expected_qty = form.expected_qty ? Number(form.expected_qty) : undefined;
      } else {
        // "other" entry type
        payload.challan_no = form.challan_no;
        payload.remarks = form.remarks;

        const validMiscRows = miscItems.filter(
          (row) => row.item_name.trim() && row.qty !== "" && Number(row.qty) > 0
        );
        const incompleteRow = miscItems.find(
          (row) =>
            (row.item_name.trim() || row.qty !== "") &&
            !(row.item_name.trim() && row.qty !== "" && Number(row.qty) > 0)
        );
        if (incompleteRow) {
          setError("Each misc item row needs both an Item Name and a Qty greater than 0 — or leave the row fully blank to skip it.");
          return;
        }

        payload.misc_items = validMiscRows.map((row) => ({
          item_name: row.item_name.trim(),
          qty: Number(row.qty),
          unit: row.unit || "nos",
          storage_location: row.storage_location.trim() || undefined,
        }));
      }

      setSubmitting(true);
      const res = await attachGateEntryDetailsApi(payload);
      setInfo(
        res.data.msg ||
          "Details attached — the truck has moved into its next queue."
      );

      setSelectedGateEntryId("");
      setSelectedGateEntry(null);
      setForm(emptyAttachForm);
      setSelectedPOs([]);
      setSelectedMaterials({});
      setSelectedSOs([]);
      setSelectedSalesMaterials({});
      setMiscItems([{ ...emptyMiscItemRow }]);
      load();
      loadPending();
      loadMiscLog();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Failed to attach details");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Gate Entry</h2>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Trucks are checked in at the Gate with just Vehicle + Driver + Driver Photo — the
        Entry Type isn't known yet at that point. Pick one below that's "Waiting on
        Admin", choose its Entry Type, and attach the approved Purchase Order or Sales
        Order (with materials, Challan No. and Expected Qty) — or, for an Empty/Misc
        truck, log what it dropped off and where. Submitting sends the truck straight
        into its next queue (Sampling for Purchase, Weighment for Empty/Misc & Sales).
      </p>

      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <h3 style={{ marginBottom: 4 }}>Attach Details to a Token</h3>
      <div className="sf-field">
        <label>Checked-in token waiting on Admin</label>
        <EntitySelect
          entity="gate_entry"
          label=""
          value={selectedGateEntryId}
          onChange={handlePickGateEntry}
          filter={(row) => row.gate_status === "pending_details"}
          placeholder="Search by token no…"
        />
        <p className="field-hint">
          Only tokens that have been checked in at the Gate but not yet classified show up here.
        </p>
      </div>

      {selectedGateEntry && (
        <>
          <div className="po-selection-card" style={{ marginBottom: 16 }}>
            <div className="po-selection-header">
              <div>
                <strong>Token {selectedGateEntry.token_no}</strong>
                <div className="field-hint">
                  Vehicle: {selectedGateEntry.vehicle?.vehicle_no || vehicles.getLabel(selectedGateEntry.vehicle_id)}
                  {" · "}
                  Driver: {selectedGateEntry.driver?.name || drivers.getLabel(selectedGateEntry.driver_id)}
                </div>
              </div>
              {selectedGateEntry.driver_photo_url && (
                <img
                  src={selectedGateEntry.driver_photo_url}
                  alt="Driver"
                  style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", border: "1px solid #cbd5e1" }}
                />
              )}
            </div>
          </div>

          <form className="sf-form" onSubmit={handleAttach}>
            <div className="sf-field">
              <label>Entry Type</label>
              <select name="entry_type" value={form.entry_type} onChange={handleEntryTypeChange}>
                <option value="purchase">Purchase (Vendor Delivery)</option>
                <option value="other">Empty / Miscellaneous</option>
                <option value="sales">Sales (Outbound Loading)</option>
              </select>
              <p className="field-hint">
                {isSales
                  ? "An empty truck arriving to be loaded against a Sales Order and dispatched."
                  : isOther
                  ? "No vendor delivery — e.g. an empty truck, or one dropping off items that don't need QC."
                  : "A vendor is delivering grain against a Purchase Order."}
              </p>
            </div>

            {form.entry_type === "purchase" && (
              <>
                <div className="sf-field">
                  <label>Purchase Orders</label>
                  <EntitySelect
                    entity="purchase_order"
                    label="Add Purchase Order"
                    value=""
                    onChange={handleAddPurchaseOrder}
                    required={selectedPOs.length === 0}
                    disabled={fetchingPODetails}
                  />
                  {fetchingPODetails && (
                    <p className="field-hint" style={{ color: "#2563eb" }}>Loading PO details...</p>
                  )}
                  <p className="field-hint">
                    You can select multiple approved Purchase Orders. After selecting a PO,
                    choose one or more materials from that PO.
                  </p>
                </div>

                {selectedPOs.length > 0 && (
                  <div className="multi-po-container">
                    {selectedPOs.map((po) => {
                      const materials = Array.isArray(po.items) ? po.items : [];
                      const selected = selectedMaterials[po.id] || [];
                      return (
                        <div key={po.id} className="po-selection-card">
                          <div className="po-selection-header">
                            <div>
                              <strong>PO #{po.po_no || po.id}</strong>
                              <div className="field-hint">Vendor: {po.vendor?.name || "—"}</div>
                            </div>
                            <button
                              type="button"
                              className="dt-btn dt-btn-danger"
                              onClick={() => handleRemovePurchaseOrder(po.id)}
                            >
                              Remove
                            </button>
                          </div>

                          {materials.length === 0 ? (
                            <div className="po-material-list">
                              <div className="field-hint" style={{ padding: "8px", color: "#dc2626" }}>
                                No materials found for this PO. Please check the PO details.
                              </div>
                            </div>
                          ) : (
                            <div className="po-material-list">
                              <div className="po-material-title">Select Materials</div>
                              {materials.map((material) => {
                                const isSelected = selected.some(
                                  (m) => String(m.material_id) === String(material.material_id)
                                );
                                const selectedMaterial = selected.find(
                                  (m) => String(m.material_id) === String(material.material_id)
                                );
                                return (
                                  <div
                                    key={material.material_id}
                                    className={`po-material-row ${isSelected ? "selected" : ""}`}
                                  >
                                    <label className="material-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => handleToggleMaterial(po.id, material)}
                                      />
                                      <span>
                                        <strong>
                                          {material.material?.name ||
                                            material.material_name ||
                                            `Material ${material.material_id}`}
                                        </strong>
                                        {material.variety?.variety_name && (
                                          <span className="material-variety">
                                            {" "}
                                            ({material.variety.variety_name})
                                          </span>
                                        )}
                                        <small>
                                          Ordered: {material.qty} @ ₹{material.rate}
                                        </small>
                                      </span>
                                    </label>
                                    {isSelected && (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="material-qty-input"
                                        placeholder="Qty (Tons)"
                                        value={selectedMaterial?.qty || ""}
                                        onChange={(e) =>
                                          handleMaterialQtyChange(po.id, material.material_id, e.target.value)
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="sf-field">
                  <label>Challan No.</label>
                  <input name="challan_no" value={form.challan_no} onChange={handleChange} required />
                  <p className="field-hint">The delivery-note number the driver brought with them.</p>
                </div>

                <div className="sf-field">
                  <label>Expected Qty (Tons)</label>
                  <input
                    name="expected_qty"
                    type="number"
                    value={form.expected_qty}
                    onChange={handleChange}
                    required
                  />
                  <p className="field-hint">Total quantity expected on this truck.</p>
                </div>
              </>
            )}

            {isSales && (
              <>
                <div className="sf-field">
                  <label>Sales Orders</label>
                  <EntitySelect
                    entity="sales_order_grouped"
                    label="Add Sales Order"
                    value=""
                    onChange={handleAddSalesOrder}
                    required={selectedSOs.length === 0}
                    disabled={fetchingSODetails}
                  />
                  {fetchingSODetails && (
                    <p className="field-hint" style={{ color: "#2563eb" }}>Loading SO details...</p>
                  )}
                  <p className="field-hint">
                    You can select multiple approved Sales Orders. After selecting an SO,
                    choose one or more materials from that SO to be loaded.
                  </p>
                </div>

                {selectedSOs.length > 0 && (
                  <div className="multi-po-container">
                    {selectedSOs.map((so) => {
                      const materials = Array.isArray(so.items) ? so.items : [];
                      const selected = selectedSalesMaterials[so.id] || [];
                      return (
                        <div key={so.id} className="po-selection-card">
                          <div className="po-selection-header">
                            <div>
                              <strong>SO #{so.so_no || so.id}</strong>
                              <div className="field-hint">Customer: {so.customer?.name || "—"}</div>
                            </div>
                            <button
                              type="button"
                              className="dt-btn dt-btn-danger"
                              onClick={() => handleRemoveSalesOrder(so.id)}
                            >
                              Remove
                            </button>
                          </div>

                          {materials.length === 0 ? (
                            <div className="po-material-list">
                              <div className="field-hint" style={{ padding: "8px", color: "#dc2626" }}>
                                No materials found for this SO. Please check the SO details.
                              </div>
                            </div>
                          ) : (
                            <div className="po-material-list">
                              <div className="po-material-title">Select Materials</div>
                              {materials.map((material) => {
                                const isSelected = selected.some(
                                  (m) => String(m.material_id) === String(material.material_id)
                                );
                                const selectedMaterial = selected.find(
                                  (m) => String(m.material_id) === String(material.material_id)
                                );
                                const orderedQty = Number(material.qty || 0);
                                const dispatchedQty = Number(material.dispatched_qty || 0);
                                const remainingQty = orderedQty - dispatchedQty;
                                return (
                                  <div
                                    key={material.material_id}
                                    className={`po-material-row ${isSelected ? "selected" : ""}`}
                                  >
                                    <label className="material-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => handleToggleSalesMaterial(so.id, material)}
                                        disabled={remainingQty <= 0}
                                      />
                                      <span>
                                        <strong>
                                          {material.material?.name ||
                                            material.material_name ||
                                            `Material ${material.material_id}`}
                                        </strong>
                                        {material.variety?.variety_name && (
                                          <span className="material-variety">
                                            {" "}
                                            ({material.variety.variety_name})
                                          </span>
                                        )}
                                        <small>
                                          Ordered: {material.qty} @ ₹{material.rate} | Remaining: {remainingQty}
                                          {remainingQty <= 0 && " (Fully Dispatched)"}
                                        </small>
                                      </span>
                                    </label>
                                    {isSelected && (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        max={remainingQty}
                                        className="material-qty-input"
                                        placeholder="Qty to Load (Tons)"
                                        value={selectedMaterial?.qty || ""}
                                        onChange={(e) =>
                                          handleSalesMaterialQtyChange(so.id, material.material_id, e.target.value)
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="sf-field">
                  <label>Challan No. (if any)</label>
                  <input name="challan_no" value={form.challan_no} onChange={handleChange} />
                  <p className="field-hint">Optional — the delivery-note number for this dispatch, if any.</p>
                </div>
                <div className="sf-field">
                  <label>Planned Loading Qty (Tons) (optional)</label>
                  <input name="expected_qty" type="number" value={form.expected_qty} onChange={handleChange} />
                  <p className="field-hint">
                    Optional estimate only — the actual quantity is entered when the truck is loaded
                    (Loading tab). The total will be calculated from selected materials.
                  </p>
                </div>
              </>
            )}

            {isOther && (
              <>
                <div className="sf-field">
                  <label>Misc Items Received (optional)</label>
                  <p className="field-hint" style={{ marginTop: 0 }}>
                    Not stock in the formal Inventory sense — just a record of what this
                    truck dropped off and where it was kept, so it isn't lost track of.
                    Leave a row blank to skip it.
                  </p>
                  {miscItems.map((row, idx) => (
                    <div
                      key={idx}
                      className="po-material-row"
                      style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}
                    >
                      <input
                        placeholder="Item name (e.g. Jute bags)"
                        value={row.item_name}
                        onChange={(e) => handleMiscItemChange(idx, "item_name", e.target.value)}
                        style={{ flex: "2 1 160px" }}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Qty"
                        value={row.qty}
                        onChange={(e) => handleMiscItemChange(idx, "qty", e.target.value)}
                        style={{ flex: "1 1 80px" }}
                      />
                      <select
                        value={row.unit}
                        onChange={(e) => handleMiscItemChange(idx, "unit", e.target.value)}
                        style={{ flex: "1 1 90px" }}
                      >
                        <option value="nos">nos</option>
                        <option value="kg">kg</option>
                        <option value="tons">tons</option>
                        <option value="bags">bags</option>
                        <option value="ltr">ltr</option>
                        <option value="box">box</option>
                      </select>
                      <input
                        placeholder="Storage location (e.g. Warehouse 2, Rack 3)"
                        value={row.storage_location}
                        onChange={(e) => handleMiscItemChange(idx, "storage_location", e.target.value)}
                        style={{ flex: "2 1 180px" }}
                      />
                      {miscItems.length > 1 && (
                        <button
                          type="button"
                          className="dt-btn dt-btn-danger"
                          onClick={() => handleRemoveMiscItemRow(idx)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="dt-btn" onClick={handleAddMiscItemRow}>
                    + Add Item
                  </button>
                </div>

                <div className="sf-field">
                  <label>Challan No. (if any)</label>
                  <input name="challan_no" value={form.challan_no} onChange={handleChange} />
                  <p className="field-hint">Optional — only if the driver brought a delivery note.</p>
                </div>
                <div className="sf-field">
                  <label>Remarks</label>
                  <input
                    name="remarks"
                    value={form.remarks}
                    onChange={handleChange}
                    placeholder="e.g. Empty truck returning from delivery, or dropping off packing material"
                  />
                  <p className="field-hint">
                    What this truck is here for, since there's no vendor/material to describe it.
                  </p>
                </div>
              </>
            )}

            <button className="sf-submit" type="submit" disabled={submitting || fetchingPODetails || fetchingSODetails}>
              {submitting ? "Attaching…" : "Attach Details"}
            </button>
          </form>
        </>
      )}

      <h3>Gate Entries</h3>
      <div className="section-tabs">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${statusFilter === f.key ? "active" : ""}`}
            onClick={() => handleStatusFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={entries}
        columns={[
          {
            key: "token_no",
            label: "Token No.",
            render: (row) => <span className="token-chip">{row.token_no}</span>,
          },
          {
            key: "entry_type",
            label: "Type",
            render: (row) => (
              <span className="dt-badge">
                {row.entry_type === "pending"
                  ? "Not yet classified"
                  : row.entry_type === "other"
                  ? "Empty / Misc"
                  : row.entry_type === "sales"
                  ? "Sales (Outbound)"
                  : "Purchase"}
              </span>
            ),
          },
          {
            key: "vehicle_id",
            label: "Vehicle No.",
            render: (row) => row.vehicle?.vehicle_no || vehicles.getLabel(row.vehicle_id),
          },
          {
            key: "driver_id",
            label: "Driver Name",
            render: (row) => row.driver?.name || drivers.getLabel(row.driver_id),
          },
          { key: "challan_no", label: "Challan No." },
          {
            key: "gate_status",
            label: "Status",
            render: (row) =>
              row.gate_status === "pending_details" ? (
                <span className="dt-badge" style={{ background: "#fef3c7", color: "#92400e" }}>
                  Waiting on Admin
                </span>
              ) : (
                <span className="dt-badge">{row.gate_status}</span>
              ),
          },
          {
            key: "actions",
            label: "Actions",
            render: (row) =>
              row.gate_status === "pending_details" ? (
                <button className="dt-btn" onClick={() => handlePickGateEntry(String(row.id))}>
                  Attach Details
                </button>
              ) : (
                "—"
              ),
          },
        ]}
      />

      <h3>Misc / Other Items Log</h3>
      <p className="field-hint" style={{ marginTop: 0 }}>
        What's come in on Empty/Misc trucks and where it was stored — a simple log, not
        part of the formal Inventory system.
      </p>
      <DataTable
        loading={miscLogLoading}
        rows={miscLog}
        columns={[
          { key: "item_name", label: "Item" },
          {
            key: "qty",
            label: "Qty",
            render: (row) => `${row.qty} ${row.unit || ""}`.trim(),
          },
          {
            key: "storage_location",
            label: "Storage Location",
            render: (row) => row.storage_location || "—",
          },
          {
            key: "token_no",
            label: "Token / Vehicle",
            render: (row) => (
              <span>
                <span className="token-chip">{row.gate_entry?.token_no}</span>{" "}
                {row.gate_entry?.vehicle?.vehicle_no || ""}
              </span>
            ),
          },
          {
            key: "created_at",
            label: "Date",
            render: (row) =>
              row.created_at ? new Date(row.created_at).toLocaleDateString() : "—",
          },
          { key: "remarks", label: "Remarks", render: (row) => row.remarks || "—" },
        ]}
      />

      <ModuleGuide
        title="Admin — Gate Entry"
        steps={[
          "The Gate generates a token (Vehicle + Driver + Driver Photo) and checks the truck in as soon as it's physically at the gate. It shows up here as 'Waiting on Admin' once checked in.",
          "Pick that token above (or click 'Attach Details' in the table), choose its Entry Type, and attach the approved Purchase Order(s) or Sales Order(s) — same picker you'd have used at the Gate before, just moved here.",
          "For Purchase, pick one or more approved POs and the materials/quantities being delivered, plus the Challan No. and Expected Qty.",
          "For Sales (Outbound Loading), pick one or more approved SOs and the materials/quantities to be loaded.",
          "For Empty/Miscellaneous, list what the truck dropped off (item, qty, unit) and where it was stored — this isn't tracked in the formal Inventory system, just logged here so it isn't lost track of. Challan No. and Remarks are optional too.",
          "Submitting routes the truck straight into its next queue: Purchase trucks join Sampling; Empty/Misc and Sales trucks join Weighment. The normal journey from there (Lab, Weighbridge, Warehouse, Loading…) proceeds exactly as before.",
          "The Misc / Other Items Log below lists everything logged against Empty/Misc trucks — what, how much, and where it's stored.",
        ]}
      />
    </div>
  );
}