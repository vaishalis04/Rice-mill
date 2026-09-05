import { useState, useEffect, useMemo } from "react";
import {
  getWeightSlipsApi,
  createWeightSlipApi,
  updateWeightSlipApi,
  deleteWeightSlipApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  gate_entry_id: "",
  slip_no: "",
  gross_weight: "",
  tare_weight: "",
  weighed_at: "",
  final_rate: "",
};

const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function WeighbridgePage() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingFirstSlip, setExistingFirstSlip] = useState(null);

  // Entity lookups
  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");

  // Helper functions
  const getGateEntryRow = (gate_entry_id) => {
    if (!gate_entry_id) return null;
    return gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id)) || null;
  };

  const selectedGateEntry = getGateEntryRow(form.gate_entry_id);
  const isOtherEntry = selectedGateEntry?.entry_type === "other";
  const isSecondWeight = selectedGateEntry?.gate_status === "waiting_second_weighment";
  const isFirstWeight = selectedGateEntry?.gate_status === "waiting_weighment" || 
                        selectedGateEntry?.gate_status === "accepted";

  // Load data
  const load = () => {
    setLoading(true);
    getWeightSlipsApi()
      .then((res) => {
        const data = res.data.data || res.data || [];
        setSlips(Array.isArray(data) ? data : []);
      })
      .catch(() => setError("Failed to load weight slips"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Calculate live net weight
  const liveNetWeight = useMemo(() => {
    if (form.gross_weight === "" || form.tare_weight === "") return null;
    const g = parseFloat(form.gross_weight);
    const t = parseFloat(form.tare_weight);
    if (isNaN(g) || isNaN(t)) return null;
    return g - t;
  }, [form.gross_weight, form.tare_weight]);

  // Load existing slip data when gate entry changes
  const loadExistingSlip = async (gateEntryId) => {
    if (!gateEntryId) return;
    
    try {
      // Find existing weight slips for this gate entry
      const existingSlips = slips.filter(
        (s) => String(s.gate_entry_id) === String(gateEntryId)
      );
      
      if (existingSlips.length > 0) {
        // Get the first slip (should be the first weight)
        const firstSlip = existingSlips[0];
        setExistingFirstSlip(firstSlip);
        
        // Auto-fill the form with existing data
        setForm((prev) => ({
          ...prev,
          slip_no: firstSlip.slip_no || prev.slip_no,
          // For second weight, gross_weight should be empty for user to enter
          gross_weight: "", // Clear for user to enter second weight
          // Auto-fill tare with first weight
          tare_weight: firstSlip.gross_weight?.toString() || "",
          weighed_at: firstSlip.weighed_at ? toLocal(firstSlip.weighed_at) : prev.weighed_at,
        }));
        
        return firstSlip;
      } else {
        setExistingFirstSlip(null);
        // If no existing slip, clear the form except gate_entry_id
        setForm((prev) => ({
          ...prev,
          slip_no: "",
          gross_weight: "",
          tare_weight: "",
          weighed_at: "",
        }));
      }
    } catch (err) {
      console.error("Error loading existing slip:", err);
    }
    return null;
  };

  // Handle gate entry selection change
  const handleGateEntryChange = async (id) => {
    setError("");
    setInfo("");
    
    // Reset form but keep gate_entry_id
    setForm({ 
      ...emptyForm, 
      gate_entry_id: id 
    });
    setExistingFirstSlip(null);
    
    if (id) {
      // Load existing slip data
      await loadExistingSlip(id);
    }
  };

  // Auto-fill tare weight from previous weighing for first weight
  useEffect(() => {
    if (editingId || !form.gate_entry_id) return;
    const ge = getGateEntryRow(form.gate_entry_id);
    if (!ge || !ge.vehicle_id) return;

    // Only auto-fill for first weight, not for second weight
    if (isSecondWeight) return;

    // Don't auto-fill if tare already has a value
    if (form.tare_weight && form.tare_weight !== "") return;

    const priorForVehicle = slips
      .filter((s) => {
        const otherGe = getGateEntryRow(s.gate_entry_id);
        return otherGe && String(otherGe.vehicle_id) === String(ge.vehicle_id);
      })
      .sort(
        (a, b) =>
          new Date(b.weighed_at || b.created_at) - new Date(a.weighed_at || a.created_at)
      );

    if (priorForVehicle[0] && priorForVehicle[0].tare_weight) {
      setForm((prev) => ({
        ...prev,
        tare_weight: String(priorForVehicle[0].tare_weight)
      }));
    }
  }, [form.gate_entry_id, slips, isSecondWeight, editingId]);

  // Filter visible slips
  const visibleSlips = useMemo(() => {
    if (!Array.isArray(slips)) return [];
    if (tab === "pending") {
      // Pending = first weight only (no tare)
      return slips.filter((s) => s.tare_weight == null || s.tare_weight === "");
    }
    if (tab === "generated") {
      // Generated = both weights (has tare)
      return slips.filter((s) => s.tare_weight != null && s.tare_weight !== "");
    }
    return slips;
  }, [tab, slips]);

  // Handle form changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setIsSubmitting(true);

    try {
      // Update existing slip
      if (editingId) {
        await updateWeightSlipApi(editingId, {
          gross_weight: parseFloat(form.gross_weight),
          tare_weight: parseFloat(form.tare_weight),
          weighed_at: form.weighed_at ? toIso(form.weighed_at) : undefined,
        });
        setInfo("Weight slip updated successfully.");
        setForm(emptyForm);
        setEditingId(null);
        setExistingFirstSlip(null);
        load();
        gateEntries.refetch();
        setIsSubmitting(false);
        return;
      }

      // Validate required fields
      if (!form.gate_entry_id) {
        setError("Please select a gate entry");
        setIsSubmitting(false);
        return;
      }

      if (!form.slip_no) {
        setError("Please enter a slip number");
        setIsSubmitting(false);
        return;
      }

      const grossVal = parseFloat(form.gross_weight);
      if (!form.gross_weight || isNaN(grossVal) || grossVal <= 0) {
        setError("Please enter a valid gross weight");
        setIsSubmitting(false);
        return;
      }

      // Build payload
      const payload = {
        gate_entry_id: parseInt(form.gate_entry_id),
        slip_no: form.slip_no,
        gross_weight: grossVal,
      };

      // Determine if this is first or second weight
      const ge = getGateEntryRow(form.gate_entry_id);
      const isSecondWeightSubmit = ge?.gate_status === "waiting_second_weighment";

      if (isSecondWeightSubmit) {
        // SECOND WEIGHT - tare_weight is required (auto-filled from first weight)
        const tareVal = parseFloat(form.tare_weight);
        if (form.tare_weight === "" || isNaN(tareVal)) {
          setError("First weight (tare) is missing. Please reload the gate entry.");
          setIsSubmitting(false);
          return;
        }
        payload.tare_weight = tareVal;
        
        // Validate second weight > first weight
        if (existingFirstSlip) {
          // const firstWeight = parseFloat(existingFirstSlip.gross_weight);
          // if (grossVal <= firstWeight) {
          //   setError(`Second weight must be greater than first weight (${firstWeight.toFixed(2)})`);
          //   setIsSubmitting(false);
          //   return;
          // }
        }
      } else if (form.tare_weight !== "" && form.tare_weight != null) {
        // BULK CREATE - both weights provided at once
        const tareVal = parseFloat(form.tare_weight);
        if (isNaN(tareVal)) {
          setError("Invalid tare weight");
          setIsSubmitting(false);
          return;
        }
        payload.tare_weight = tareVal;
        
        // Validate net weight is positive
        const netWeight = grossVal - tareVal;
        if (netWeight <= 0) {
          setError("Net weight must be positive. Gross weight must be greater than tare weight");
          setIsSubmitting(false);
          return;
        }
      }
      // If tare_weight is empty, it's first weight only

      // Optional fields
      if (form.weighed_at) {
        payload.weighed_at = toIso(form.weighed_at);
      }

      // Final rate for purchase entries (only for first weight or bulk)
      if (!isOtherEntry && !isSecondWeightSubmit && form.final_rate !== "") {
        const rateVal = parseFloat(form.final_rate);
        if (!isNaN(rateVal)) {
          payload.final_rate = rateVal;
        }
      }

      // Make API call
      const response = await createWeightSlipApi(payload);
      
      // Show appropriate message based on response
      if (response.data?.data?.isFirstWeight) {
        setInfo(
          "✅ First weight recorded! Gate entry moved to waiting_second_weighment. Enter second weight when ready."
        );
      } else if (response.data?.data?.isSecondWeight) {
        setInfo(
          isOtherEntry
            ? "✅ Second weight recorded! Gate entry moved to Parked."
            : "✅ Second weight recorded! Purchase finalized and gate entry moved to Parked."
        );
      } else {
        // Bulk create
        setInfo(
          isOtherEntry
            ? "✅ Weight slip created! Net weight computed, gate entry moved to Parked."
            : "✅ Weight slip created! Net weight computed, purchase finalized, gate entry moved to Parked."
        );
      }
      
      // Reset form and refresh data
      setForm(emptyForm);
      setEditingId(null);
      setExistingFirstSlip(null);
      load();
      gateEntries.refetch();
      
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || "Save failed";
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle edit
  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      gate_entry_id: row.gate_entry_id || "",
      slip_no: row.slip_no || "",
      gross_weight: row.gross_weight ?? "",
      tare_weight: row.tare_weight ?? "",
      weighed_at: toLocal(row.weighed_at),
      final_rate: row.final_rate ?? "",
    });
  };

  // Handle cancel edit
  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setExistingFirstSlip(null);
    setError("");
    setInfo("");
  };

  // Handle delete
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this weight slip?")) return;
    try {
      await deleteWeightSlipApi(id);
      setInfo("Weight slip deleted successfully");
      setExistingFirstSlip(null);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  // Get status badge color
  const getStatusBadge = (status) => {
    const colors = {
      'waiting_weighment': '#f59e0b',
      'waiting_second_weighment': '#3b82f6',
      'Parked': '#10b981',
      'accepted': '#8b5cf6',
      'in_process': '#6b7280',
    };
    return colors[status] || '#6b7280';
  };

  // Get status label
  const getStatusLabel = (status) => {
    const labels = {
      'waiting_weighment': 'Awaiting First Weigh',
      'waiting_second_weighment': 'Awaiting Second Weigh',
      'Parked': 'Parked',
      'accepted': 'Accepted',
      'in_process': 'In Process',
    };
    return labels[status] || status;
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0 }}>⚖️ Weighbridge</h2>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          Total Slips: {Array.isArray(slips) ? slips.length : 0}
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '16px',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '4px',
          border: '1px solid #fecaca'
        }}>
          ❌ {error}
        </div>
      )}
      
      {info && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '16px',
          backgroundColor: '#d1fae5',
          color: '#065f46',
          borderRadius: '4px',
          border: '1px solid #a7f3d0'
        }}>
          {info}
        </div>
      )}

      {/* Form */}
      <form className="sf-form" onSubmit={handleSubmit} style={{
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: '24px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
          {/* Gate Entry Selection */}
          <div className="sf-field">
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Gate Entry <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <EntitySelect
              entity="gate_entry"
              label=""
              value={form.gate_entry_id}
              onChange={handleGateEntryChange}
              filter={(row) =>
                row.gate_status === "accepted" ||
                row.gate_status === "waiting_weighment" ||
                row.gate_status === "waiting_second_weighment"
              }
              required={!editingId}
              disabled={!!editingId}
              placeholder="Select a gate entry..."
            />
            {selectedGateEntry && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                Status: <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: getStatusBadge(selectedGateEntry.gate_status) + '20',
                  color: getStatusBadge(selectedGateEntry.gate_status)
                }}>
                  {getStatusLabel(selectedGateEntry.gate_status)}
                </span>
                {selectedGateEntry.entry_type && (
                  <span style={{ marginLeft: '8px' }}>
                    Type: {selectedGateEntry.entry_type.toUpperCase()}
                  </span>
                )}
                {isSecondWeight && existingFirstSlip && (
                  <span style={{ marginLeft: '8px', color: '#3b82f6' }}>
                    First Weight: {parseFloat(existingFirstSlip.gross_weight).toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Slip Number - Disabled for second weight */}
          <div className="sf-field">
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Slip No. <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              name="slip_no"
              value={form.slip_no}
              onChange={handleChange}
              disabled={!!editingId || isSecondWeight}
              required={!editingId}
              placeholder={isSecondWeight ? "Auto-filled from first weight" : "Enter slip number"}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: isSecondWeight ? '#f3f4f6' : 'white'
              }}
            />
            {isSecondWeight && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                🔒 Slip number from first weight
              </div>
            )}
          </div>

          {/* Gross Weight - Enabled for second weight (user enters second weight) */}
          <div className="sf-field">
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              {isSecondWeight ? "Second Weight (Gross)" : "First Weight (Gross)"}
              <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              name="gross_weight"
              type="number"
              step="0.01"
              value={form.gross_weight}
              onChange={handleChange}
              required
              placeholder={isSecondWeight ? "Enter second weight" : "Enter first weight"}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: 'white'
              }}
            />
            {isSecondWeight && existingFirstSlip && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#3b82f6' }}>
                💡 Must be greater than {parseFloat(existingFirstSlip.gross_weight).toFixed(2)}
              </div>
            )}
            {!isSecondWeight && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                💡 Enter the gross weight (truck + load)
              </div>
            )}
          </div>

          {/* Tare Weight - Disabled for second weight (auto-filled) */}
          <div className="sf-field">
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              {isSecondWeight ? "First Weight (Tare)" : "Second Weight (Optional)"}
              {isSecondWeight && <span style={{ color: '#dc2626' }}>*</span>}
            </label>
            <input
              name="tare_weight"
              type="number"
              step="0.01"
              value={form.tare_weight}
              onChange={handleChange}
              required={isSecondWeight}
              placeholder={isSecondWeight ? "Auto-filled from first weight" : "Optional - enter both weights"}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                backgroundColor: isSecondWeight ? '#f3f4f6' : 'white'
              }}
              disabled={isSecondWeight}
            />
            {isSecondWeight && existingFirstSlip && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                🔒 Auto-filled: {parseFloat(existingFirstSlip.gross_weight).toFixed(2)}
              </div>
            )}
            {!editingId && form.gate_entry_id && form.tare_weight !== "" && !isSecondWeight && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                🔄 Auto-filled from this vehicle's last weighing
              </div>
            )}
          </div>

          {/* Net Weight (auto-calculated) */}
          <div className="sf-field">
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              Net Weight
            </label>
            <input
              type="text"
              value={liveNetWeight === null ? "" : liveNetWeight.toFixed(2)}
              disabled
              placeholder="Enter weights above"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 700,
                color: liveNetWeight !== null && liveNetWeight <= 0 ? '#dc2626' : '#1d4ed8',
                background: '#f8fafc',
              }}
            />
            {/* {liveNetWeight !== null && liveNetWeight <= 0 && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#dc2626' }}>
                ⚠️ Second weight must be greater than first weight
              </div>
            )} */}
            {liveNetWeight !== null && liveNetWeight > 0 && (
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#059669' }}>
                ✅ Net weight: {liveNetWeight.toFixed(2)}
              </div>
            )}
          </div>

          {/* Weighed At */}
          {!editingId && (
            <div className="sf-field">
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Weighed At
              </label>
              <input
                name="weighed_at"
                type="datetime-local"
                value={form.weighed_at}
                onChange={handleChange}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
            </div>
          )}

          {/* Final Rate */}
          {!editingId && !isOtherEntry && !isSecondWeight && (
            <div className="sf-field">
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Final Rate
              </label>
              <input
                name="final_rate"
                type="number"
                step="0.01"
                value={form.final_rate}
                onChange={handleChange}
                placeholder="Required if no PO linked"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
              <div style={{ fontSize: '12px', marginTop: '4px', color: '#6b7280' }}>
                💡 Rate per unit weight
              </div>
            </div>
          )}
        </div>

        {/* Status Info */}
        {selectedGateEntry && !editingId && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#f3f4f6',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            <strong>Current Status:</strong> {getStatusLabel(selectedGateEntry.gate_status)}
            {isSecondWeight && (
              <span style={{ marginLeft: '12px', color: '#3b82f6' }}>
                → Completing second weight will move to PARKED
              </span>
            )}
            {isFirstWeight && (
              <span style={{ marginLeft: '12px', color: '#f59e0b' }}>
                → Recording first weight will move to WAITING_SECOND_WEIGHMENT
              </span>
            )}
            {isOtherEntry && (
              <span style={{ marginLeft: '12px', color: '#8b5cf6' }}>
                → Empty/Misc entry - no purchase will be created
              </span>
            )}
            {isSecondWeight && existingFirstSlip && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#374151' }}>
                <strong>First Weight Details:</strong> Slip #{existingFirstSlip.slip_no} | 
                Gross: {parseFloat(existingFirstSlip.gross_weight).toFixed(2)}
              </div>
            )}
          </div>
        )}

        {/* Form Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            className="sf-submit"
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: '8px 24px',
              backgroundColor: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1
            }}
          >
            {isSubmitting ? 'Saving...' : editingId ? 'Update Weight Slip' : 
             isSecondWeight ? 'Complete Second Weight' :
             form.tare_weight === "" || form.tare_weight == null ? 'Record First Weight' :
             'Generate Weight Slip'}
          </button>
          {editingId && (
            <button
              type="button"
              className="sf-cancel"
              onClick={handleCancel}
              style={{
                padding: '8px 24px',
                backgroundColor: '#6b7280',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={tab === "pending" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("pending")}
          style={{
            padding: '8px 16px',
            backgroundColor: tab === 'pending' ? '#1d4ed8' : 'transparent',
            color: tab === 'pending' ? '#fff' : '#374151',
            border: tab === 'pending' ? 'none' : '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          📋 Pending ({Array.isArray(slips) ? slips.filter(s => s.tare_weight == null || s.tare_weight === "").length : 0})
        </button>
        <button
          className={tab === "generated" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("generated")}
          style={{
            padding: '8px 16px',
            backgroundColor: tab === 'generated' ? '#1d4ed8' : 'transparent',
            color: tab === 'generated' ? '#fff' : '#374151',
            border: tab === 'generated' ? 'none' : '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          ✅ Completed ({Array.isArray(slips) ? slips.filter(s => s.tare_weight != null && s.tare_weight !== "").length : 0})
        </button>
        <button
          className={tab === "all" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("all")}
          style={{
            padding: '8px 16px',
            backgroundColor: tab === 'all' ? '#1d4ed8' : 'transparent',
            color: tab === 'all' ? '#fff' : '#374151',
            border: tab === 'all' ? 'none' : '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          All ({Array.isArray(slips) ? slips.length : 0})
        </button>
      </div>

      {/* Data Table */}
      <DataTable
        loading={loading}
        rows={visibleSlips}
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "slip_no", label: "Slip No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => {
              try {
                return gateEntries.getLabel(row.gate_entry_id) || "—";
              } catch (e) {
                return "—";
              }
            },
          },
          {
            key: "vehicle",
            label: "Vehicle No.",
            render: (row) => {
              try {
                const ge = getGateEntryRow(row.gate_entry_id);
                return ge ? vehicles.getLabel(ge.vehicle_id) || "—" : "—";
              } catch (e) {
                return "—";
              }
            },
          },
          {
            key: "driver",
            label: "Driver",
            render: (row) => {
              try {
                const ge = getGateEntryRow(row.gate_entry_id);
                return ge ? drivers.getLabel(ge.driver_id) || "—" : "—";
              } catch (e) {
                return "—";
              }
            },
          },
          {
            key: "gross_weight", 
            label: "First Wt.",
            render: (row) => {
              const val = parseFloat(row.gross_weight);
              return !isNaN(val) ? val.toFixed(2) : "—";
            }
          },
          {
            key: "tare_weight", 
            label: "Second Wt.",
            render: (row) => {
              if (row.tare_weight === null || row.tare_weight === undefined) return "—";
              const val = parseFloat(row.tare_weight);
              return !isNaN(val) ? val.toFixed(2) : "—";
            }
          },
          {
            key: "net_weight",
            label: "Net Wt.",
            render: (row) => {
              let net = row.net_weight;
              if (net === null || net === undefined) {
                const gross = parseFloat(row.gross_weight);
                const tare = parseFloat(row.tare_weight);
                if (!isNaN(gross) && !isNaN(tare)) {
                  net = gross - tare;
                } else {
                  return "—";
                }
              }
              const val = parseFloat(net);
              return !isNaN(val) ? (
                <strong style={{ color: '#1d4ed8' }}>{val.toFixed(2)}</strong>
              ) : "—";
            },
          },
          {
            key: "gate_status",
            label: "Status",
            render: (row) => {
              try {
                const ge = getGateEntryRow(row.gate_entry_id);
                if (!ge) return "—";
                const status = ge.gate_status;
                return (
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: getStatusBadge(status) + '20',
                    color: getStatusBadge(status)
                  }}>
                    {getStatusLabel(status)}
                  </span>
                );
              } catch (e) {
                return "—";
              }
            },
          },
          {
            key: "weighed_at",
            label: "Weighed At",
            render: (row) => {
              if (!row.weighed_at) return "—";
              try {
                return new Date(row.weighed_at).toLocaleString();
              } catch (e) {
                return "—";
              }
            },
          },
          {
            key: "final_rate",
            label: "Rate",
            render: (row) => {
              if (row.final_rate === null || row.final_rate === undefined) return "—";
              const val = parseFloat(row.final_rate);
              return !isNaN(val) ? `₹${val.toFixed(2)}` : "—";
            },
          },
        ]}
      />

      {/* Module Guide */}
      <ModuleGuide
        title="⚖️ Weighbridge Guide"
        steps={[
          "Step 1: Select a gate entry from the dropdown - only entries with status 'accepted', 'waiting_weighment', or 'waiting_second_weighment' are shown.",
          "Step 2: Enter the slip number and first weight (gross weight) from the weighbridge.",
          "Step 3: If you have both weights, enter the second weight (tare) as well. Otherwise, submit first weight only.",
          "Step 4: For first weight only, the gate entry moves to 'waiting_second_weighment'. Come back later to complete the second weight.",
          "Step 5: For second weight, enter the first weight as tare. The system calculates net weight and moves the gate entry to 'Parked'.",
          "Step 6: For purchase entries, the system automatically creates a Purchase record with the final rate and quantity.",
        ]}
        tips={[
          "💡 The tare weight auto-fills from the same vehicle's previous weighing to save time.",
          "💡 Net weight is calculated live as you type - no manual calculation needed.",
          "💡 Purchase entries require a rate (from PO or manual entry) to create the Purchase record.",
          "💡 Empty/Misc entries skip purchase creation and go directly to Parked.",
          "💡 You can edit a weight slip to correct weights, but purchase records may need manual adjustment.",
        ]}
      />
    </div>
  );
}