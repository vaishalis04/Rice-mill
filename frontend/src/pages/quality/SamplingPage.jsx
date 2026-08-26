import { useState, useEffect } from "react";
import {
  getSamplingsApi,
  getPurchaseOrdersGroupedApi,
  createSamplingApi,
  updateSamplingApi,
  deleteSamplingApi,
  getMasterSettingsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  gate_entry_id: "",
  material_ids: [],
  collected_at: "",
  sent_to_lab_at: "",
};

const toIso = (local) => (local ? new Date(local).toISOString() : "");
const toLocal = (iso) => (iso ? iso.slice(0, 16) : "");

export default function SamplingPage() {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [availableMaterials, setAvailableMaterials] = useState([]);
  const [allMaterials, setAllMaterials] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const gateEntries = useEntityLookup("gate_entry");

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

  useEffect(() => {
    getPurchaseOrdersGroupedApi()
      .then((res) => setPurchaseOrders(res.data.data ?? res.data))
      .catch(() => setError("Failed to load Purchase Order materials"));
  }, []);

  useEffect(() => {
    if (form.gate_entry_id) {
      const selectedGateEntry = gateEntries.rows.find(
        (row) => String(row.id) === String(form.gate_entry_id)
      );
      
      if (selectedGateEntry) {
        const materials = [];
        const poItems = selectedGateEntry.purchase_orders || [];
        
        poItems.forEach(po => {
          if (!po.is_deleted && po.material_id) {
            if (!materials.some(m => m.id === po.material_id)) {
              materials.push({
                id: po.material_id,
                name: allMaterials[po.material_id] || po.material?.name || `Material ${po.material_id}`,
                po_id: po.id,
                po_no: po.po_no
              });
            }
          }
        });
        
        setAvailableMaterials(materials);
        
        if (materials.length === 1) {
          setForm(prev => ({
            ...prev,
            material_ids: [materials[0].id]
          }));
        } else {
          setForm(prev => ({
            ...prev,
            material_ids: []
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
  }, [form.gate_entry_id, gateEntries.rows, allMaterials]);

  const load = () => {
    setLoading(true);
    getSamplingsApi()
      .then((res) => {
        const data = res.data.data ?? res.data;
        setSamples(data);
      })
      .catch(() => setError("Failed to load samples"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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
      if (editingId) {
        await updateSamplingApi(editingId, {
          sent_to_lab_at: toIso(form.sent_to_lab_at),
        });
        setInfo("Sample updated successfully!");
      } else {
        if (!form.material_ids || form.material_ids.length === 0) {
          setError("Please select at least one material to sample");
          setIsSubmitting(false);
          return;
        }

        try {
          await createSamplingApi({
            gate_entry_id: Number(form.gate_entry_id),
            material_id: form.material_ids,
            collected_at: toIso(form.collected_at),
          });
          setInfo(`Sample created for ${form.material_ids.length} material(s).`);
        } catch (err) {
          if (err.response?.data?.msg?.includes('Incorrect integer value')) {
            const promises = form.material_ids.map(materialId => {
              return createSamplingApi({
                gate_entry_id: Number(form.gate_entry_id),
                material_id: materialId,
                collected_at: toIso(form.collected_at),
              });
            });
            await Promise.all(promises);
            setInfo(`Created ${form.material_ids.length} individual sample(s).`);
          } else {
            throw err;
          }
        }
      }
      
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.msg ||
          "Save failed — gate entry may not be at waiting_sampling yet."
      );
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
      gate_entry_id: row.gate_entry_id || "",
      material_ids: materialIds,
      collected_at: toLocal(row.collected_at),
      sent_to_lab_at: toLocal(row.sent_to_lab_at),
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setInfo("");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this sample?")) return;
    try {
      await deleteSamplingApi(id);
      setInfo("Sample deleted successfully!");
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const getMaterialNames = (row) => {
    if (row.material_names && Array.isArray(row.material_names)) {
      return row.material_names.join(', ');
    }

    if (row.materials && Array.isArray(row.materials)) {
      const names = row.materials
        .map(m => {
          if (typeof m === 'string') return m;
          return m.name || m.material_name || 'Unknown';
        })
        .filter(Boolean);
      if (names.length > 0) return names.join(', ');
    }

    if (row.material && typeof row.material === 'object') {
      return row.material.name || row.material.material_name || 'Unknown';
    }

    if (row.material_name) {
      return row.material_name;
    }

    let materialIds = [];
    if (Array.isArray(row.material_id)) {
      materialIds = row.material_id;
    } else if (row.material_id) {
      materialIds = [row.material_id];
    }

    if (materialIds.length === 0) {
      return '—';
    }

    const names = materialIds.map(id => {
      if (allMaterials[id]) {
        return allMaterials[id];
      }
      
      if (row.gateEntry && row.gateEntry.purchase_orders) {
        const po = row.gateEntry.purchase_orders.find(
          po => po.material_id === id || po.material?.id === id
        );
        if (po) {
          return po.material?.name || po.material_name || `Material ${id}`;
        }
      }
      
      const availMat = availableMaterials.find(m => m.id === id);
      if (availMat) {
        return availMat.name;
      }
      
      return `Material ${id}`;
    });
    
    return names.join(', ');
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
      maxHeight: '200px',
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
    materialPo: {
      fontSize: '12px',
      color: '#888',
      background: '#f0f0f0',
      padding: '2px 8px',
      borderRadius: '12px',
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
    formHint: {
      fontSize: '13px',
      color: '#d32f2f',
      marginTop: '4px',
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
          .form-input:focus {
            outline: none;
            border-color: #1976d2;
            box-shadow: 0 0 0 2px rgba(25,118,210,0.1);
          }
          .form-input:disabled {
            background: #f5f5f5;
            color: #999;
            cursor: not-allowed;
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
        <h2 style={styles.pageTitle}>Sampling Management</h2>
        <p style={styles.pageSubtitle}>Manage material sampling from gate entries</p>
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
            {editingId ? "Update Sample" : "Create New Sample"}
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
                entity="gate_entry"
                label="Gate Entry"
                value={form.gate_entry_id}
                onChange={(id) => {
                  setForm({
                    ...emptyForm,
                    gate_entry_id: id,
                  });
                }}
                filter={(row) => row.gate_status === "waiting_sampling"}
                required={!editingId}
                disabled={!!editingId}
              />
            </div>

            {!editingId && form.gate_entry_id && (
              <div style={styles.formGroupFull}>
                <label style={styles.formLabel}>
                  Materials Being Sampled
                  <span style={styles.materialCountBadge}>
                    {availableMaterials.length} available
                  </span>
                </label>
                
                {availableMaterials.length > 0 ? (
                  <>
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
                            />
                            <span style={styles.materialName}>{material.name}</span>
                            {material.po_no && (
                              <span style={styles.materialPo}>PO: {material.po_no}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                    
                    {(form.material_ids || []).length === 0 && (
                      <div style={styles.formHint}>
                        Please select at least one material
                      </div>
                    )}
                  </>
                ) : (
                  <div style={styles.emptyState}>
                    <span style={styles.emptyIcon}>📦</span>
                    <p>No materials found for this gate entry</p>
                  </div>
                )}
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                Collected At
                <span style={styles.required}>*</span>
              </label>
              <input
                name="collected_at"
                type="datetime-local"
                value={form.collected_at}
                onChange={handleChange}
                className="form-input"
                style={styles.formInput}
                disabled={!!editingId}
                required={!editingId}
              />
            </div>

            {editingId && (
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  Sent to Lab At
                  <span style={styles.required}>*</span>
                </label>
                <input
                  name="sent_to_lab_at"
                  type="datetime-local"
                  value={form.sent_to_lab_at}
                  onChange={handleChange}
                  className="form-input"
                  style={styles.formInput}
                  required
                />
              </div>
            )}
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
                editingId ? "Update Sample" : "Create Sample"
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
          <h3 style={styles.tableHeaderH3}>Sample Records</h3>
          <span style={styles.recordCount}>{samples.length} records</span>
        </div>
        <DataTable
          loading={loading}
          rows={samples}
          onEdit={handleEdit}
          onDelete={handleDelete}
          columns={[
            { key: "sample_code", label: "Sample Code" },
            { 
              key: "materials", 
              label: "Materials", 
              render: (row) => getMaterialNames(row)
            },
            {
              key: "gate_entry_id",
              label: "Gate Entry",
              render: (row) => gateEntries.getLabel(row.gate_entry_id),
            },
            { key: "collected_at", label: "Collected At" },
            { key: "sent_to_lab_at", label: "Sent to Lab At" },
          ]}
        />
      </div>

      <ModuleGuide
        title="Sampling Guide"
        steps={[
          "Only gate entries at 'waiting_sampling' show up in the picker — that means the truck has already checked out at the gate.",
          "Select one or multiple materials to sample from the gate entry.",
          "Record when the sample was collected, then send it to the lab.",
          "Once sent, the entry moves on to Lab Tests for a verdict.",
        ]}
      />
    </div>
  );
}