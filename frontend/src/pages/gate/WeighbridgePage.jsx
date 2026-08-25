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

  const gateEntries = useEntityLookup("gate_entry");
  const vehicles = useEntityLookup("vehicle");
  const drivers = useEntityLookup("driver");

  const getGateEntryRow = (gate_entry_id) =>
    gateEntries.rows.find((r) => String(r.id) === String(gate_entry_id));

  const selectedGateEntry = getGateEntryRow(form.gate_entry_id);
  const isOtherEntry = selectedGateEntry?.entry_type === "other";

  const load = () => {
    setLoading(true);
    getWeightSlipsApi()
      .then((res) => setSlips(res.data.data ?? res.data))
      .catch(() => setError("Failed to load weight slips"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const liveNetWeight = useMemo(() => {
    if (form.gross_weight === "" || form.tare_weight === "") return null;
    const g = Number(form.gross_weight);
    const t = Number(form.tare_weight);
    if (Number.isNaN(g) || Number.isNaN(t)) return null;
    return g - t;
  }, [form.gross_weight, form.tare_weight]);

  useEffect(() => {
    if (editingId || !form.gate_entry_id) return;
    const ge = getGateEntryRow(form.gate_entry_id);
    if (!ge || !ge.vehicle_id) return;

    const priorForVehicle = slips
      .filter((s) => {
        const otherGe = getGateEntryRow(s.gate_entry_id);
        return otherGe && String(otherGe.vehicle_id) === String(ge.vehicle_id);
      })
      .sort(
        (a, b) =>
          new Date(b.weighed_at || b.created_at) - new Date(a.weighed_at || a.created_at)
      );

    if (priorForVehicle[0]) {
      setForm((prev) =>
        prev.gate_entry_id === form.gate_entry_id && prev.tare_weight === ""
          ? { ...prev, tare_weight: String(priorForVehicle[0].tare_weight) }
          : prev
      );
    }
  }, [form.gate_entry_id, slips.length]);

  const visibleSlips = useMemo(() => {
    if (tab === "pending") return slips.filter((s) => s.tare_weight == null || s.tare_weight === "");
    if (tab === "generated") return slips.filter((s) => s.tare_weight != null && s.tare_weight !== "");
    return slips;
  }, [tab, slips]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      if (editingId) {
        await updateWeightSlipApi(editingId, {
          gross_weight: Number(form.gross_weight),
          tare_weight: Number(form.tare_weight),
        });
        setInfo("Weight slip updated.");
      } else {
        const payload = {
          gate_entry_id: Number(form.gate_entry_id),
          slip_no: form.slip_no,
          gross_weight: Number(form.gross_weight),
        };
        if (form.tare_weight !== "" && form.tare_weight != null) payload.tare_weight = Number(form.tare_weight);
        if (form.weighed_at) payload.weighed_at = toIso(form.weighed_at);
        if (!isOtherEntry && form.final_rate !== "") payload.final_rate = Number(form.final_rate);

        await createWeightSlipApi(payload);
        if (payload.tare_weight == null) {
          setInfo(
            "First weight recorded — gate entry moved to in_process. Go to Unloading to start the manual unload."
          );
        } else {
          setInfo(
            isOtherEntry
              ? "Weight slip created — net weight computed, gate entry moved to in_process. Send it to Warehouse next."
              : "Weight slip created — net weight computed, purchase finalized, gate entry moved to in_process."
          );
        }
        gateEntries.refetch();
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — gate entry may not be ready to weigh yet (purchase entries need 'accepted'; empty/misc entries need 'waiting_weighment')."
      );
    }
  };

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

  const handleCancel = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this weight slip?")) return;
    try {
      await deleteWeightSlipApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Weighbridge</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && <div className="dt-success">{info}</div>}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={(id) => setForm({ ...form, gate_entry_id: id })}
          filter={(row) =>
            row.gate_status === "accepted" ||
            (row.entry_type === "other" && row.gate_status === "waiting_weighment")
          }
          required={!editingId}
          disabled={!!editingId}
        />
        <div className="sf-field">
          <label>Slip No.</label>
          <input
            name="slip_no"
            value={form.slip_no}
            onChange={handleChange}
            disabled={!!editingId}
            required={!editingId}
          />
        </div>
        <div className="sf-field">
          <label>First Weight (truck + load)</label>
          <input
            name="gross_weight"
            type="number"
            value={form.gross_weight}
            onChange={handleChange}
            required
          />
        </div>
        <div className="sf-field">
          <label>Second Weight (empty truck — must be less than first)</label>
          <input
            name="tare_weight"
            type="number"
            value={form.tare_weight}
            onChange={handleChange}
            required={!!editingId}
          />
          {!editingId && form.gate_entry_id && form.tare_weight !== "" && (
            <p className="field-hint">
              Auto-filled from this vehicle's last weighing — adjust if the truck's empty
              weight has changed.
            </p>
          )}
        </div>
        <div className="sf-field">
          <label>Net Weight (auto-calculated)</label>
          <input
            type="text"
            value={liveNetWeight === null ? "" : liveNetWeight}
            disabled
            placeholder="Enter first & second weight above"
            style={{
              fontWeight: 700,
              color: liveNetWeight !== null && liveNetWeight <= 0 ? "#b91c1c" : "#1d4ed8",
              background: "#f8fafc",
            }}
          />
          {liveNetWeight !== null && liveNetWeight <= 0 && (
            <p className="field-hint" style={{ color: "#b91c1c" }}>
              First weight must be greater than second weight.
            </p>
          )}
        </div>
        {!editingId && (
          <>
            <div className="sf-field">
              <label>Weighed At</label>
              <input
                name="weighed_at"
                type="datetime-local"
                value={form.weighed_at}
                onChange={handleChange}
              />
            </div>
            {!isOtherEntry && (
              <div className="sf-field">
                <label>Final Rate (only if this entry has no PO)</label>
                <input
                  name="final_rate"
                  type="number"
                  step="0.01"
                  value={form.final_rate}
                  onChange={handleChange}
                />
              </div>
            )}
            {isOtherEntry && (
              <p className="field-hint">
                This is an Empty/Misc truck — no purchase is finalized, no rate needed.
              </p>
            )}
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            {editingId
              ? "Update Weight Slip"
              : form.tare_weight === "" || form.tare_weight == null
              ? "Start Unloading"
              : "Generate Weight Slip"}
          </button>
          {editingId && (
            <button type="button" className="sf-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 8 }}>
        <button
          className={tab === "pending" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("pending")}
        >
          Pending
        </button>
        <button
          className={tab === "generated" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("generated")}
        >
          Slip Generated
        </button>
        <button
          className={tab === "all" ? "dt-btn" : "dt-btn dt-ghost"}
          onClick={() => setTab("all")}
        >
          All
        </button>
      </div>

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
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          {
            key: "vehicle",
            label: "Vehicle No.",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? vehicles.getLabel(ge.vehicle_id) : "—";
            },
          },
          {
            key: "driver",
            label: "Driver Name",
            render: (row) => {
              const ge = getGateEntryRow(row.gate_entry_id);
              return ge ? drivers.getLabel(ge.driver_id) : "—";
            },
          },
          { key: "gross_weight", label: "First Wt." },
          { key: "tare_weight", label: "Second Wt." },
          {
            key: "net_weight",
            label: "Net Wt.",
            render: (row) => (
              <strong style={{ color: "#1d4ed8" }}>
                {row.net_weight ?? row.gross_weight - row.tare_weight}
              </strong>
            ),
          },
          {
            key: "weighed_at",
            label: "Weighed At",
            render: (row) => (row.weighed_at ? new Date(row.weighed_at).toLocaleString() : "—"),
          },
          {
            key: "final_rate",
            label: "Final Rate",
            render: (row) => (row.final_rate != null ? `₹${row.final_rate}` : "— (from PO)"),
          },
        ]}
      />

      <ModuleGuide
        title="Weighbridge"
        steps={[
          "A purchase truck must already be marked 'accepted' by Quality before it can be weighed. An Empty/Misc truck just needs to be checked in ('waiting_weighment') — pick either from the Gate Entry dropdown above.",
          "Selecting a Gate Entry auto-fills Second Weight from that same vehicle's last weighing, if there is one — adjust it if the empty weight has changed.",
          "Enter the first weight (truck + load) from the weighbridge readout — Net Weight is calculated live as you type, no calculator needed.",
          "For a purchase truck, submitting finalizes the Purchase record and moves the gate entry on to 'in_process', ready for unloading in the Warehouse module. For an Empty/Misc truck, no purchase is created — it just moves to 'in_process', ready to be sent straight to Warehouse.",
          "If a purchase delivery has no linked Purchase Order, fill in Final Rate so the purchase can still be priced.",
        ]}
      />
    </div>
  );
}