import { useState, useEffect } from "react";
import {
  getLotsApi,
  startUnloadingApi,
  completeUnloadingApi,
  routeLotApi,
  getWeightSlipsApi,
  getGateEntryApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const startForm0 = {
  gate_entry_id: "",
  warehouse_id: "",
  bin_id: "",
};

export default function UnloadingPage() {
  const [inProgressLots, setInProgressLots] = useState([]);
  const [pendingRouteLots, setPendingRouteLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weighbridgeGateEntryIds, setWeighbridgeGateEntryIds] = useState(new Set());
  const [startFormState, setStartFormState] = useState(startForm0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  
  const [unloadingItems, setUnloadingItems] = useState([]);
  const [isUnloadingFormOpen, setIsUnloadingFormOpen] = useState(false);
  const [currentGateEntryId, setCurrentGateEntryId] = useState(null);

  const gateEntries = useEntityLookup("gate_entry");
  const materials = useEntityLookup("material");
  const warehouses = useEntityLookup("warehouse");
  const bins = useEntityLookup("bin");

  const load = () => {
    setLoading(true);
    Promise.all([getLotsApi(), getWeightSlipsApi()])
      .then((res) => {
        const lotsRes = res[0].data.data ?? res[0].data;
        const slipsRes = res[1].data.data ?? res[1].data;
        setInProgressLots((lotsRes || []).filter((lot) => lot.unloading_status === "in_progress"));
        setPendingRouteLots(
          (lotsRes || []).filter((lot) => lot.unloading_status === "completed" && !lot.destination)
        );
        const ids = new Set((slipsRes || []).map((s) => Number(s.gate_entry_id)).filter(Boolean));
        setWeighbridgeGateEntryIds(ids);
      })
      .catch(() => setError("Failed to load unloading queue"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleStartSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {
        gate_entry_id: Number(startFormState.gate_entry_id),
        warehouse_id: Number(startFormState.warehouse_id),
      };
      if (startFormState.bin_id) payload.bin_id = Number(startFormState.bin_id);

      console.log('Starting unloading with payload:', payload);

      const res = await startUnloadingApi(payload);
      console.log('Start unloading response:', res.data);
      
      let lots = [];
      if (res.data.data && res.data.data.lots) {
        lots = res.data.data.lots;
      } else if (res.data.lots) {
        lots = res.data.lots;
      }
      
      if (!lots || lots.length === 0) {
        setError("No lots were created. Please check if the gate entry has materials.");
        return;
      }

      const materialsList = res.data.data?.materials || [];
      const unloadingItemsList = lots.map((lot, index) => {
        const material = materialsList[index] || { id: lot.material_id, name: `Material ${lot.material_id}` };
        return {
          lot_id: lot.id,
          lot_no: lot.lot_no,
          material_id: material.id || lot.material_id,
          material_name: material.name || 'Unknown Material',
          bag_size: "",
          accepted_bags: "",
          rejected_bags: "0",
          accepted_qty: 0,
          rejected_qty: 0,
        };
      });

      setUnloadingItems(unloadingItemsList);
      setCurrentGateEntryId(startFormState.gate_entry_id);
      setIsUnloadingFormOpen(true);
      
      setInfo(
        `Unloading started — ${lots.length} lot(s) opened. Enter bag counts for each material below.`
      );
      setStartFormState(startForm0);
      gateEntries.refetch();
      load();
    } catch (err) {
      console.error('Start unloading error:', err);
      console.error('Error response:', err.response);
      
      let errorMsg = "Could not start unloading — ";
      if (err.response?.data?.msg) {
        errorMsg += err.response.data.msg;
      } else if (err.response?.data?.message) {
        errorMsg += err.response.data.message;
      } else {
        errorMsg += "Please ensure the gate entry has been weighed and has materials assigned.";
      }
      setError(errorMsg);
    }
  };

  // Function to open bag count form for a single lot
  const openBagCountForm = (lot) => {
    setUnloadingItems([{
      lot_id: lot.id,
      lot_no: lot.lot_no,
      material_id: lot.material_id,
      material_name: lot.material?.name || 'Unknown Material',
      bag_size: lot.bag_size || "",
      accepted_bags: lot.accepted_bags || "",
      rejected_bags: lot.rejected_bags || "0",
      accepted_qty: lot.qty || 0,
      rejected_qty: lot.rejected_qty || 0,
    }]);
    setIsUnloadingFormOpen(true);
  };

  const handleUnloadingItemChange = (index, field, value) => {
    const updatedItems = [...unloadingItems];
    updatedItems[index][field] = value;
    
    if (field === 'bag_size' || field === 'accepted_bags' || field === 'rejected_bags') {
      const bagSize = Number(updatedItems[index].bag_size) || 0;
      const acceptedBags = Number(updatedItems[index].accepted_bags) || 0;
      const rejectedBags = Number(updatedItems[index].rejected_bags) || 0;
      updatedItems[index].accepted_qty = Math.round(bagSize * acceptedBags * 100) / 100;
      updatedItems[index].rejected_qty = Math.round(bagSize * rejectedBags * 100) / 100;
    }
    
    setUnloadingItems(updatedItems);
  };

  const handleCompleteUnloading = async () => {
    setError("");
    setInfo("");
    
    // Check if there are items to process
    if (!unloadingItems || unloadingItems.length === 0) {
      setError("No items to complete unloading. Please start unloading first.");
      return;
    }
    
    for (const item of unloadingItems) {
      if (!item.bag_size || Number(item.bag_size) <= 0) {
        setError(`Please enter bag size for ${item.material_name}`);
        return;
      }
      if (item.accepted_bags === "" || Number(item.accepted_bags) < 0) {
        setError(`Please enter accepted bags for ${item.material_name}`);
        return;
      }
      if (Number(item.accepted_bags) + Number(item.rejected_bags || 0) <= 0) {
        setError(`At least one bag (accepted or rejected) required for ${item.material_name}`);
        return;
      }
    }

    try {
      const payload = {
        items: unloadingItems.map(item => ({
          lot_id: item.lot_id,
          bag_size: Number(item.bag_size),
          accepted_bags: Number(item.accepted_bags),
          rejected_bags: Number(item.rejected_bags || 0)
        }))
      };

      console.log('Sending payload:', payload);

      // Call the API without the id parameter since route is now /complete-unloading
      const res = await completeUnloadingApi(payload);
      
      console.log('Complete unloading response:', res.data);
      setInfo(res.data.msg || "All materials unloaded successfully.");
      setIsUnloadingFormOpen(false);
      setUnloadingItems([]);
      gateEntries.refetch();
      load();
    } catch (err) {
      console.error('Complete unloading error:', err);
      console.error('Error response:', err.response);
      setError(err.response?.data?.msg || err.response?.data?.message || "Completing unloading failed");
    }
  };

  const handleRoute = async (id, destination) => {
    setError("");
    setInfo("");
    try {
      await routeLotApi(id, destination);
      setInfo(`Accepted stock routed to ${destination}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Routing failed");
    }
  };

  const renderUnloadingForm = () => {
    if (!isUnloadingFormOpen) return null;

    return (
      <div style={{ 
        background: '#f8fafc', 
        padding: '20px', 
        borderRadius: '8px', 
        marginTop: '20px',
        border: '2px solid #3b82f6'
      }}>
        <h3 style={{ marginTop: 0 }}>Complete Unloading - Enter Bag Counts for Each Material</h3>
        
        {unloadingItems.map((item, index) => (
          <div key={item.lot_id} style={{ 
            border: '1px solid #e2e8f0', 
            padding: '15px', 
            borderRadius: '6px', 
            marginBottom: '15px',
            background: 'white'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>
              {item.material_name} (Lot: {item.lot_no})
            </h4>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Bag Size (kg)</label>
                <input
                  type="number"
                  step="0.01"
                  value={item.bag_size}
                  onChange={(e) => handleUnloadingItemChange(index, 'bag_size', e.target.value)}
                  required
                />
              </div>
              
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Accepted Bags</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={item.accepted_bags}
                  onChange={(e) => handleUnloadingItemChange(index, 'accepted_bags', e.target.value)}
                  required
                />
              </div>
              
              <div className="sf-field" style={{ marginBottom: 0 }}>
                <label>Rejected Bags</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={item.rejected_bags}
                  onChange={(e) => handleUnloadingItemChange(index, 'rejected_bags', e.target.value)}
                />
              </div>
            </div>

            <div style={{ 
              marginTop: '10px', 
              padding: '8px 12px', 
              background: '#f1f5f9', 
              borderRadius: '4px',
              display: 'flex',
              gap: '20px',
              flexWrap: 'wrap'
            }}>
              <span>
                <strong>Accepted Qty:</strong> {item.accepted_qty || 0} kg 
                ({Math.round((item.accepted_qty || 0) / 1000 * 100) / 100} tons)
              </span>
              <span>
                <strong>Rejected Qty:</strong> {item.rejected_qty || 0} kg
                ({Math.round((item.rejected_qty || 0) / 1000 * 100) / 100} tons)
              </span>
              <span>
                <strong>Total:</strong> {Math.round(((item.accepted_qty || 0) + (item.rejected_qty || 0)) * 100) / 100} kg
              </span>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <button className="sf-submit" onClick={handleCompleteUnloading}>
            Complete All Unloading
          </button>
          <button 
            type="button" 
            className="sf-cancel" 
            onClick={() => {
              setIsUnloadingFormOpen(false);
              setUnloadingItems([]);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Unloading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {!isUnloadingFormOpen && (
        <>
          <h3 style={{ marginTop: 0 }}>Start Unloading</h3>
          <form className="sf-form" onSubmit={handleStartSubmit}>
            <EntitySelect
              entity="gate_entry"
              label="Gate Entry"
              value={startFormState.gate_entry_id}
              onChange={(id) => setStartFormState({ ...startFormState, gate_entry_id: id })}
              filter={(row) =>
                row.gate_status === "in_process" && weighbridgeGateEntryIds.has(Number(row.id))
              }
              required
            />
            <EntitySelect
              entity="warehouse"
              label="Warehouse"
              value={startFormState.warehouse_id}
              onChange={(id) => setStartFormState({ ...startFormState, warehouse_id: id })}
              required
              creatable
            />
            <EntitySelect
              entity="bin"
              label="Bin"
              value={startFormState.bin_id}
              onChange={(id) => setStartFormState({ ...startFormState, bin_id: id })}
              creatable
              context={{ warehouse_id: startFormState.warehouse_id }}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button className="sf-submit" type="submit">
                Start Unloading
              </button>
            </div>
          </form>
        </>
      )}

      {renderUnloadingForm()}

      <h3 style={{ marginTop: 24 }}>Awaiting Manual Check &amp; Bag Count</h3>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Truck is open at the factory for a manual check. Once done, enter the bag size and
        accepted/rejected bag counts for each material to finish unloading.
      </p>
      <DataTable
        loading={loading}
        rows={inProgressLots}
        columns={[
          { key: "lot_no", label: "Lot No." },
          { key: "material", label: "Material", render: (row) => row.material?.name || "—" },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) =>
              row.purchase?.gate_entry_id
                ? gateEntries.getLabel(row.purchase.gate_entry_id)
                : "—",
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) =>
              row.targetWarehouse
                ? `${row.targetWarehouse.name} (${row.targetWarehouse.warehouse_code})`
                : "—",
          },
          { key: "bin_id", label: "Bin", render: (row) => row.targetBin?.bin_code || "—" },
          {
            key: "lab_comment",
            label: "Lab Comment",
            render: (row) => row.purchase?.gateEntry?.samplings?.find((s) => s.labTest?.comment)?.labTest?.comment || "—",
          },
          {
            key: "bag_actions",
            label: "Bag Count",
            render: (row) => (
              <button 
                className="dt-btn" 
                onClick={() => openBagCountForm(row)}
                style={{ background: '#3b82f6', color: 'white' }}
              >
                Enter Bag Count
              </button>
            ),
          },
        ]}
      />

      <h3 style={{ marginTop: 24 }}>Pending Routing</h3>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Unloading completed — accepted bags are counted and in stock. Route them to Warehouse
        (stays as raw stock) or Production (goes straight into a batch).
      </p>
      <DataTable
        loading={loading}
        rows={pendingRouteLots}
        columns={[
          { key: "lot_no", label: "Lot No." },
          { key: "material", label: "Material", render: (row) => row.material?.name || "—" },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) =>
              row.stacks?.[0]?.warehouse
                ? `${row.stacks[0].warehouse.name} (${row.stacks[0].warehouse.warehouse_code})`
                : "—",
          },
          { key: "bin_id", label: "Bin", render: (row) => row.stacks?.[0]?.bin?.bin_code || "—" },
          { key: "accepted_bags", label: "Accepted Bags" },
          { key: "rejected_bags", label: "Rejected Bags" },
          { key: "qty", label: "Accepted Qty (Tons)" },
          { key: "rejected_qty", label: "Rejected Qty (Tons)" },
          {
            key: "route_actions",
            label: "Route",
            render: (row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="dt-btn" onClick={() => handleRoute(row.id, "warehouse")}>
                  To Warehouse
                </button>
                <button className="dt-btn" onClick={() => handleRoute(row.id, "production")}>
                  To Production
                </button>
              </div>
            ),
          },
        ]}
      />

      <ModuleGuide
        title="Unloading"
        steps={[
          "Only gate entries at 'in_process' (already weighed) show up in Start Unloading.",
          "When you start unloading, the system automatically detects all materials from the gate entry.",
          "For each material, you'll enter the bag size and count of accepted/rejected bags.",
          "Quantities are calculated automatically based on bag size × number of bags.",
          "Rejected bags are recorded but never enter stock.",
          "Once all materials are completed, the gate entry moves to 'unloaded'.",
          "Route accepted stock to Warehouse or Production as needed."
        ]}
      />
    </div>
  );
}