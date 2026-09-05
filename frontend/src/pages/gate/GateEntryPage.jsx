import { useState, useEffect } from "react";
import {
  getGateEntriesApi,
  generateGateTokenApi,
  gateCheckinApi,
  gateCheckoutApi,
  gateSendToWarehouseApi,
  uploadGatePhotoApi,
  getPurchaseOrderByIdApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import CameraCapture from "../../components/CameraCapture";
import { useEntityLookup } from "../../hooks/useEntityLookup";
import "./GateEntry.css";

const emptyForm = {
  entry_type: "purchase",
  vehicle_id: "",
  driver_id: "",
  vendor_id: "",
  customer_id: "", // Add this
  so_id: "",
  challan_no: "",
  expected_qty: "",
  remarks: "",
  driver_photo_url: "",
};

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "waiting_token", label: "Waiting Token" },
  { key: "waiting_sampling", label: "Waiting Sampling" },
  { key: "sampling_done", label: "Sampling Done" },
  { key: "accepted", label: "Accepted" },
  { key: "waiting_weighment", label: "Waiting Weighment" },
  { key: "rejected", label: "Rejected" },
  { key: "in_process", label: "In Process (Weighed)" },
  { key: "unloaded", label: "Unloaded" },
  { key: "waiting_loading", label: "Waiting Loading" },
  { key: "loaded", label: "Loaded" },
  { key: "parked", label: "Parked" },
  { key: "exited", label: "Exited" },
];

const ENTRY_TYPE_FILTERS = [
  { key: "", label: "All Trucks" },
  { key: "purchase", label: "Purchase Trucks" },
  { key: "other", label: "Empty / Misc Trucks" },
  { key: "sales", label: "Sales (Outbound) Trucks" },
];

export default function GateEntryPage({ prefillSoId, onPrefillConsumed } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [poGroup, setPoGroup] = useState(null);
  const [soGroup, setSoGroup] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lastToken, setLastToken] = useState("");
  const [lastVendor, setLastVendor] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [fetchingPODetails, setFetchingPODetails] = useState(false);

  const [selectedPOs, setSelectedPOs] = useState([]);
  const [selectedMaterials, setSelectedMaterials] = useState({});

  const [selectedSOs, setSelectedSOs] = useState([]);
const [selectedSalesMaterials, setSelectedSalesMaterials] = useState({});
const [fetchingSODetails, setFetchingSODetails] = useState(false);

  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");
  const purchaseOrders = useEntityLookup("purchase_order");
  const salesOrders = useEntityLookup("sales_order");
  const salesOrderGroups = useEntityLookup("sales_order_grouped");


