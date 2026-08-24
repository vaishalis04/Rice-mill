import { useState, useEffect } from "react";
import {
  getPurchaseOrdersGroupedApi,
  createPurchaseOrderBulkApi,
  addPurchaseOrderItemApi,
  updatePurchaseOrderApi,
  updatePurchaseOrderHeaderApi,
  deletePurchaseOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import { useEntityLookup } from "../../hooks/useEntityLookup";

// A Purchase Order can cover several materials from the same vendor — under
// the hood each material is still its own row sharing one po_no (so Gate →
// Weighbridge can track each material's delivery independently), but the
// UI here treats a po_no as ONE order: one row in the list, one edit panel
// that lets you keep adding materials to it, not several duplicate-looking
// rows for the same PO number.
const emptyHeader = { vendor_id: "", po_date: "", validity: "", do_no: "" };
const emptyItem = { material_id: "", variety_id: "", qty: "", rate: "" };

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]); // grouped: [{ po_no, vendor_id, vendor, po_date, validity, do_no, items:[...] }]
  const [loading, setLoading] = useState(true);
  const vendors = useEntityLookup("vendor");
  const materials = useEntityLookup("material");
  const varieties = useEntityLookup("variety");

  // "Cart" state for creating a brand-new multi-item PO.
  const [header, setHeader] = useState(emptyHeader);
  const [currentItem, setCurrentItem] = useState(emptyItem);
  const [cartItems, setCartItems] = useState([]);

  // Editing an EXISTING PO (by po_no) — header fields + its items, plus a
  // mini "add material" form that hits the server directly (each add is
  // its own request, since this PO already exists).
  const [editingPoNo, setEditingPoNo] = useState(null);
  const [editHeader, setEditHeader] = useState(emptyHeader);
  const [editItems, setEditItems] = useState([]); // [{ id, material_id, variety_id, qty, rate }]
  const [newItem, setNewItem] = useState(emptyItem);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    getPurchaseOrdersGroupedApi()
      .then((res) => setOrders(res.data.data ?? res.data))
      .catch(() => setError("Failed to load purchase orders"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleHeaderChange = (e) => setHeader({ ...header, [e.target.name]: e.target.value });
  const handleItemChange = (e) => setCurrentItem({ ...currentItem, [e.target.name]: e.target.value });
  const setItemField = (name) => (id) => setCurrentItem({ ...currentItem, [name]: id });
  const setHeaderField = (name) => (id) => setHeader({ ...header, [name]: id });

  const handleAddItem = () => {
    setError("");
    if (!currentItem.material_id || !currentItem.qty || !currentItem.rate) {
      setError("Pick a material and enter qty and rate before adding it to the PO.");
      return;
    }
    const dupe = cartItems.some(
      (i) => i.material_id === currentItem.material_id && i.variety_id === currentItem.variety_id
    );
    if (dupe) {
      setError("That material/variety combo is already in this PO — remove it first if you want to change the qty/rate.");
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
    if (!header.vendor_id || !header.po_date) {
      setError("Vendor and PO Date are required.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Add at least one material to the PO before submitting.");
      return;
    }
    try {
      const res = await createPurchaseOrderBulkApi({
        vendor_id: Number(header.vendor_id),
        po_date: header.po_date,
        validity: header.validity || undefined,
        do_no: header.do_no || undefined,
        items: cartItems.map((i) => ({
          material_id: Number(i.material_id),
          variety_id: i.variety_id ? Number(i.variety_id) : null,
          qty: Number(i.qty),
          rate: Number(i.rate),
        })),
      });
      setInfo(res.data.msg || "Purchase order created.");
      setHeader(emptyHeader);
      setCartItems([]);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Save failed");
    }
  };

  // ---- editing an existing PO (header + items) ----

  const handleEditPo = (po) => {
    setError("");
    setInfo("");
    setEditingPoNo(po.po_no);
    setEditHeader({
      vendor_id: po.vendor_id || "",
      po_date: po.po_date?.slice(0, 10) || "",
      validity: po.validity?.slice(0, 10) || "",
      do_no: po.do_no || "",
    });
    setEditItems(
      po.items.map((i) => ({
        id: i.id,
        material_id: i.material_id || "",
        variety_id: i.variety_id || "",
        qty: i.qty,
        rate: i.rate,
      }))
    );
    setNewItem(emptyItem);
  };

  const handleCancelEdit = () => {
    setEditingPoNo(null);
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
      await updatePurchaseOrderHeaderApi(editingPoNo, {
        vendor_id: editHeader.vendor_id ? Number(editHeader.vendor_id) : undefined,
        po_date: editHeader.po_date || undefined,
        validity: editHeader.validity || undefined,
        do_no: editHeader.do_no || undefined,
      });
      setInfo(`PO ${editingPoNo} details updated.`);
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not update PO details");
    }
  };

  const handleEditItemFieldChange = (itemId, field, value) => {
    setEditItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)));
  };

  const handleSaveItem = async (item) => {
    setError("");
    setInfo("");
    try {
      await updatePurchaseOrderApi(item.id, {
        material_id: Number(item.material_id),
        variety_id: item.variety_id ? Number(item.variety_id) : null,
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
    if (!window.confirm("Remove this material from the PO?")) return;
    setError("");
    setInfo("");
    try {
      await deletePurchaseOrderApi(itemId);
      setEditItems((prev) => prev.filter((it) => it.id !== itemId));
      setInfo("Material removed from the PO.");
      load();
    } catch {
      setError("Could not remove that line item");
    }
  };

  const handleNewItemChange = (e) => setNewItem({ ...newItem, [e.target.name]: e.target.value });
  const setNewItemField = (name) => (id) => setNewItem({ ...newItem, [name]: id });

  const handleAddItemToExistingPo = async () => {
    setError("");
    setInfo("");
    if (!newItem.material_id || !newItem.qty || !newItem.rate) {
      setError("Pick a material and enter qty and rate before adding it.");
      return;
    }
    try {
      const res = await addPurchaseOrderItemApi(editingPoNo, {
        material_id: Number(newItem.material_id),
        variety_id: newItem.variety_id ? Number(newItem.variety_id) : null,
        qty: Number(newItem.qty),
        rate: Number(newItem.rate),
      });
      const created = res.data.data;
      setEditItems((prev) => [
        ...prev,
        {
          id: created.id,
          material_id: created.material_id,
          variety_id: created.variety_id || "",
          qty: created.qty,
          rate: created.rate,
        },
      ]);
      setNewItem(emptyItem);
      setInfo(res.data.msg || "Material added to the PO.");
      load();
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.message || "Could not add that material");
    }
  };

  const handleDeleteWholePo = async (po) => {
    if (!window.confirm(`Delete PO ${po.po_no} and all ${po.items.length} of its material line(s)?`)) return;
    setError("");
    setInfo("");
    try {
      await Promise.all(po.items.map((i) => deletePurchaseOrderApi(i.id)));
      setInfo(`PO ${po.po_no} deleted.`);
      load();
    } catch {
      setError("Delete failed");
    }
  };

  // DataTable's built-in onDelete only passes the row's `id` (the grouped
  // row's synthetic id, i.e. its first line item) — look the full grouped
  // row back up so handleDeleteWholePo can remove every line under this po_no.
  const handleDeleteWholePoById = (id) => {
    const po = orders.find((o) => String(o.id) === String(id));
    if (po) handleDeleteWholePo(po);
  };

  const materialLabel = (id) => materials.getLabel(id);
  const varietyLabel = (id) => (id ? varieties.getLabel(id) : "—");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Purchase Orders</h2>
      {error && <div className="dt-error">{error}</div>}
      {info && (
        <div className="dt-error" style={{ background: "#eaf7ea", color: "#2b7a2b" }}>
          {info}
        </div>
      )}

      {editingPoNo ? (
        <div className="module-guide" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Editing PO {editingPoNo}</h3>

          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
            <EntitySelect
  entity="vendor"
  label="Vendor"
  value={editHeader.vendor_id}
  onChange={setEditHeaderField("vendor_id")}
  required
  creatable
  onCreated={vendors.refetch}
/>
            <div className="sf-field">
              <label>PO Date</label>
              <input name="po_date" type="date" value={editHeader.po_date} onChange={handleEditHeaderChange} required />
            </div>
            <div className="sf-field">
              <label>Validity (optional)</label>
              <input name="validity" type="date" value={editHeader.validity} onChange={handleEditHeaderChange} />
            </div>
            <div className="sf-field">
              <label>DO No. (optional)</label>
              <input name="do_no" value={editHeader.do_no} onChange={handleEditHeaderChange} />
            </div>
            <button type="button" className="sf-submit" onClick={handleSaveHeader}>
              Save PO Details
            </button>
          </form>

          <h4>Materials on this PO</h4>
          <div className="dt-wrapper">
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Variety</th>
                  <th>Qty (Tons)</th>
                  <th>Rate</th>
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
                    <td style={{ minWidth: 140 }}>
                      <EntitySelect
                        entity="variety"
                        value={item.variety_id}
                        onChange={(id) => handleEditItemFieldChange(item.id, "variety_id", id)}
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
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="dt-btn" onClick={() => handleSaveItem(item)}>Save</button>
                      <button className="dt-btn" onClick={() => handleRemoveExistingItem(item.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4>Add another material to this PO</h4>
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
            <EntitySelect
              entity="variety"
              label="Variety (optional)"
              value={newItem.variety_id}
              onChange={setNewItemField("variety_id")}
              creatable
            />
            <div className="sf-field">
              <label>Qty (Tons)</label>
              <input name="qty" type="number" value={newItem.qty} onChange={handleNewItemChange} />
            </div>
            <div className="sf-field">
              <label>Rate</label>
              <input name="rate" type="number" step="0.01" value={newItem.rate} onChange={handleNewItemChange} />
            </div>
            <button type="button" className="sf-submit" onClick={handleAddItemToExistingPo}>
              + Add Material to PO
            </button>
          </form>

          <button type="button" className="sf-cancel" onClick={handleCancelEdit}>
            Done Editing
          </button>
        </div>
      ) : (
        <>
          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
           <EntitySelect
  entity="vendor"
  label="Vendor"
  value={header.vendor_id}
  onChange={setHeaderField("vendor_id")}
  required
  creatable
  onCreated={vendors.refetch}
/>
            <div className="sf-field">
              <label>PO Date</label>
              <input name="po_date" type="date" value={header.po_date} onChange={handleHeaderChange} required />
            </div>
            <div className="sf-field">
              <label>Validity (optional)</label>
              <input name="validity" type="date" value={header.validity} onChange={handleHeaderChange} />
            </div>
            <div className="sf-field">
              <label>DO No. (optional)</label>
              <input name="do_no" value={header.do_no} onChange={handleHeaderChange} />
            </div>
          </form>

          <div className="module-guide" style={{ marginBottom: 16 }}>
            <h4>Add materials to this PO — one at a time, add as many as this vendor is supplying</h4>
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
              <EntitySelect
                entity="variety"
                label="Variety (optional)"
                value={currentItem.variety_id}
                onChange={setItemField("variety_id")}
                creatable
              />
              <div className="sf-field">
                <label>Qty (Tons)</label>
                <input name="qty" type="number" value={currentItem.qty} onChange={handleItemChange} />
              </div>
              <div className="sf-field">
                <label>Rate</label>
                <input name="rate" type="number" step="0.01" value={currentItem.rate} onChange={handleItemChange} />
              </div>
              <button type="button" className="sf-submit" onClick={handleAddItem}>
                + Add Material to PO
              </button>
            </form>

            {cartItems.length > 0 && (
              <div className="dt-wrapper" style={{ marginTop: 12 }}>
                <table className="dt-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Variety</th>
                    <th>Qty (Tons)</th>
                    <th>Rate</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item, i) => (
                    <tr key={i}>
                      <td>{materialLabel(item.material_id)}</td>
                      <td>{varietyLabel(item.variety_id)}</td>
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
              Create Purchase Order ({cartItems.length} item{cartItems.length === 1 ? "" : "s"})
            </button>
          </div>
        </>
      )}

      <DataTable
        loading={loading}
        rows={orders}
        onEdit={handleEditPo}
        onDelete={handleDeleteWholePoById}
        columns={[
          { key: "po_no", label: "PO No." },
          {
            key: "vendor",
            label: "Vendor",
            render: (row) => (row.vendor ? `${row.vendor.name} (${row.vendor.vendor_code})` : vendors.getLabel(row.vendor_id)),
          },
          {
            key: "materials",
            label: "Materials",
            render: (row) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {row.items.map((i) => (
                  <span key={i.id}>
                    {i.material?.name || materialLabel(i.material_id)}
                    {i.variety ? ` (${i.variety.variety_name})` : ""} — {i.qty} @ {i.rate}
                  </span>
                ))}
              </div>
            ),
          },
          {
            key: "total_qty",
            label: "Total Qty (Tons)",
            render: (row) => row.total_qty ?? row.items.reduce((s, i) => s + Number(i.qty), 0),
          },
          { key: "po_date", label: "PO Date" },
        ]}
      />

      <ModuleGuide
        title="multi-item Purchase Orders"
        steps={[
          "Pick the vendor and PO date once, then add as many materials/varieties as that vendor is supplying — each becomes its own line item under the same PO number.",
          "The PO number is generated automatically once you submit — you don't need to type one.",
          "The list below shows ONE row per PO, with all its materials listed together — not one confusing duplicate row per material.",
          "Edit opens that PO's full details: change vendor/date/DO No. once for the whole order, edit or remove any existing material line, and add more materials to it at any time — a PO stays editable until it's fully processed.",
          "Each line item still moves through Gate → Weighbridge independently, since each is its own material with its own quantity.",
          "There's no manual \"Convert\" step — once a truck against a line item is gated in, sampled, lab-accepted, and weighed, the Purchase record is created automatically.",
        ]}
      />
    </div>
  );
}