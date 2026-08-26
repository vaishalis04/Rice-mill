import { useState, useEffect } from "react";
import {
  getLabTestsApi,
  createLabTestApi,
  updateLabTestApi,
  updateLabTestVerdictApi,
  deleteLabTestApi,
  getMasterSettingsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  sampling_id: "",
  material_ids: [],
  moisture_pct: "",
  broken_pct: "",
  fm_pct: "",
  color: "",
  smell: "",
  variety_detected: "",
  grain_size: "long",
  comment: "",
  verdict: "accepted",
  tested_at: "",
};

const VERDICT_FILTERS = [
  { key: "", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "negotiation", label: "Negotiation" },
];

// datetime-local inputs need "YYYY-MM-DDTHH:mm"; API wants full ISO.
const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function LabTestPage() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verdictFilter, setVerdictFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [availableMaterials, setAvailableMaterials] = useState([]);
  const [allMaterials, setAllMaterials] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const samplings = useEntityLookup("sampling");

  // Fetch all materials from master-settings
  useEffect(() => {
    getMasterSettingsApi('material')
      .then((res) => {
        const materials = res.data.data ?? res.data;
        const materialsMap = {};
        materials.forEach(material => {
          materialsMap[material.id] = material.name;
        });
        setAllMaterials(materialsMap);
      })
      .catch((err) => {
        console.error('Failed to load materials:', err);
        setError("Failed to load material names");
      });
  }, []);

  // When sampling changes, fetch its materials
  useEffect(() => {
    if (form.sampling_id) {
      const selectedSampling = samplings.rows.find(
        (row) => String(row.id) === String(form.sampling_id)
      );
      
      if (selectedSampling) {
        // Get materials from the sampling
        const samplingMaterialIds = Array.isArray(selectedSampling.material_id) 
          ? selectedSampling.material_id 
          : (selectedSampling.material_id ? [selectedSampling.material_id] : []);
        
        const materials = samplingMaterialIds.map(id => ({
          id: id,
          name: allMaterials[id] || `Material ${id}`
        }));
        
        setAvailableMaterials(materials);
        
        // Auto-select all materials by default
        if (materials.length > 0) {
          setForm(prev => ({
            ...prev,
            material_ids: materials.map(m => m.id)
          }));
        }
      }
    } else {
      setAvailableMaterials([]);
      setForm(prev => ({
        ...prev,
        material_ids: []
      }));
    }
  }, [form.sampling_id, samplings.rows, allMaterials]);

  const load = (verdict = verdictFilter) => {
    setLoading(true);
    getLabTestsApi(verdict ? { verdict } : {})
      .then((res) => setTests(res.data.data ?? res.data))
      .catch(() => setError("Failed to load lab tests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (verdict) => {
    setVerdictFilter(verdict);
    load(verdict);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const handleMaterialToggle = (materialId) => {
    setForm(prev => {
      const currentIds = prev.material_ids || [];
      if (currentIds.includes(materialId)) {
        return {
          ...prev,
          material_ids: currentIds.filter(id => id !== materialId)
        };
      } else {
        return {
          ...prev,
          material_ids: [...currentIds, materialId]
        };
      }
    });
  };

  const handleSelectAll = () => {
    const allIds = availableMaterials.map(m => m.id);
    setForm(prev => ({
      ...prev,
      material_ids: allIds
    }));
  };

  const handleDeselectAll = () => {
    setForm(prev => ({
      ...prev,
      material_ids: []
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setIsSubmitting(true);

    try {
      // Validate material selection
      if (!form.material_ids || form.material_ids.length === 0) {
        setError("Please select at least one material for testing");
        setIsSubmitting(false);
        return;
      }

      const payload = {
        sampling_id: Number(form.sampling_id),
        material_id: form.material_ids.map(Number), // Send as array
        moisture_pct: form.moisture_pct ? Number(form.moisture_pct) : null,
        broken_pct: form.broken_pct ? Number(form.broken_pct) : null,
        fm_pct: form.fm_pct ? Number(form.fm_pct) : null,
        color: form.color || null,
        smell: form.smell || null,
        variety_detected: form.variety_detected ? Number(form.variety_detected) : null,
        grain_size: form.grain_size || null,
        comment: form.comment || null,
        verdict: form.verdict,
        tested_at: form.tested_at ? toIso(form.tested_at) : null,
      };

      if (editingId) {
        await updateLabTestApi(editingId, payload);
        setInfo("Lab test updated successfully!");
      } else {
        await createLabTestApi(payload);
        setInfo(`Test submitted — verdict "${form.verdict}" applied to the gate entry for ${form.material_ids.length} material(s).`);
      }

      setForm(emptyForm);
      setEditingId(null);
      setAvailableMaterials([]);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Save failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    const materialIds = Array.isArray(row.material_id) 
      ? row.material_id 
      : (row.material_id ? [row.material_id] : []);
      
    setForm({
      sampling_id: row.sampling_id || "",
      material_ids: materialIds,
      moisture_pct: row.moisture_pct ?? "",
      broken_pct: row.broken_pct ?? "",
      fm_pct: row.fm_pct ?? "",
      color: row.color || "",
      smell: row.smell || "",
      variety_detected: row.variety_detected || "",
      grain_size: row.grain_size || "long",
      comment: row.comment || "",
      verdict: row.verdict || "accepted",
      tested_at: toLocal(row.tested_at),
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setAvailableMaterials([]);
    setError("");
    setInfo("");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lab test?")) return;
    try {
      await deleteLabTestApi(id);
      setInfo("Lab test deleted successfully!");
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleReviseVerdict = async (id, verdict) => {
    setError("");
    setInfo("");
    try {
      await updateLabTestVerdictApi(id, verdict);
      setInfo(`Verdict revised to "${verdict}".`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Verdict update failed");
    }
  };

  const getMaterialNames = (row) => {
    const materialIds = Array.isArray(row.material_id) 
      ? row.material_id 
      : (row.material_id ? [row.material_id] : []);
    
    if (materialIds.length === 0) return '—';
    
    return materialIds.map(id => allMaterials[id] || `Material ${id}`).join(', ');
  };

  // Inline styles
  const styles = {
    container: {
      padding: '20px',
      maxWidth: '1200px',
      margin: '0 auto',
    },
    pageHeader: {
      marginBottom: '24px',
    },
    pageTitle: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#1a1a1a',
      margin: '0 0 4px 0',
    },
    pageSubtitle: {
      fontSize: '14px',
      color: '#666',
      margin: 0,
    },
    alert: {
      padding: '12px 16px',
      borderRadius: '6px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontSize: '14px',
    },
    alertError: {
      background: '#fde8e8',
      color: '#c62828',
      border: '1px solid #f5c6c6',
    },
    alertSuccess: {
      background: '#e8f5e9',
      color: '#2e7d32',
      border: '1px solid #c8e6c9',
    },
    alertIcon: {
      fontWeight: 'bold',
      fontSize: '16px',
    },
    formCard: {
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
      padding: '24px',
      marginBottom: '24px',
    },
    formCardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
      paddingBottom: '16px',
      borderBottom: '1px solid #e0e0e0',
    },
    formCardHeaderH3: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#1a1a1a',
      margin: 0,
    },
    btnCancel: {
      padding: '6px 16px',
      background: 'transparent',
      color: '#666',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    },
    formGroupFull: {
      gridColumn: '1 / -1',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    },
    formLabel: {
      fontSize: '14px',
      fontWeight: '500',
      color: '#333',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    required: {
      color: '#d32f2f',
      fontWeight: '600',
    },
    materialCountBadge: {
      fontSize: '12px',
      fontWeight: '400',
      color: '#666',
      background: '#f0f0f0',
      padding: '2px 10px',
      borderRadius: '12px',
      marginLeft: '4px',
    },
    formInput: {
      padding: '8px 12px',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '14px',
      transition: 'border-color 0.2s',
      background: 'white',
      width: '100%',
      boxSizing: 'border-box',
    },
    formSelect: {
      padding: '8px 12px',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '14px',
      transition: 'border-color 0.2s',
      background: 'white',
      width: '100%',
      boxSizing: 'border-box',
    },
    formTextarea: {
      padding: '8px 12px',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '14px',
      transition: 'border-color 0.2s',
      background: 'white',
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
      resize: 'vertical',
    },
    materialListContainer: {
      border: '1px solid #e0e0e0',
      borderRadius: '6px',
      overflow: 'hidden',
    },
    materialListHeader: {
      padding: '10px 12px',
      background: '#f8f9fa',
      borderBottom: '1px solid #e0e0e0',
    },
    materialListActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    btnAction: {
      padding: '4px 12px',
      background: 'white',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '13px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      color: '#333',
    },
    selectedCount: {
      fontSize: '13px',
      color: '#666',
      marginLeft: 'auto',
      fontWeight: '500',
    },
    materialList: {
      maxHeight: '150px',
      overflowY: 'auto',
      padding: '4px 0',
    },
    materialItem: {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px',
      cursor: 'pointer',
      transition: 'background 0.15s',
      borderBottom: '1px solid #f5f5f5',
    },
    materialItemSelected: {
      background: '#e3f2fd',
    },
    materialCheckbox: {
      marginRight: '10px',
      width: '16px',
      height: '16px',
      cursor: 'pointer',
      accentColor: '#1976d2',
    },
    materialName: {
      fontSize: '14px',
      color: '#1a1a1a',
      flex: 1,
    },
    formHint: {
      fontSize: '13px',
      color: '#d32f2f',
      marginTop: '4px',
    },
    emptyState: {
      padding: '24px',
      textAlign: 'center',
      background: '#fafafa',
      borderRadius: '6px',
      color: '#666',
    },
    emptyIcon: {
      fontSize: '32px',
      display: 'block',
      marginBottom: '8px',
    },
    formActions: {
      display: 'flex',
      gap: '12px',
      marginTop: '24px',
      paddingTop: '20px',
      borderTop: '1px solid #e0e0e0',
    },
    btnSubmit: {
      padding: '10px 24px',
      background: '#1976d2',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    btnSubmitDisabled: {
      background: '#90caf9',
      cursor: 'not-allowed',
    },
    btnCancelForm: {
      padding: '10px 24px',
      background: 'transparent',
      color: '#666',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      fontSize: '14px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    spinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: 'white',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    },
    filterSection: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
      flexWrap: 'wrap',
    },
    filterButton: {
      padding: '6px 16px',
      border: '1px solid #d0d0d0',
      borderRadius: '4px',
      background: 'white',
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'all 0.2s',
      color: '#333',
    },
    filterButtonActive: {
      background: '#1976d2',
      color: 'white',
      borderColor: '#1976d2',
    },
    tableSection: {
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
      padding: '24px',
      marginBottom: '24px',
    },
    tableHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
    },
    tableHeaderH3: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#1a1a1a',
      margin: 0,
    },
    recordCount: {
      fontSize: '13px',
      color: '#888',
      background: '#f0f0f0',
      padding: '4px 12px',
      borderRadius: '12px',
    },
    badge: {
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: '500',
      display: 'inline-block',
    },
    badgeAccepted: {
      background: '#e8f5e9',
      color: '#2e7d32',
    },
    badgeRejected: {
      background: '#fde8e8',
      color: '#c62828',
    },
    badgeNegotiation: {
      background: '#fff3e0',
      color: '#e65100',
    },
  };

  return (
    <div style={styles.container}>
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .btn-cancel:hover {
            background: #f5f5f5;
            border-color: #b0b0b0;
          }
          .btn-action:hover {
            background: #f0f0f0;
            border-color: #b0b0b0;
          }
          .material-item:hover {
            background: #f5f8ff;
          }
          .btn-submit:hover:not(:disabled) {
            background: #1565c0;
            box-shadow: 0 2px 4px rgba(25,118,210,0.3);
          }
          .btn-cancel-form:hover {
            background: #f5f5f5;
          }
          .filter-btn:hover:not(.active) {
            background: #f0f0f0;
          }
          .form-input:focus, .form-select:focus, .form-textarea:focus {
            outline: none;
            border-color: #1976d2;
            box-shadow: 0 0 0 2px rgba(25,118,210,0.1);
          }
          @media (max-width: 768px) {
            .form-grid {
              grid-template-columns: 1fr !important;
            }
            .form-group-full {
              grid-column: 1 !important;
            }
            .form-card-header {
              flex-direction: column;
              gap: 12px;
              align-items: flex-start;
            }
            .material-list-actions {
              flex-wrap: wrap;
            }
            .selected-count {
              margin-left: 0;
              width: 100%;
            }
          }
        `}
      </style>

      <div style={styles.pageHeader}>
        <h2 style={styles.pageTitle}>Lab Test Management</h2>
        <p style={styles.pageSubtitle}>Record quality test results and verdicts for sampled materials</p>
      </div>

      {error && (
        <div style={{...styles.alert, ...styles.alertError}}>
          <span style={styles.alertIcon}>✕</span>
          {error}
        </div>
      )}
      {info && (
        <div style={{...styles.alert, ...styles.alertSuccess}}>
          <span style={styles.alertIcon}>✓</span>
          {info}
        </div>
      )}

      <div style={styles.formCard}>
        <div style={styles.formCardHeader}>
          <h3 style={styles.formCardHeaderH3}>
            {editingId ? "Update Lab Test" : "Create New Lab Test"}
          </h3>
          {editingId && (
            <button 
              className="btn-cancel"
              style={styles.btnCancel}
              onClick={handleCancel}
            >
              Cancel Edit
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid" style={styles.formGrid}>
            <div style={styles.formGroup}>
              <EntitySelect
                entity="sampling"
                label="Sampling"
                value={form.sampling_id}
                onChange={(id) => {
                  setForm({
                    ...emptyForm,
                    sampling_id: id,
                  });
                }}
                required
                disabled={!!editingId}
              />
            </div>

            {form.sampling_id && availableMaterials.length > 0 && (
              <div style={styles.formGroupFull}>
                <label style={styles.formLabel}>
                  Materials to Test
                  <span style={styles.required}>*</span>
                  <span style={styles.materialCountBadge}>
                    {availableMaterials.length} available
                  </span>
                </label>
                
                <div style={styles.materialListContainer}>
                  <div style={styles.materialListHeader}>
                    <div className="material-list-actions" style={styles.materialListActions}>
                      <button 
                        type="button" 
                        className="btn-action"
                        style={styles.btnAction}
                        onClick={handleSelectAll}
                      >
                        Select All
                      </button>
                      <button 
                        type="button" 
                        className="btn-action"
                        style={styles.btnAction}
                        onClick={handleDeselectAll}
                      >
                        Deselect All
                      </button>
                      <span className="selected-count" style={styles.selectedCount}>
                        Selected: {(form.material_ids || []).length}
                      </span>
                    </div>
                  </div>
                  
                  <div style={styles.materialList}>
                    {availableMaterials.map((material) => (
                      <label 
                        key={material.id} 
                        className="material-item"
                        style={{
                          ...styles.materialItem,
                          ...((form.material_ids || []).includes(material.id) ? styles.materialItemSelected : {})
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={(form.material_ids || []).includes(material.id)}
                          onChange={() => handleMaterialToggle(material.id)}
                          style={styles.materialCheckbox}
                          disabled={!!editingId}
                        />
                        <span style={styles.materialName}>{material.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                
                {(form.material_ids || []).length === 0 && (
                  <div style={styles.formHint}>
                    Please select at least one material for testing
                  </div>
                )}
              </div>
            )}

            {form.sampling_id && availableMaterials.length === 0 && (
              <div style={styles.formGroupFull}>
                <div style={styles.emptyState}>
                  <span style={styles.emptyIcon}>🔬</span>
                  <p>No materials found for this sampling</p>
                </div>
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Moisture %
                <span style={styles.required}>*</span>
              </label>
              <input
                name="moisture_pct"
                type="number"
                step="0.1"
                className="form-input"
                style={styles.formInput}
                value={form.moisture_pct}
                onChange={handleChange}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Broken %
                <span style={styles.required}>*</span>
              </label>
              <input
                name="broken_pct"
                type="number"
                step="0.1"
                className="form-input"
                style={styles.formInput}
                value={form.broken_pct}
                onChange={handleChange}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Foreign Matter %
                <span style={styles.required}>*</span>
              </label>
              <input
                name="fm_pct"
                type="number"
                step="0.1"
                className="form-input"
                style={styles.formInput}
                value={form.fm_pct}
                onChange={handleChange}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Color
                <span style={styles.required}>*</span>
              </label>
              <input
                name="color"
                type="text"
                className="form-input"
                style={styles.formInput}
                value={form.color}
                onChange={handleChange}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Smell
                <span style={styles.required}>*</span>
              </label>
              <input
                name="smell"
                type="text"
                className="form-input"
                style={styles.formInput}
                value={form.smell}
                onChange={handleChange}
                required
              />
            </div>

            <div style={styles.formGroup}>
              <EntitySelect
                entity="variety"
                label="Variety Detected"
                value={form.variety_detected}
                onChange={(id) => setForm({ ...form, variety_detected: id })}
                creatable
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Grain Size
                <span style={styles.required}>*</span>
              </label>
              <select
                name="grain_size"
                className="form-select"
                style={styles.formSelect}
                value={form.grain_size}
                onChange={handleChange}
                required
              >
                <option value="long">Long</option>
                <option value="medium">Medium</option>
                <option value="short">Short</option>
              </select>
            </div>

            <div style={styles.formGroupFull}>
              <label style={styles.formLabel}>Comment</label>
              <textarea
                name="comment"
                className="form-textarea"
                style={styles.formTextarea}
                value={form.comment}
                onChange={handleChange}
                rows={2}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Verdict
                <span style={styles.required}>*</span>
              </label>
              <select
                name="verdict"
                className="form-select"
                style={styles.formSelect}
                value={form.verdict}
                onChange={handleChange}
                required
              >
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="negotiation">Negotiation</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Tested At</label>
              <input
                name="tested_at"
                type="datetime-local"
                className="form-input"
                style={styles.formInput}
                value={form.tested_at}
                onChange={handleChange}
              />
            </div>
          </div>

          <div style={styles.formActions}>
            <button 
              className="btn-submit"
              style={{
                ...styles.btnSubmit,
                ...((isSubmitting || (!editingId && (!form.material_ids || form.material_ids.length === 0))) ? styles.btnSubmitDisabled : {})
              }}
              type="submit"
              disabled={isSubmitting || (!editingId && (!form.material_ids || form.material_ids.length === 0))}
            >
              {isSubmitting ? (
                <>
                  <span style={styles.spinner}></span>
                  {editingId ? "Updating..." : "Creating..."}
                </>
              ) : (
                editingId ? "Update Test" : "Submit Test"
              )}
            </button>
            {editingId && (
              <button 
                type="button" 
                className="btn-cancel-form"
                style={styles.btnCancelForm}
                onClick={handleCancel}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div style={styles.tableSection}>
        <div style={styles.tableHeader}>
          <h3 style={styles.tableHeaderH3}>Lab Test Records</h3>
          <span style={styles.recordCount}>{tests.length} records</span>
        </div>

        <div style={styles.filterSection}>
          {VERDICT_FILTERS.map((f) => (
            <button
              key={f.key}
              className="filter-btn"
              style={{
                ...styles.filterButton,
                ...(verdictFilter === f.key ? styles.filterButtonActive : {})
              }}
              onClick={() => handleFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <DataTable
          loading={loading}
          rows={tests}
          onEdit={handleEdit}
          onDelete={handleDelete}
          columns={[
            {
              key: "sampling_id",
              label: "Sampling",
              render: (row) => samplings.getLabel(row.sampling_id),
            },
            {
              key: "materials",
              label: "Materials",
              render: (row) => getMaterialNames(row),
            },
            { key: "moisture_pct", label: "Moisture %" },
            { key: "broken_pct", label: "Broken %" },
            { key: "fm_pct", label: "FM %" },
            {
              key: "verdict",
              label: "Verdict",
              render: (row) => {
                const badgeStyle = {
                  ...styles.badge,
                  ...(row.verdict === 'accepted' ? styles.badgeAccepted : 
                     row.verdict === 'rejected' ? styles.badgeRejected : 
                     styles.badgeNegotiation)
                };
                return <span style={badgeStyle}>{row.verdict}</span>;
              },
            },
            {
              key: "revise",
              label: "Revise Verdict",
              render: (row) => (
                <select
                  style={styles.formSelect}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleReviseVerdict(row.id, e.target.value);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="" disabled>Change to…</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="negotiation">Negotiation</option>
                </select>
              ),
            },
          ]}
        />
      </div>

      <ModuleGuide
        title="Lab Tests"
        steps={[
          "Select a sampling that has materials ready for testing.",
          "Choose which materials from the sampling you want to test.",
          "Enter the quality test results (moisture, broken %, FM %, color, smell, etc.).",
          "Select a verdict: Accepted, Rejected, or Negotiation.",
          "Accepted moves the gate entry forward. Rejected stops the load. Negotiation sends it to Sales for rate discussion.",
          "You can revise a verdict later using the dropdown in the table."
        ]}
      />
    </div>
  );
}