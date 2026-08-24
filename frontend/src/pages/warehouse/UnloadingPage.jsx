import { useState, useEffect } from "react";
import {
  getLotsApi,
  startUnloadingApi,
  completeUnloadingApi,
  routeLotApi,
  getWeightSlipsApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import ModuleGuide from "../../components/ModuleGuide";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// Unloading is now a two-step physical/system workflow:
//   1. Start Unloading — truck is opened up at the factory bay. A manual check
//      happens on the ground (this is not a data-entry step); the system just
//      opens a Lot shell and marks the gate entry "unloading".
//   2. Complete Unloading — once the manual check is done, bag size + accepted/
//      rejected bag counts are entered. Quantities are auto-calculated from
//      those bags. Only the accepted qty opens a Stack + Inventory row and can
//      then be routed to Warehouse or Production, same as before.
const startForm0 = {
  gate_entry_id: "",
  warehouse_id: "",
  bin_id: "",
  material_id: "",
  variety_id: "",
};

const bagForm0 = { bag_size: "", accepted_bags: "", rejected_bags: "0" };

export default function UnloadingPage() {
  const [inProgressLots, setInProgressLots] = useState([]); // started, bags not counted yet
  const [pendingRouteLots, setPendingRouteLots] = useState([]); // completed, not yet routed
  const [loading, setLoading] = useState(true);
  const [weighbridgeGateEntryIds, setWeighbridgeGateEntryIds] = useState(new Set());
  const [startFormState, setStartFormState] = useState(startForm0);
  const [showOptional, setShowOptional] = useState(false);
  const [bagEntryLotId, setBagEntryLotId] = useState(null);
  const [bagForm, setBagForm] = useState(bagForm0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const gateEntries = useEntityLookup("gate_entry");

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
      if (startFormState.material_id !== "") payload.material_id = Number(startFormState.material_id);
      if (startFormState.variety_id !== "") payload.variety_id = Number(startFormState.variety_id);

      const res = await startUnloadingApi(payload);
      const lotNo = res.data.lot?.lot_no ?? res.data.data?.lot?.lot_no;
      setInfo(
        `Unloading started — Lot ${lotNo ? `${lotNo} ` : ""}opened. Do the manual check at the factory, then enter bag counts below to complete it.`
      );
      setStartFormState(startForm0);
      setShowOptional(false);
      gateEntries.refetch();
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Could not start unloading — gate entry may not be weighed (in_process) yet."
      );
    }
  };

  const openBagEntry = (lotId) => {
    setError("");
    setInfo("");
    setBagForm(bagForm0);
    setBagEntryLotId(lotId);
  };

  const handleBagChange = (e) => setBagForm({ ...bagForm, [e.target.name]: e.target.value });

  const bagSizeNum = Number(bagForm.bag_size) || 0;
  const acceptedBagsNum = Number(bagForm.accepted_bags) || 0;
  const rejectedBagsNum = Number(bagForm.rejected_bags) || 0;
  const acceptedQtyPreview = Math.round(bagSizeNum * acceptedBagsNum * 100) / 100;
  const rejectedQtyPreview = Math.round(bagSizeNum * rejectedBagsNum * 100) / 100;

  const handleBagSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {
        bag_size: Number(bagForm.bag_size),
        accepted_bags: Number(bagForm.accepted_bags),
        rejected_bags: Number(bagForm.rejected_bags || 0),
      };
      const res = await completeUnloadingApi(bagEntryLotId, payload);
      setInfo(res.data.msg || "Unloading completed.");
      setBagEntryLotId(null);
      setBagForm(bagForm0);
      gateEntries.refetch();
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Completing unloading failed");
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

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Unloading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

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

        <button
          type="button"
          className="sf-cancel"
          style={{ marginBottom: 10 }}
          onClick={() => setShowOptional((v) => !v)}
        >
          {showOptional ? "Hide" : "Show"} optional overrides
        </button>

        {showOptional && (
          <>
            <EntitySelect
              entity="material"
              label="Material (defaults from gate entry / PO)"
              value={startFormState.material_id}
              onChange={(id) => setStartFormState({ ...startFormState, material_id: id })}
            />
            <EntitySelect
              entity="variety"
              label="Variety (add new if found)"
              value={startFormState.variety_id}
              onChange={(id) => setStartFormState({ ...startFormState, variety_id: id })}
              creatable
            />
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            Start Unloading
          </button>
        </div>
      </form>

      <h3 style={{ marginTop: 24 }}>Awaiting Manual Check &amp; Bag Count</h3>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Truck is open at the factory for a manual check. Once done, enter the bag size and
        accepted/rejected bag counts to finish unloading — quantities are calculated automatically.
      </p>
      <DataTable
        loading={loading}
        rows={inProgressLots}
        columns={[
          { key: "lot_no", label: "Lot No." },
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
          { key: "material", label: "Material", render: (row) => row.material?.name || "—" },
          {
            key: "lab_comment",
            label: "Lab Comment",
            render: (row) => row.purchase?.gateEntry?.samplings?.find((s) => s.labTest?.comment)?.labTest?.comment || "—",
          },
          {
            key: "bag_actions",
            label: "Bag Count",
            render: (row) => (
              <button className="dt-btn" onClick={() => openBagEntry(row.id)}>
                Enter Bag Count
              </button>
            ),
          },
        ]}
      />

      {bagEntryLotId && (
        <form className="sf-form" onSubmit={handleBagSubmit} style={{ marginTop: 16 }}>
          <h4 style={{ marginTop: 0 }}>
            Complete Unloading — Lot {inProgressLots.find((l) => l.id === bagEntryLotId)?.lot_no}
          </h4>
          <div className="sf-field">
            <label>Bag Size (kg per bag)</label>
            <input
              name="bag_size"
              type="number"
              step="0.01"
              value={bagForm.bag_size}
              onChange={handleBagChange}
              required
            />
          </div>
          <div className="sf-field">
            <label>Accepted Bags</label>
            <input
              name="accepted_bags"
              type="number"
              step="1"
              min="0"
              value={bagForm.accepted_bags}
              onChange={handleBagChange}
              required
            />
          </div>
          <div className="sf-field">
            <label>Rejected Bags</label>
            <input
              name="rejected_bags"
              type="number"
              step="1"
              min="0"
              value={bagForm.rejected_bags}
              onChange={handleBagChange}
            />
          </div>

          <p className="field-hint">
            Accepted Qty (Tons): <strong>{acceptedQtyPreview}</strong> &nbsp;|&nbsp; Rejected Qty (Tons):{" "}
            <strong>{rejectedQtyPreview}</strong> &nbsp;|&nbsp; Total Qty (Tons):{" "}
            <strong>{Math.round((acceptedQtyPreview + rejectedQtyPreview) * 100) / 100}</strong>
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">
              Complete Unloading
            </button>
            <button type="button" className="sf-cancel" onClick={() => setBagEntryLotId(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <h3 style={{ marginTop: 24 }}>Pending Routing</h3>
      <p className="field-hint" style={{ marginTop: -6 }}>
        Unloading completed — accepted bags are counted and in stock. Route them to Warehouse
        (stays as raw stock) or Production (goes straight into a batch). For the full list of all
        lots, see the Lots tab.
      </p>
      <DataTable
        loading={loading}
        rows={pendingRouteLots}
        columns={[
          { key: "lot_no", label: "Lot No." },
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
            key: "lab_comment",
            label: "Lab Comment",
            render: (row) => row.purchase?.gateEntry?.samplings?.find((s) => s.labTest?.comment)?.labTest?.comment || "—",
          },
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
          "Only gate entries at 'in_process' (already weighed) show up in Start Unloading — pick one, then choose which Warehouse and Bin the truck is unloading into.",
          "Starting unloading opens a Lot and marks the gate entry 'unloading' — no stock exists yet. This is the point where a manual check happens at the factory.",
          "Once the manual check is done, enter Bag Size, Accepted Bags and Rejected Bags for that lot. Accepted/Rejected/Total quantities are calculated automatically.",
          "Completing unloading opens the Stack and Inventory row using the ACCEPTED quantity only, and moves the gate entry to 'unloaded'. Rejected quantity is recorded on the lot but never enters stock.",
          "The accepted stock then appears in 'Pending Routing' until you route it to Warehouse (stays as raw stock) or Production (goes straight into a batch).",
          "Once routed, a lot moves off this page and into the full Lots list for ongoing management.",
        ]}
      />
    </div>
  );
}