// ============================================================
// FETCH SO DETAILS - NEW FUNCTION
// ============================================================
const fetchSODetails = async (soId) => {
  try {
    setFetchingSODetails(true);
    const response = await fetch(`/api/sales-order/${soId}`);
    const data = await response.json();
    
    if (data.success && data.data) {
      // Parse items if they're stored as JSON string
      let items = data.data.items || [];
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (e) {
          items = [];
        }
      }
      
      // Ensure each item has the required fields
      // IMPORTANT: Make sure material_id is present and matches what backend expects
      const enrichedItems = items.map(item => ({
        id: item.id || `${data.data.id}_${item.material_id}`,
        material_id: item.material_id, // Keep as number
        material: item.material || { 
          id: item.material_id, 
          name: `Material ${item.material_id}` 
        },
        qty: item.qty || 0,
        rate: item.rate || 0,
        so_status: item.so_status || 'confirmed',
        dispatched_qty: item.dispatched_qty || 0,
        variety: item.variety || { 
          id: item.variety_id, 
          variety_name: item.variety_id ? `Variety ${item.variety_id}` : null 
        }
      }));
      
      return {
        ...data.data,
        items: enrichedItems
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch SO details:', error);
    return null;
  } finally {
    setFetchingSODetails(false);
  }
};

// ============================================================
// HANDLE ADD SALES ORDER - FIXED
// ============================================================
const handleAddSalesOrder = async (so_id) => {
  if (!so_id) return;

  // First get the basic SO from lookup
  const so = salesOrderGroups.rows.find(
    (r) => String(r.id) === String(so_id)
  );

  if (!so) {
    setError("Sales order not found");
    return;
  }

  // Check if already selected
  if (selectedSOs.some((s) => String(s.id) === String(so.id))) {
    setError(`SO #${so.so_no || so.id} is already selected`);
    return;
  }

  // If items are not populated or empty, fetch full details
  let soWithDetails = so;
  let items = so.items || [];
  
  // Check if items are empty or not properly populated
  const hasValidItems = Array.isArray(items) && items.length > 0 && 
                        items.some(item => item.material_id);
  
  if (!hasValidItems) {
    // Fetch detailed SO data
    const detailedSO = await fetchSODetails(so_id);
    if (detailedSO) {
      soWithDetails = detailedSO;
      items = detailedSO.items || [];
    } else {
      // If fetch fails but we have some items, try to use them
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (e) {
          items = [];
        }
      }
      // Ensure each item has material_id
      items = items.map(item => ({
        ...item,
        material_id: item.material_id || item.id,
        material: { 
          id: item.material_id || item.id, 
          name: `Material ${item.material_id || item.id}` 
        }
      }));
      
      soWithDetails = {
        ...so,
        items: items
      };
    }
  }

  // Final check: ensure we have items with material_id
  const finalItems = Array.isArray(soWithDetails.items) ? soWithDetails.items : [];
  if (finalItems.length === 0) {
    setError(`SO #${so.so_no || so.id} has no materials assigned`);
    return;
  }

  // IMPORTANT: Log the SO data to debug
  console.log('Adding SO with items:', finalItems);

  setSelectedSOs((prev) => [...prev, soWithDetails]);

  // Initialize materials for this SO — ensure material_id is properly set.
  // Only pre-select materials that still have something left to load;
  // a fully-dispatched material's checkbox is disabled in the UI, so if
  // it were auto-selected here the user could never uncheck it, and it
  // would sit in the selection forever with no valid quantity, blocking
  // submission.
  const selectableItems = finalItems.filter((m) => {
    const ordered = Number(m.qty || 0);
    const dispatched = Number(m.dispatched_qty || 0);
    return ordered - dispatched > 0;
  });

  setSelectedSalesMaterials((prev) => ({
    ...prev,
    [soWithDetails.id]: selectableItems.map((m) => ({
      material_id: Number(m.material_id), // Ensure it's a number
      qty: "",
    })),
  }));

  // Auto-set customer_id if not set
  if (soWithDetails.customer_id) {
    setForm((prev) => ({
      ...prev,
      customer_id: soWithDetails.customer_id,
    }));
  }

  // Clear any previous error
  setError("");
};

// ============================================================
// HANDLE REMOVE SALES ORDER
// ============================================================
const handleRemoveSalesOrder = (soId) => {
  setSelectedSOs((prev) =>
    prev.filter((so) => String(so.id) !== String(soId))
  );

  setSelectedSalesMaterials((prev) => {
    const updated = { ...prev };
    delete updated[soId];
    return updated;
  });

  // Clear customer_id if no SOs left
  if (selectedSOs.length <= 1) {
    setForm((prev) => ({
      ...prev,
      customer_id: "",
    }));
  }
};

// ============================================================
// HANDLE TOGGLE SALES MATERIAL
// ============================================================
const handleToggleSalesMaterial = (soId, material) => {
  setSelectedSalesMaterials((prev) => {
    const current = prev[soId] || [];

    const exists = current.some(
      (m) => String(m.material_id) === String(material.material_id)
    );

    return {
      ...prev,
      [soId]: exists
        ? current.filter(
            (m) =>
              String(m.material_id) !== String(material.material_id)
          )
        : [
            ...current,
            {
              material_id: material.material_id,
              qty: material.qty || "",
            },
          ],
    };
  });
};

