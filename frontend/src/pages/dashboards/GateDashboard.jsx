import { useState } from "react";
import DashboardLayout from "./DashboardLayout";
import GateEntryPage from "../gate/GateEntryPage";
import WeighbridgePage from "../gate/WeighbridgePage";
import LoadingPage from "../gate/LoadingPage";

const TABS = [
  { key: "entries", label: "Gate Entry" },
  { key: "weighbridge", label: "Weighbridge" },
  { key: "loading", label: "Loading" },
];

export default function GateDashboard() {
  const [tab, setTab] = useState("entries");
  // Set by LoadingPage's "Load New Truck for Remaining Qty" action — jumps
  // to the Gate Entry tab with entry_type "sales" and this Sales Order
  // pre-selected, so the operator only has to pick a Vehicle/Driver for the
  // next truck instead of re-finding the same Sales Order.
  const [prefillSoId, setPrefillSoId] = useState(null);

  const handleLoadNewTruck = (soId) => {
    setPrefillSoId(soId);
    setTab("entries");
  };

  return (
    <DashboardLayout title="Gate Dashboard">
      <div className="section-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`section-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "entries" && (
        <GateEntryPage
          prefillSoId={prefillSoId}
          onPrefillConsumed={() => setPrefillSoId(null)}
        />
      )}
      {tab === "weighbridge" && <WeighbridgePage />}
      {tab === "loading" && <LoadingPage onLoadNewTruck={handleLoadNewTruck} />}
    </DashboardLayout>
  );
}