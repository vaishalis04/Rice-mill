import { useState, useEffect } from "react";
import {
  getPurchaseOrdersApi,
  createPurchaseOrderBulkApi,
  updatePurchaseOrderApi,
  deletePurchaseOrderApi,
} from "../../api/api";
import DataTable from "../../components/DataTable";
import EntitySelect from "../../components/EntitySelect";
import ModuleGuide from "../../components/ModuleGuide";
import PurchaseOrderDetailModal from "../../components/PurchaseOrderDetailModal";
import { useEntityLookup } from "../../hooks/useEntityLookup";

const emptyHeader = { vendor_id: "", po_date: "", validity: "", do_no: "" };
const emptyItem = { material_id: "", variety_id: "", qty: "", rate: "" };
const emptyEditForm = {
  po_no: "",
  vendor_id: "",
  material_id: "",
  variety_id: "",
  qty: "",
  rate: "",
  po_date: "",
};

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const vendors = useEntityLookup("vendor");
  const materials = useEntityLookup("material");
  const varieties = useEntityLookup("variety");

  // "Cart" state for creating a new multi-item PO.
  const [header, setHeader] = useState(emptyHeader);
  const [currentItem, setCurrentItem] = useState(emptyItem);
  const [cartItems, setCartItems] = useState([]);

  // Single-row edit state, used only when editing one existing line item.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);

  // po_no currently open in the View modal, or null when closed.
  const [viewingPoNo, setViewingPoNo] = useState(null);

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    getPurchaseOrdersApi()
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
      setError(err.response?.data?.message || "Save failed");
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setEditForm({
      po_no: row.po_no || "",
      vendor_id: row.vendor_id || "",
      material_id: row.material_id || "",
      variety_id: row.variety_id || "",
      qty: row.qty || "",
      rate: row.rate || "",
      po_date: row.po_date?.slice(0, 10) || "",
    });
  };

  const handleEditChange = (e) => setEditForm({ ...editForm, [e.target.name]: e.target.value });
  const setEditField = (name) => (id) => setEditForm({ ...editForm, [name]: id });

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await updatePurchaseOrderApi(editingId, {
        ...editForm,
        vendor_id: Number(editForm.vendor_id),
        material_id: Number(editForm.material_id),
        variety_id: editForm.variety_id ? Number(editForm.variety_id) : null,
        qty: Number(editForm.qty),
        rate: Number(editForm.rate),
      });
      setInfo("Line item updated.");
      setEditingId(null);
      setEditForm(emptyEditForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || "Update failed");
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyEditForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this PO line item?")) return;
    try {
      await deletePurchaseOrderApi(id);
      load();
    } catch {
      setError("Delete failed");
    }
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

      {editingId ? (
        <form className="sf-form" onSubmit={handleUpdateSubmit}>
          <h3 style={{ width: "100%" }}>Edit line item — {editForm.po_no}</h3>
          <EntitySelect entity="vendor" label="Vendor" value={editForm.vendor_id} onChange={setEditField("vendor_id")} required />
          <EntitySelect entity="material" label="Material" value={editForm.material_id} onChange={setEditField("material_id")} required creatable onCreated={materials.refetch} />
          <EntitySelect entity="variety" label="Variety" value={editForm.variety_id} onChange={setEditField("variety_id")} creatable />
          <div className="sf-field">
            <label>Qty</label>
            <input name="qty" type="number" value={editForm.qty} onChange={handleEditChange} required />
          </div>
          <div className="sf-field">
            <label>Rate</label>
            <input name="rate" type="number" step="0.01" value={editForm.rate} onChange={handleEditChange} required />
          </div>
          <div className="sf-field">
            <label>PO Date</label>
            <input name="po_date" type="date" value={editForm.po_date} onChange={handleEditChange} required />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" type="submit">Update Line Item</button>
            <button type="button" className="sf-cancel" onClick={handleCancelEdit}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <form className="sf-form" onSubmit={(e) => e.preventDefault()}>
            <h3 style={{ width: "100%", marginBottom: 0 }}>New Purchase Order</h3>
            <EntitySelect entity="vendor" label="Vendor" value={header.vendor_id} onChange={setHeaderField("vendor_id")} required />
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
                <label>Qty</label>
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
              <table className="dt-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Variety</th>
                    <th>Qty</th>
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
        onEdit={handleEdit}
        onDelete={handleDelete}
        columns={[
          { key: "po_no", label: "PO No." },
          {
            key: "vendor_id",
            label: "Vendor",
            render: (row) => vendors.getLabel(row.vendor_id),
          },
          {
            key: "material_id",
            label: "Material",
            render: (row) => materials.getLabel(row.material_id),
          },
          {
            key: "variety_id",
            label: "Variety",
            render: (row) => varietyLabel(row.variety_id),
          },
          { key: "qty", label: "Qty" },
          { key: "rate", label: "Rate" },
          { key: "po_date", label: "PO Date" },
          {
            key: "view_action",
            label: "",
            render: (row) => (
              <button className="dt-btn" onClick={() => setViewingPoNo(row.po_no)}>
                View
              </button>
            ),
          },
        ]}
      />

      {viewingPoNo && (
        <PurchaseOrderDetailModal poNo={viewingPoNo} onClose={() => setViewingPoNo(null)} />
      )}

      <ModuleGuide
        title="multi-item Purchase Orders"
        steps={[
          "Pick the vendor and PO date once, then add as many materials/varieties as that vendor is supplying — each becomes its own line item under the same PO number.",
          "The PO number is generated automatically once you submit — you don't need to type one.",
          "Click View on any row to see every line item under that PO together, with a total amount, and download it as a PDF from there.",
          "Each line item still moves through Gate → Weighbridge independently, since each is its own material with its own quantity.",
          "There's no manual \"Convert\" step — once a truck against a line item is gated in, sampled, lab-accepted, and weighed, the Purchase record is created automatically.",
        ]}
      />
    </div>
  );
}