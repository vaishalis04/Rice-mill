import { useState, useEffect } from "react";
import {
  getLotsApi,
  createLotApi,
  updateLotApi,
  routeLotApi,
  deleteLotApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyForm = {
  gate_entry_id: "",
  warehouse_id: "",
  bin_id: "",
  // Optional overrides — left blank, the backend infers/defaults these
  // from the weight slip and gate entry / PO.
  qty: "",
  material_id: "",
  variety_id: "",
};

export default function LotsPage() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showOptional, setShowOptional] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const gateEntries = useEntityLookup("gate_entry");
  const warehouses = useEntityLookup("warehouse");
  const bins = useEntityLookup("bin");

  const load = () => {
    setLoading(true);
    getLotsApi()
      .then((res) => setLots(res.data.data ?? res.data))
      .catch(() => setError("Failed to load lots"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    try {
      const payload = {
        gate_entry_id: Number(form.gate_entry_id),
        warehouse_id: Number(form.warehouse_id),
        bin_id: Number(form.bin_id),
      };
      if (form.qty !== "") payload.qty = Number(form.qty);
      if (form.material_id !== "") payload.material_id = Number(form.material_id);
      if (form.variety_id !== "") payload.variety_id = Number(form.variety_id);

      const res = await createLotApi(payload);
      const lotNo = res.data.lot?.lot_no ?? res.data.data?.lot?.lot_no;
      setInfo(`Lot created${lotNo ? ` (${lotNo})` : ""} — stack and inventory opened.`);
      setForm(emptyForm);
      setShowOptional(false);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Save failed — gate entry may not be weighed (in_process) yet."
      );
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lot?")) return;
    try {
      await deleteLotApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  const handleRoute = async (id, destination) => {
    setError("");
    setInfo("");
    try {
      await routeLotApi(id, destination);
      setInfo(`Lot routed to ${destination} — linked gate entry moved to unloaded.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Routing failed");
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Lots / Unloading</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      <form className="sf-form" onSubmit={handleSubmit}>
        <EntitySelect
          entity="gate_entry"
          label="Gate Entry"
          value={form.gate_entry_id}
          onChange={(id) => setForm({ ...form, gate_entry_id: id })}
          filter={(row) => row.gate_status === "in_process"}
          required
        />
        <EntitySelect
          entity="warehouse"
          label="Warehouse"
          value={form.warehouse_id}
          onChange={(id) => setForm({ ...form, warehouse_id: id })}
          required
          creatable
        />
        <EntitySelect
          entity="bin"
          label="Bin"
          value={form.bin_id}
          onChange={(id) => setForm({ ...form, bin_id: id })}
          required
          creatable
          context={{ warehouse_id: form.warehouse_id }}
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
            <div className="sf-field">
              <label>Qty (defaults to weight slip's net weight)</label>
              <input
                name="qty"
                type="number"
                value={form.qty}
                onChange={handleChange}
              />
            </div>
            <EntitySelect
              entity="material"
              label="Material (defaults from gate entry / PO)"
              value={form.material_id}
              onChange={(id) => setForm({ ...form, material_id: id })}
            />
            <EntitySelect
              entity="variety"
              label="Variety"
              value={form.variety_id}
              onChange={(id) => setForm({ ...form, variety_id: id })}
            />
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="sf-submit" type="submit">
            Create Lot
          </button>
        </div>
      </form>

      <DataTable
        loading={loading}
        rows={lots}
        onDelete={handleDelete}
        columns={[
          { key: "lot_no", label: "Lot No." },
          {
            key: "gate_entry_id",
            label: "Gate Entry",
            render: (row) => gateEntries.getLabel(row.gate_entry_id),
          },
          {
            key: "warehouse_id",
            label: "Warehouse",
            render: (row) => warehouses.getLabel(row.warehouse_id),
          },
          {
            key: "bin_id",
            label: "Bin",
            render: (row) => bins.getLabel(row.bin_id),
          },
          { key: "qty", label: "Qty" },
          {
            key: "destination",
            label: "Destination",
            render: (row) =>
              row.destination ? (
                <span className="dt-badge">{row.destination}</span>
              ) : (
                <span style={{ color: "#a08c6b" }}>Not routed</span>
              ),
          },
          {
            key: "route_actions",
            label: "Route",
            render: (row) =>
              row.destination ? null : (
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
    </div>
  );
}