// ============================================================
// HANDLE SALES MATERIAL QTY CHANGE
// ============================================================
const handleSalesMaterialQtyChange = (soId, materialId, qty) => {
  setSelectedSalesMaterials((prev) => ({
    ...prev,
    [soId]: (prev[soId] || []).map((m) =>
      String(m.material_id) === String(materialId)
        ? { ...m, qty }
        : m
    ),
  }));
};
  // ============================================================
  // FETCH PO DETAILS - NEW FUNCTION
  // ============================================================
  const fetchPODetails = async (poId) => {
    try {
      setFetchingPODetails(true);
      const response = await getPurchaseOrderByIdApi(poId);
      const data = response.data;
      
      if (data.success && data.data) {
        // Parse items if they're stored as JSON string
        let items = data.data.items || [];
        if (typeof items === 'string') {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        
        // Ensure each item has material and variety objects
        const enrichedItems = items.map(item => ({
          ...item,
          material: item.material || { 
            id: item.material_id, 
            name: `Material ${item.material_id}` 
          },
          variety: item.variety || { 
            id: item.variety_id, 
            variety_name: item.variety_id ? `Variety ${item.variety_id}` : null 
          }
        }));
        
        return {
          ...data.data,
          items: enrichedItems
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch PO details:', error);
      return null;
    } finally {
      setFetchingPODetails(false);
    }
  };

  // ============================================================
  // HANDLE ADD PURCHASE ORDER - UPDATED
  // ============================================================
  const handleAddPurchaseOrder = async (po_id) => {
    if (!po_id) return;

    // First get the basic PO from lookup
    const po = purchaseOrders.rows.find(
      (r) => String(r.id) === String(po_id)
    );

    if (!po) {
      setError("Purchase order not found");
      return;
    }

    // Check if already selected
    if (selectedPOs.some((p) => String(p.id) === String(po.id))) {
      setError(`PO #${po.po_no || po.id} is already selected`);
      return;
    }

    // If items are not populated or empty, fetch full details
    let poWithDetails = po;
    let items = po.items || [];
    
    // Check if items are empty or not properly populated
    const hasValidItems = Array.isArray(items) && items.length > 0 && 
                          items.some(item => item.material_id);
    
    if (!hasValidItems) {
      // Fetch detailed PO data
      const detailedPO = await fetchPODetails(po_id);
      if (detailedPO) {
        poWithDetails = detailedPO;
        items = detailedPO.items || [];
      } else {
        // If fetch fails but we have some items, try to use them
        if (typeof items === 'string') {
          try {
            items = JSON.parse(items);
          } catch (e) {
            items = [];
          }
        }
        poWithDetails = {
          ...po,
          items: items.map(item => ({
            ...item,
            material: { 
              id: item.material_id, 
              name: `Material ${item.material_id}` 
            },
            variety: item.variety_id ? { 
              id: item.variety_id, 
              variety_name: `Variety ${item.variety_id}` 
            } : null
          }))
        };
      }
    }

    // Final check: ensure we have items with material_id
    const finalItems = Array.isArray(poWithDetails.items) ? poWithDetails.items : [];
    if (finalItems.length === 0) {
      setError(`PO #${po.po_no || po.id} has no materials assigned`);
      return;
    }

    setSelectedPOs((prev) => [...prev, poWithDetails]);

    // Initialize materials for this PO
    setSelectedMaterials((prev) => ({
      ...prev,
      [poWithDetails.id]: finalItems.map((m) => ({
        material_id: m.material_id,
        qty: m.qty || "",
      })),
    }));

    // Auto-set vendor_id if not set
    if (poWithDetails.vendor_id) {
      setForm((prev) => ({
        ...prev,
        vendor_id: poWithDetails.vendor_id,
      }));
    }

    // Clear any previous error
    setError("");
  };

  // ============================================================
  // HANDLE REMOVE PURCHASE ORDER
  // ============================================================
  const handleRemovePurchaseOrder = (poId) => {
    setSelectedPOs((prev) =>
      prev.filter((po) => String(po.id) !== String(poId))
    );

    setSelectedMaterials((prev) => {
      const updated = { ...prev };
      delete updated[poId];
      return updated;
    });

    // Clear vendor_id if no POs left
    if (selectedPOs.length <= 1) {
      setForm((prev) => ({
        ...prev,
        vendor_id: "",
      }));
    }
  };

  // ============================================================
  // HANDLE TOGGLE MATERIAL
  // ============================================================
  const handleToggleMaterial = (poId, material) => {
    setSelectedMaterials((prev) => {
      const current = prev[poId] || [];

      const exists = current.some(
        (m) => String(m.material_id) === String(material.material_id)
      );

      return {
        ...prev,
        [poId]: exists
          ? current.filter(
              (m) =>
                String(m.material_id) !== String(material.material_id)
            )
          : [
              ...current,
              {
                material_id: material.material_id,
                qty: material.qty || "",
              },
            ],
      };
    });
  };

  // ============================================================
  // HANDLE MATERIAL QTY CHANGE
  // ============================================================
  const handleMaterialQtyChange = (poId, materialId, qty) => {
    setSelectedMaterials((prev) => ({
      ...prev,
      [poId]: (prev[poId] || []).map((m) =>
        String(m.material_id) === String(materialId)
          ? { ...m, qty }
          : m
      ),
    }));
  };

  // ============================================================
  // REST OF THE COMPONENT (unchanged)
  // ============================================================
  useEffect(() => {
    if (!prefillSoId) return;
    setForm((prev) => ({ ...emptyForm, entry_type: "sales", so_id: prefillSoId }));
    setPoGroup(null);
    const group = salesOrderGroups.rows.find(
      (g) => Array.isArray(g.items) && g.items.some((i) => String(i.id) === String(prefillSoId))
    );
    setSoGroup(group || null);
    if (onPrefillConsumed) onPrefillConsumed();
  }, [prefillSoId]);

  useEffect(() => {
    if (!form.so_id || soGroup || form.entry_type !== "sales") return;
    const group = salesOrderGroups.rows.find(
      (g) => Array.isArray(g.items) && g.items.some((i) => String(i.id) === String(form.so_id))
    );
    if (group) setSoGroup(group);
  }, [salesOrderGroups.rows]);

  const isOther = form.entry_type === "other";
  const isSales = form.entry_type === "sales";

  const load = (status = statusFilter, entryType = entryTypeFilter) => {
    setLoading(true);
    getGateEntriesApi(status || undefined, entryType || undefined)
      .then((res) => setEntries(res.data.data ?? res.data))
      .catch(() => setError("Failed to load gate entries"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const handleStatusFilterChange = (status) => {
    setStatusFilter(status);
    load(status, entryTypeFilter);
  };

  const handleEntryTypeFilterChange = (entryType) => {
    setEntryTypeFilter(entryType);
    load(statusFilter, entryType);
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const setField = (name) => (id) => setForm({ ...form, [name]: id });

  const handleSoChange = (so_id) => {
    const so = salesOrderGroups.rows.find((r) => String(r.id) === String(so_id));
    setSoGroup(so || null);
    const items = so && Array.isArray(so.items) ? so.items : [];
    const openItem = items.find((i) => !["dispatched", "closed", "cancelled"].includes(i.so_status)) || items[0];
    setForm((prev) => ({
      ...prev,
      so_id: openItem ? openItem.id : "",
      material_id: openItem ? openItem.material_id : "",
    }));
    salesOrders.refetch();
  };

  const handleEntryTypeChange = (e) => {
  const entry_type = e.target.value;
  setForm((prev) => ({
    ...emptyForm,
    entry_type,
    vehicle_id: prev.vehicle_id,
    driver_id: prev.driver_id,
    driver_photo_url: prev.driver_photo_url,
  }));
  setPoGroup(null);
  setSoGroup(null);
  setSelectedPOs([]);
  setSelectedMaterials({});
  setSelectedSOs([]); // Add this
  setSelectedSalesMaterials({}); // Add this
};

  const handlePhotoCaptured = async (dataUrl) => {
    setShowCamera(false);
    setPhotoPreview(dataUrl);
    setPhotoUploadError("");
    setForm((prev) => ({ ...prev, driver_photo_url: "" }));
    setUploadingPhoto(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const res = await uploadGatePhotoApi(blob);
      const url = res.data.data?.url ?? res.data.url;
      if (!url) throw new Error("Upload didn't return a URL");
      setForm((prev) => ({ ...prev, driver_photo_url: url }));
    } catch (err) {
      setPhotoUploadError(
        err.response?.data?.msg ||
          err.response?.data?.message ||
          err.message ||
          "Photo upload failed — try Retake, or Clear and continue without a photo."
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleClearPhoto = () => {
    setPhotoPreview("");
    setPhotoUploadError("");
    setForm((prev) => ({ ...prev, driver_photo_url: "" }));
  };

 const handleGenerateToken = async (e) => {
  e.preventDefault();
  setError("");
  setInfo("");
  setLastToken("");
  setLastVendor("");
  
  if (uploadingPhoto) {
    setError("The driver photo is still uploading — wait a moment and try again.");
    return;
  }

  // ... existing validation for purchase and other entry types ...

  try {
    const payload = {
      entry_type: form.entry_type,
      vehicle_id: Number(form.vehicle_id),
      driver_id: Number(form.driver_id),
      driver_photo_url: form.driver_photo_url,
    };

    if (form.entry_type === "purchase") {
      // ... existing purchase logic ...
    } else if (form.entry_type === "sales") {
      if (selectedSOs.length === 0) {
        setError("Please select at least one Sales Order.");
        return;
      }

      // Check if all SOs have at least one material selected
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
        (so) => so.materials.length === 0 || so.materials.some(m => !m.material_id)
      );

      if (invalidSO) {
        setError(
          `Please ensure all materials have valid IDs for SO ${invalidSO.so_id}.`
        );
        return;
      }

      payload.customer_id = Number(form.customer_id);
      payload.sales_orders = sales_orders;
      payload.challan_no = form.challan_no;
      payload.expected_qty = form.expected_qty ? Number(form.expected_qty) : undefined;
    } else {
      // ... existing other logic ...
    }

    const res = await generateGateTokenApi(payload);
    const generatedEntry = res.data.data;
    const tokenNo = res.data.token_no ?? generatedEntry?.token_no;
    const customerName = generatedEntry?.customer?.name || selectedSOs[0]?.customer?.name || "";
    
    setLastToken(tokenNo || "");
    setLastVendor(customerName);
    setInfo(
      tokenNo
        ? "Token generated — give this number to the driver."
        : "Entry saved (check the list below for the token number)."
    );
    
    // Reset form
    setForm(emptyForm);
    setSelectedPOs([]);
    setSelectedMaterials({});
    setSelectedSOs([]);
    setSelectedSalesMaterials({});
    setPoGroup(null);
    setSoGroup(null);
    setPhotoPreview("");
    setPhotoUploadError("");
    load();
  } catch (err) {
    setError(err.response?.data?.msg || err.response?.data?.message || "Failed to generate token");
  }
};
  const handleCheckin = async (id) => {
    setError("");
    try {
      await gateCheckinApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Check-in failed");
    }
  };

  const handleCheckout = async (id) => {
    setError("");
    try {
      await gateCheckoutApi(id);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Check-out failed");
    }
  };

  const handleSendToWarehouse = async (id) => {
    setError("");
    setInfo("");
    try {
      await gateSendToWarehouseApi(id);
      setInfo("Truck sent to warehouse.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Failed to send to warehouse");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Gate Entry</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-success">
          {info}
          {lastToken && (
            <div style={{ marginTop: 8 }}>
              <span className="token-chip token-chip-lg">{lastToken}</span>
            </div>
          )}
          {lastVendor && (
            <div style={{ marginTop: 8 }}>
              <strong>Vendor:</strong> {lastVendor}
            </div>
          )}
        </div>
      )}

      <h3 style={{ marginBottom: 4 }}>Generate Token</h3>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Fill this in when a truck arrives at the gate. Choose "Empty / Miscellaneous" for
        trucks with no vendor delivery — those skip Sampling and Lab and go straight to
        Weighbridge (if needed) and Warehouse instead. Choose "Sales (Outbound Loading)" for
        an empty truck that's here to be loaded and dispatched against a Sales Order.
      </p>
      
      <form className="sf-form" onSubmit={handleGenerateToken}>
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

        <div>
          <EntitySelect
            entity="vehicle"
            label="Vehicle"
            value={form.vehicle_id}
            onChange={setField("vehicle_id")}
            required
            creatable
          />
          <p className="field-hint">The truck's number plate.</p>
        </div>

        <div>
          <EntitySelect
            entity="driver"
            label="Driver"
            value={form.driver_id}
            onChange={setField("driver_id")}
            required
            creatable
          />
          <p className="field-hint">Who's driving the truck today.</p>
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
                <p className="field-hint" style={{ color: "#2563eb" }}>
                  Loading PO details...
                </p>
              )}
              <p className="field-hint">
                You can select multiple Purchase Orders. After selecting a PO,
                choose one or more materials from that PO.
              </p>
            </div>

            {selectedPOs.length > 0 && (
              <div className="multi-po-container">
                {selectedPOs.map((po) => {
                  const materials = Array.isArray(po.items) ? po.items : [];
                  
                  // If materials is empty, show a message
                  if (materials.length === 0) {
                    return (
                      <div key={po.id} className="po-selection-card">
                        <div className="po-selection-header">
                          <div>
                            <strong>PO #{po.po_no || po.id}</strong>
                            <div className="field-hint">
                              Vendor: {po.vendor?.name || "—"}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="dt-btn dt-btn-danger"
                            onClick={() => handleRemovePurchaseOrder(po.id)}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="po-material-list">
                          <div className="field-hint" style={{ padding: "8px", color: "#dc2626" }}>
                            No materials found for this PO. Please check the PO details.
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const selected = selectedMaterials[po.id] || [];

                  return (
                    <div key={po.id} className="po-selection-card">
                      <div className="po-selection-header">
                        <div>
                          <strong>PO #{po.po_no || po.id}</strong>
                          <div className="field-hint">
                            Vendor: {po.vendor?.name || "—"}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="dt-btn dt-btn-danger"
                          onClick={() => handleRemovePurchaseOrder(po.id)}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="po-material-list">
                        <div className="po-material-title">Select Materials</div>

                        {materials.map((material) => {
                          const isSelected = selected.some(
                            (m) =>
                              String(m.material_id) === String(material.material_id)
                          );

                          const selectedMaterial = selected.find(
                            (m) =>
                              String(m.material_id) === String(material.material_id)
                          );

                          return (
                            <div
                              key={material.material_id}
                              className={`po-material-row ${
                                isSelected ? "selected" : ""
                              }`}
                            >
                              <label className="material-checkbox">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    handleToggleMaterial(po.id, material)
                                  }
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
                                    handleMaterialQtyChange(
                                      po.id,
                                      material.material_id,
                                      e.target.value
                                    )
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="sf-field">
              <label>Challan No.</label>
              <input
                name="challan_no"
                value={form.challan_no}
                onChange={handleChange}
                required
              />
              <p className="field-hint">
                The delivery-note number the driver brought with them.
              </p>
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
              <p className="field-hint">
                Total quantity expected on this truck.
              </p>
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
        <p className="field-hint" style={{ color: "#2563eb" }}>
          Loading SO details...
        </p>
      )}
      <p className="field-hint">
        You can select multiple Sales Orders. After selecting an SO,
        choose one or more materials from that SO to be loaded.
      </p>
    </div>

    {selectedSOs.length > 0 && (
      <div className="multi-po-container">
        {selectedSOs.map((so) => {
          const materials = Array.isArray(so.items) ? so.items : [];
          
          // If materials is empty, show a message
          if (materials.length === 0) {
            return (
              <div key={so.id} className="po-selection-card">
                <div className="po-selection-header">
                  <div>
                    <strong>SO #{so.so_no || so.id}</strong>
                    <div className="field-hint">
                      Customer: {so.customer?.name || "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dt-btn dt-btn-danger"
                    onClick={() => handleRemoveSalesOrder(so.id)}
                  >
                    Remove
                  </button>
                </div>
                <div className="po-material-list">
                  <div className="field-hint" style={{ padding: "8px", color: "#dc2626" }}>
                    No materials found for this SO. Please check the SO details.
                  </div>
                </div>
              </div>
            );
          }

          const selected = selectedSalesMaterials[so.id] || [];

          return (
            <div key={so.id} className="po-selection-card">
              <div className="po-selection-header">
                <div>
                  <strong>SO #{so.so_no || so.id}</strong>
                  <div className="field-hint">
                    Customer: {so.customer?.name || "—"}
                  </div>
                </div>
                <button
                  type="button"
                  className="dt-btn dt-btn-danger"
                  onClick={() => handleRemoveSalesOrder(so.id)}
                >
                  Remove
                </button>
              </div>

              <div className="po-material-list">
                <div className="po-material-title">Select Materials</div>

                {materials.map((material) => {
                  const isSelected = selected.some(
                    (m) =>
                      String(m.material_id) === String(material.material_id)
                  );

                  const selectedMaterial = selected.find(
                    (m) =>
                      String(m.material_id) === String(material.material_id)
                  );

                  // Calculate remaining quantity
                  const orderedQty = Number(material.qty || 0);
                  const dispatchedQty = Number(material.dispatched_qty || 0);
                  const remainingQty = orderedQty - dispatchedQty;

                  return (
                    <div
                      key={material.material_id}
                      className={`po-material-row ${
                        isSelected ? "selected" : ""
                      }`}
                    >
                      <label className="material-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            handleToggleSalesMaterial(so.id, material)
                          }
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
                            Ordered: {material.qty} @ ₹{material.rate} | 
                            Remaining: {remainingQty}
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
                            handleSalesMaterialQtyChange(
                              so.id,
                              material.material_id,
                              e.target.value
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}

    <div className="sf-field">
      <label>Challan No. (if any)</label>
      <input
        name="challan_no"
        value={form.challan_no}
        onChange={handleChange}
      />
      <p className="field-hint">Optional — the delivery-note number for this dispatch, if any.</p>
    </div>
    <div className="sf-field">
      <label>Planned Loading Qty (Tons) (optional)</label>
      <input
        name="expected_qty"
        type="number"
        value={form.expected_qty}
        onChange={handleChange}
      />
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
              <label>Challan No. (if any)</label>
              <input
                name="challan_no"
                value={form.challan_no}
                onChange={handleChange}
              />
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

        <div className="sf-field">
          <label>Driver Photo</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {photoPreview ? (
              <img
                src={photoPreview}
                alt="Driver"
                style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", border: "1px solid #cbd5e1" }}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  background: "#f8fafc",
                  border: "1px dashed #cbd5e1",
                }}
              />
            )}
            <button
              type="button"
              className="dt-btn"
              style={{ cursor: "pointer", margin: 0 }}
              onClick={() => setShowCamera(true)}
            >
              📷 {photoPreview ? "Retake" : "Take Photo"}
            </button>
            {photoPreview && (
              <button type="button" className="dt-btn dt-btn-danger" onClick={handleClearPhoto}>
                Clear
              </button>
            )}
          </div>
          {uploadingPhoto && <p className="field-hint">Uploading photo…</p>}
          {photoUploadError && (
            <p className="field-hint" style={{ color: "#dc2626" }}>{photoUploadError}</p>
          )}
          <p className="field-hint">Optional — a quick photo of the driver for the record.</p>
        </div>

        <button className="sf-submit" type="submit" disabled={uploadingPhoto || fetchingPODetails}>
          {uploadingPhoto ? "Uploading photo…" : fetchingPODetails ? "Loading PO details…" : "Generate Token"}
        </button>
      </form>

      {showCamera && (
        <CameraCapture
          onCapture={handlePhotoCaptured}
          onClose={() => setShowCamera(false)}
        />
      )}

      <h3>Entries</h3>
      <div className="section-tabs">
        {ENTRY_TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`section-tab ${entryTypeFilter === f.key ? "active" : ""}`}
            onClick={() => handleEntryTypeFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
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
                {row.entry_type === "other"
                  ? "Empty / Misc"
                  : row.entry_type === "sales"
                  ? "Sales (Outbound)"
                  : "Purchase"}
              </span>
            ),
          },
          { key: "challan_no", label: "Challan No." },
          {
            key: "vehicle_id",
            label: "Vehicle No.",
            render: (row) => row.vehicle?.vehicle_no || vehicles.getLabel(row.vehicle_id),
          },
          {
            key: "vendor_id",
            label: "Vendor Name",
            render: (row) => row.vendor?.name || "—",
          },
          {
            key: "driver_id",
            label: "Driver Name",
            render: (row) => drivers.getLabel(row.driver_id),
          },
          {
            key: "sales_order",
            label: "Sales Order",
            render: (row) => (row.entry_type === "sales" ? salesOrders.getLabel(row.so_id) : "—"),
          },
          {
            key: "gate_status",
            label: "Status",
            render: (row) => <span className="dt-badge">{row.gate_status}</span>,
          },
          {
            key: "actions2",
            label: "Gate Actions",
            render: (row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {row.gate_status === "waiting_token" && (
                  <button className="dt-btn" onClick={() => handleCheckin(row.id)}>
                    Check-in
                  </button>
                )}
                {row.entry_type === "other" &&
                  ["waiting_weighment", "in_process"].includes(row.gate_status) && (
                    <button className="dt-btn" onClick={() => handleSendToWarehouse(row.id)}>
                      Send to Warehouse
                    </button>
                  )}
                {row.entry_type === "sales" && row.gate_status === "waiting_loading" && (
                  <span className="field-hint" style={{ margin: 0 }}>
                    → Go to the Loading tab to load this truck
                  </span>
                )}
                {row.entry_type === "sales"
                  ? row.gate_status === "loaded" && (
                      <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                        Check-out
                      </button>
                    )
                  : row.gate_status !== "waiting_token" &&
                    row.gate_status !== "exited" && (
                      <button className="dt-btn" onClick={() => handleCheckout(row.id)}>
                        Check-out
                      </button>
                    )}
              </div>
            ),
          },
        ]}
      />
      
      <ModuleGuide
        title="Gate Entry"
        steps={[
          "Fill in the Generate Token form when a truck arrives — pick the Entry Type first. 'Purchase' is a vendor delivery (vehicle, driver, vendor, material and PO). 'Empty / Miscellaneous' is for empty trucks or non-purchase loads. 'Sales (Outbound Loading)' is an empty truck here to collect goods against a Sales Order.",
          "Submitting prints a token number for the driver, and the entry starts at status 'waiting_token'.",
          "Check-in when the truck actually enters the yard. Purchase trucks move into the sampling queue; Empty/Misc trucks move into the weighment queue; Sales trucks move into the loading queue ('waiting_loading') — each skips the stages that don't apply to it.",
          "Purchase trucks flow forward automatically from there: Quality samples and tests it, Weighbridge weighs it, then Warehouse unloads it into a Lot.",
          "Empty/Misc trucks can be weighed on the Weighbridge page if needed, then use 'Send to Warehouse' here (or on the Warehouse page) to close them out — no Lot is created since there's usually no stock to track.",
          "Sales trucks head to the Loading tab once checked in: enter the loaded quantity there, which moves the gate entry to 'loaded' and the Sales Order to 'dispatched'. Only then can the truck check out here.",
          "Use the tabs above the list to filter by truck type or by status at any stage of the journey.",
        ]}
      />
    </div>
  );
}