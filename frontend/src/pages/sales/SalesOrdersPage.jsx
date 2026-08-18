import { useState, useEffect } from "react";
import {
  getSalesOrdersGroupedApi,
  createSalesOrderBulkApi,
  addSalesOrderItemApi,
  updateSalesOrderApi,
  updateSalesOrderHeaderApi,
  deleteSalesOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// A Sales Order can cover several materials for the same customer — under
// the hood each material is still its own row sharing one so_no (so Gate ->
// Loading can track each material's dispatch independently), but the UI
// here treats a so_no as ONE order: one row in the list, one edit panel
// that lets you keep adding materials to it, not several duplicate-looking
// rows for the same SO number. Mirrors PurchaseOrdersPage.jsx.
const emptyHeader = { customer_id: "", order_type: "fg", order_date: "" };
const emptyItem = { material_id: "", qty: "", rate: "" };

// Confirmed from the doc: "confirmed" (on create) and "dispatched" (after
// dispatch). "closed"/"cancelled" are named in the KPI description
// ("not yet dispatched/closed/cancelled") so included as filter options too.
const STATUS_FILTERS = ["", "confirmed", "dispatched", "closed", "cancelled"];

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState([]); // grouped: [{ so_no, customer_id, customer, order_type, order_date, items:[...] }]
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const customers = useEntityLookup("customer");
  const materials = useEntityLookup("material");

  // "Cart" state for creating a brand-new multi-item SO.
  const [header, setHeader] = useState(emptyHeader);
  const [currentItem, setCurrentItem] = useState(emptyItem);
  const [cartItems, setCartItems] = useState([]);

  // Editing an EXISTING SO (by so_no) — header fields + its items, plus a
  // mini "add material" form that hits the server directly (each add is
  // its own request, since this SO already exists).
  const [editingSoNo, setEditingSoNo] = useState(null);
  const [editHeader, setEditHeader] = useState(emptyHeader);
  const [editItems, setEditItems] = useState([]); // [{ id, material_id, qty, rate, so_status }]
  const [newItem, setNewItem] = useState(emptyItem);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = (so_status = statusFilter) => {
    setLoading(true);
    const params = {};
    if (so_status) params.so_status = so_status;
    getSalesOrdersGroupedApi(params)
      .then((res) => setOrders(res.data.data ?? res.data))
      .catch(() => setError("Failed to load sales orders"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHeaderChange = (e) => setHeader({ ...header, [e.target.name]: e.target.value });
  const handleItemChange = (e) => setCurrentItem({ ...currentItem, [e.target.name]: e.target.value });
  const setItemField = (name) => (id) => setCurrentItem({ ...currentItem, [name]: id });
  const setHeaderField = (name) => (id) => setHeader({ ...header, [name]: id });

  const handleAddItem = () => {
    setError("");
    if (!currentItem.material_id || !currentItem.qty || !currentItem.rate) {
      setError("Pick a material and enter qty and rate before adding it to the SO.");
      return;
    }
    const dupe = cartItems.some((i) => i.material_id === currentItem.material_id);
    if (dupe) {
      setError("That material is already in this SO — remove it first if you want to change the qty/rate.");
      return;
    }
    setCartItems([...cartItems, currentItem]);
    setCurrentItem(emptyItem);
  };

  const handleRemoveItem = (index) => {
    setCartItems(cartItems.filter((_, i) => i !== index));
  };

  const handleSubmitCart = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!header.customer_id || !header.order_type) {
      setError("Customer and Order Type are required.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Add at least one material to the SO before submitting.");
      return;
    }
    try {
      const res = await createSalesOrderBulkApi({
        customer_id: Number(header.customer_id),
        order_type: header.order_type,
        order_date: header.order_date || undefined,
        items: cartItems.map((i) => ({
          material_id: Number(i.material_id),
          qty: Number(i.qty),
          rate: Number(i.rate),
        })),
      });
      setInfo(res.data.msg || "Sales order created.");
      setHeader(emptyHeader);
      setCartItems([]);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Save failed");
    }
  };

  // ---- editing an existing SO (header + items) ----

  const handleEditSo = (so) => {
    setError("");
    setInfo("");
    setEditingSoNo(so.so_no);
    setEditHeader({
      customer_id: so.customer_id || "",
      order_type: so.order_type || "fg",
      order_date: so.order_date?.slice(0, 10) || "",
    });
    setEditItems(
      so.items.map((i) => ({
        id: i.id,
        material_id: i.material_id || "",
        qty: i.qty,
        rate: i.rate,
        so_status: i.so_status,
      }))
    );
    setNewItem(emptyItem);
  };

  const handleCancelEdit = () => {
    setEditingSoNo(null);
    setEditHeader(emptyHeader);
    setEditItems([]);
    setNewItem(emptyItem);
  };

  const handleEditHeaderChange = (e) => setEditHeader({ ...editHeader, [e.target.name]: e.target.value });
  const setEditHeaderField = (name) => (id) => setEditHeader({ ...editHeader, [name]: id });

  const handleSaveHeader = async () => {
    setError("");
    setInfo("");
    try {
      await updateSalesOrderHeaderApi(editingSoNo, {
        customer_id: editHeader.customer_id ? Number(editHeader.customer_id) : undefined,
        order_type: editHeader.order_type || undefined,
        order_date: editHeader.order_date || undefined,
      });
      setInfo(`SO ${editingSoNo} details updated.`);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not update SO details");
    }
  };

  const handleEditItemFieldChange = (itemId, field, value) => {
    setEditItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)));
  };

  const handleSaveItem = async (item) => {
    setError("");
    setInfo("");
    try {
      await updateSalesOrderApi(item.id, {
        material_id: Number(item.material_id),
        qty: Number(item.qty),
        rate: Number(item.rate),
      });
      setInfo("Material line updated.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not update that line item");
    }
  };

  const handleRemoveExistingItem = async (itemId) => {
    if (!window.confirm("Remove this material from the SO?")) return;
    setError("");
    setInfo("");
    try {
      await deleteSalesOrderApi(itemId);
      setEditItems((prev) => prev.filter((it) => it.id !== itemId));
      setInfo("Material removed from the SO.");
      load();
    } catch {
      setError("Could not remove that line item");
    }
  };

  const handleNewItemChange = (e) => setNewItem({ ...newItem, [e.target.name]: e.target.value });
  const setNewItemField = (name) => (id) => setNewItem({ ...newItem, [name]: id });

  const handleAddItemToExistingSo = async () => {
    setError("");
    setInfo("");
    if (!newItem.material_id || !newItem.qty || !newItem.rate) {
      setError("Pick a material and enter qty and rate before adding it.");
      return;
    }
    try {
      const res = await addSalesOrderItemApi(editingSoNo, {
        material_id: Number(newItem.material_id),
        qty: Number(newItem.qty),
        rate: Number(newItem.rate),
      });
      const created = res.data.data;
      setEditItems((prev) => [
        ...prev,
        {
          id: created.id,
          material_id: created.material_id,
          qty: created.qty,
          rate: created.rate,
          so_status: created.so_status,
        },
      ]);
      setNewItem(emptyItem);
      setInfo(res.data.msg || "Material added to the SO.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not add that material");
    }
  };

  const handleDeleteWholeSo = async (so) => {
    if (!window.confirm(`Delete SO ${so.so_no} and all ${so.items.length} of its material line(s)?`)) return;
    setError("");
    setInfo("");
    try {
      await Promise.all(so.items.map((i) => deleteSalesOrderApi(i.id)));
      setInfo(`SO ${so.so_no} deleted.`);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  // DataTable's built-in onDelete only passes the row's `id` (the grouped
  // row's synthetic id, i.e. its first line item) — look the full grouped
  // row back up so handleDeleteWholeSo can remove every line under this so_no.
  const handleDeleteWholeSoById = (id) => {
    const so = orders.find((o) => String(o.id) === String(id));
    if (so) handleDeleteWholeSo(so);
  };

  // Cancel/Close a single material line within an SO — the backend has
  // always supported these statuses via PUT, applied per line item (each
  // material on an SO can be at a different stage of its own delivery).
  const handleStatusChange = async (item, so, newStatus) => {
    const verb = newStatus === "cancelled" ? "cancel" : "close";
    if (!window.confirm(`Are you sure you want to ${verb} the ${item.material?.name || "material"} line on ${so.so_no}?`)) return;
    setError("");
    try {
      await updateSalesOrderApi(item.id, { so_status: newStatus });
      setInfo(`${so.so_no} — ${item.material?.name || "material"} marked ${newStatus}.`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to mark line item ${newStatus}`);
    }
  };

  const materialLabel = (id) => materials.getLabel(id);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Sales Orders</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {editingSoNo ? (
        <div className="module-guide" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Editing SO {editingSoNo}</h3>

          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
            <EntitySelect
              entity="customer"
              label="Customer"
              value={editHeader.customer_id}
              onChange={setEditHeaderField("customer_id")}
              required
            />
            <div className="sf-field">
              <label>Order Type</label>
              <select name="order_type" value={editHeader.order_type} onChange={handleEditHeaderChange}>
                <option value="fg">Finished Goods (fg)</option>
                <option value="by_product">By-Product</option>
              </select>
            </div>
            <div className="sf-field">
              <label>Order Date</label>
              <input name="order_date" type="date" value={editHeader.order_date} onChange={handleEditHeaderChange} />
            </div>
            <button type="button" className="sf-submit" onClick={handleSaveHeader}>
              Save SO Details
            </button>
          </form>

          <h4>Materials on this SO</h4>
          <div className="dt-wrapper">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {editItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ minWidth: 160 }}>
                      <EntitySelect
                        entity="material"
                        value={item.material_id}
                        onChange={(id) => handleEditItemFieldChange(item.id, "material_id", id)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={item.qty}
                        style={{ width: 90 }}
                        onChange={(e) => handleEditItemFieldChange(item.id, "qty", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={item.rate}
                        style={{ width: 90 }}
                        onChange={(e) => handleEditItemFieldChange(item.id, "rate", e.target.value)}
                      />
                    </td>
                    <td>
                      <span className="dt-badge">{item.so_status}</span>
                    </td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="dt-btn" onClick={() => handleSaveItem(item)}>Save</button>
                      <button className="dt-btn" onClick={() => handleRemoveExistingItem(item.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4>Add another material to this SO</h4>
          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
            <EntitySelect
              entity="material"
              label="Material"
              value={newItem.material_id}
              onChange={setNewItemField("material_id")}
              required
              creatable
              onCreated={materials.refetch}
            />
            <div className="sf-field">
              <label>Qty</label>
              <input name="qty" type="number" value={newItem.qty} onChange={handleNewItemChange} />
            </div>
            <div className="sf-field">
              <label>Rate</label>
              <input name="rate" type="number" step="0.01" value={newItem.rate} onChange={handleNewItemChange} />
            </div>
            <button type="button" className="sf-submit" onClick={handleAddItemToExistingSo}>
              + Add Material to SO
            </button>
          </form>

          <button type="button" className="sf-cancel" onClick={handleCancelEdit}>
            Done Editing
          </button>
        </div>
      ) : (
        <>
          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
            <h3 style={{ width: "100%", marginBottom: 0 }}>New Sales Order</h3>
            <EntitySelect entity="customer" label="Customer" value={header.customer_id} onChange={setHeaderField("customer_id")} required creatable />
            <div className="sf-field">
              <label>Order Type</label>
              <select name="order_type" value={header.order_type} onChange={handleHeaderChange}>
                <option value="fg">Finished Goods (fg)</option>
                <option value="by_product">By-Product</option>
              </select>
            </div>
            <div className="sf-field">
              <label>Order Date (optional)</label>
              <input name="order_date" type="date" value={header.order_date} onChange={handleHeaderChange} />
            </div>
          </form>

          <div className="module-guide" style={{ marginBottom: 16 }}>
            <h4>Add materials to this SO — one at a time, add as many as this customer is ordering</h4>
            <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
              <EntitySelect
                entity="material"
                label="Material"
                value={currentItem.material_id}
                onChange={setItemField("material_id")}
                required
                creatable
                onCreated={materials.refetch}
              />
              <div className="sf-field">
                <label>Qty</label>
                <input name="qty" type="number" value={currentItem.qty} onChange={handleItemChange} />
              </div>
              <div className="sf-field">
                <label>Rate</label>
                <input name="rate" type="number" step="0.01" value={currentItem.rate} onChange={handleItemChange} />
              </div>
              <button type="button" className="sf-submit" onClick={handleAddItem}>
                + Add Material to SO
              </button>
            </form>

            {cartItems.length > 0 && (
              <div className="dt-wrapper" style={{ marginTop: 12 }}>
                <table className="dt-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item, i) => (
                    <tr key={i}>
                      <td>{materialLabel(item.material_id)}</td>
                      <td>{item.qty}</td>
                      <td>{item.rate}</td>
                      <td>
                        <button className="dt-btn" onClick={() => handleRemoveItem(i)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            )}

            <button
              className="sf-submit"
              style={{ marginTop: 12 }}
              onClick={handleSubmitCart}
              disabled={cartItems.length === 0}
            >
              Create Sales Order ({cartItems.length} item{cartItems.length === 1 ? "" : "s"})
            </button>
          </div>
        </>
      )}

      <div className="section-tabs">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={`section-tab ${statusFilter === s ? "active" : ""}`}
            onClick={() => {
              setStatusFilter(s);
              load(s);
            }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading}
        rows={orders}
        onEdit={handleEditSo}
        onDelete={handleDeleteWholeSoById}
        columns={[
          { key: "so_no", label: "SO No." },
          {
            key: "customer",
            label: "Customer",
            render: (row) => (row.customer ? `${row.customer.name} (${row.customer.customer_code})` : customers.getLabel(row.customer_id)),
          },
          {
            key: "materials",
            label: "Materials",
            render: (row) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {row.items.map((i) => (
                  <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>
                      {i.material?.name || materialLabel(i.material_id)} — {i.qty} @ ₹{i.rate}
                    </span>
                    <span className="dt-badge">{i.so_status}</span>
                    {["pending", "confirmed"].includes(i.so_status) && (
                      <button className="dt-btn" onClick={() => handleStatusChange(i, row, "cancelled")}>
                        Cancel
                      </button>
                    )}
                    {i.so_status === "dispatched" && (
                      <button className="dt-btn" onClick={() => handleStatusChange(i, row, "closed")}>
                        Close
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: "total_qty",
            label: "Total Qty",
            render: (row) => row.total_qty ?? row.items.reduce((s, i) => s + Number(i.qty), 0),
          },
          { key: "order_date", label: "Order Date" },
        ]}
      />

      <ModuleGuide
        title="multi-item Sales Orders"
        steps={[
          "Pick the customer, order type and order date once, then add as many materials as that customer is ordering — each becomes its own line item under the same SO number.",
          "The SO number is generated automatically once you submit — you don't need to type one.",
          "The list below shows ONE row per SO, with all its materials listed together — not one confusing duplicate row per material.",
          "Edit opens that SO's full details: change customer/order type/date once for the whole order, edit or remove any existing material line, and add more materials to it at any time.",
          "Each material line still moves through Gate → Loading independently, since each is its own material with its own quantity and status.",
          "Cancel/Close apply per material line, since different materials on the same SO can be at different stages of delivery.",
        ]}
      />
    </div>
  );
}