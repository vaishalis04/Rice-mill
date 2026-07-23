// ============================================================
// entityOptions.js — one place that knows, for every "pick an ID
// from another table" field in the app, HOW to fetch the list and
// HOW to label each row in a dropdown.
//
// Used by <EntitySelect entity="vendor" .../> etc. Add a new entry
// here whenever a new foreign-key field needs a searchable dropdown.
// ============================================================
import {
  getVendorsApi,
  createVendorApi,
  getVehiclesDriversApi,
  createVehicleDriverApi,
  getMasterSettingsApi,
  createMasterSettingApi,
  getPurchaseOrdersApi,
  createPurchaseOrderApi,
  getGateEntriesApi,
  getSamplingsApi,
  getLabTestsApi,
  getWarehouseSettingsApi,
  createWarehouseSettingApi,
  getLotsApi,
} from "../api/api";

const unwrap = (res) => res.data.data ?? res.data;

export const ENTITY_OPTIONS = {
  vendor: {
    fetch: () => getVendorsApi().then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.vendor_code ? ` (${row.vendor_code})` : ""}`,
    // Lets EntitySelect offer "+ Add new Vendor" when the gateman (or anyone)
    // types a vendor that isn't in the list yet.
    quickCreate: {
      label: "Vendor",
      fields: [
        { name: "name", label: "Name", required: true },
        { name: "vendor_code", label: "Vendor Code" },
        { name: "gstin", label: "GSTIN" },
      ],
      create: (values) => createVendorApi(values).then(unwrap),
    },
  },
  vehicle: {
    fetch: () => getVehiclesDriversApi("vehicle").then(unwrap),
    getLabel: (row) =>
      `${row.vehicle_no}${row.vehicle_type ? ` — ${row.vehicle_type}` : ""}`,
    quickCreate: {
      label: "Vehicle",
      fields: [
        { name: "vehicle_no", label: "Vehicle No.", required: true },
        { name: "vehicle_type", label: "Vehicle Type" },
        { name: "capacity", label: "Capacity", type: "number" },
      ],
      create: (values) =>
        createVehicleDriverApi({ type: "vehicle", ...values }).then(unwrap),
    },
  },
  driver: {
    fetch: () => getVehiclesDriversApi("driver").then(unwrap),
    getLabel: (row) => `${row.name}${row.mobile ? ` (${row.mobile})` : ""}`,
    quickCreate: {
      label: "Driver",
      fields: [
        { name: "name", label: "Name", required: true },
        { name: "mobile", label: "Mobile" },
        { name: "license_no", label: "License No." },
      ],
      create: (values) =>
        createVehicleDriverApi({ type: "driver", ...values }).then(unwrap),
    },
  },
  material: {
    fetch: () => getMasterSettingsApi("material").then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.material_code ? ` (${row.material_code})` : ""}`,
    quickCreate: {
      label: "Material",
      fields: [
        { name: "name", label: "Name", required: true },
        { name: "material_code", label: "Material Code" },
        { name: "category", label: "Category" },
      ],
      create: (values) =>
        createMasterSettingApi({ type: "material", ...values }).then(unwrap),
    },
  },
  variety: {
    fetch: () => getMasterSettingsApi("variety").then(unwrap),
    getLabel: (row) => row.variety_name,
  },
  uom: {
    fetch: () => getMasterSettingsApi("uom").then(unwrap),
    getLabel: (row) => `${row.name}${row.uom_code ? ` (${row.uom_code})` : ""}`,
  },
  purchase_order: {
    fetch: () => getPurchaseOrdersApi().then(unwrap),
    getLabel: (row) => `${row.po_no}${row.rate ? ` — ₹${row.rate}` : ""}`,
    quickCreate: {
      label: "Purchase Order",
      fields: [
        { name: "po_no", label: "PO No.", required: true },
        { name: "qty", label: "Qty", type: "number", required: true },
        { name: "rate", label: "Rate", type: "number", required: true },
        { name: "po_date", label: "PO Date", type: "date" },
      ],
      // A PO always belongs to one vendor + one material. Rather than ask
      // for those again here, the caller must already have them selected
      // and pass them in via EntitySelect's `context` prop — see
      // requiresContext below. GateEntryPage passes {vendor_id, material_id}
      // from the rest of the Generate Token form.
      requiresContext: ["vendor_id", "material_id"],
      requiresContextMessage: "Select Vendor and Material above first",
      create: (values, context) =>
        createPurchaseOrderApi({
          ...values,
          vendor_id: context.vendor_id,
          material_id: context.material_id,
        }).then(unwrap),
    },
  },
  gate_entry: {
    fetch: () => getGateEntriesApi().then(unwrap),
    getLabel: (row) =>
      `${row.token_no || row.challan_no || `Entry #${row.id}`}${
        row.gate_status ? ` (${row.gate_status})` : ""
      }`,
  },
  sampling: {
    fetch: () => getSamplingsApi().then(unwrap),
    getLabel: (row) =>
      `${row.sample_code}${
        row.gate_entry_id ? ` — Gate Entry #${row.gate_entry_id}` : ""
      }`,
  },
  lab_test: {
    fetch: () => getLabTestsApi().then(unwrap),
    getLabel: (row) =>
      `Test #${row.id}${
        row.sampling_id ? ` — Sampling #${row.sampling_id}` : ""
      }${row.verdict ? ` (${row.verdict})` : ""}`,
  },
  warehouse: {
    fetch: () => getWarehouseSettingsApi("warehouse").then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.warehouse_code ? ` (${row.warehouse_code})` : ""}`,
    quickCreate: {
      label: "Warehouse",
      fields: [
        { name: "name", label: "Name", required: true },
        { name: "warehouse_code", label: "Warehouse Code", required: true },
        { name: "warehouse_type", label: "Warehouse Type" },
        { name: "capacity", label: "Capacity", type: "number" },
      ],
      create: (values) =>
        createWarehouseSettingApi({ type: "warehouse", ...values }).then(unwrap),
    },
  },
  bin: {
    fetch: () => getWarehouseSettingsApi("bin").then(unwrap),
    getLabel: (row) => row.bin_code,
    quickCreate: {
      label: "Bin",
      fields: [
        { name: "bin_code", label: "Bin Code", required: true },
        { name: "capacity", label: "Capacity", type: "number" },
      ],
      // A bin always belongs to a warehouse. Pass the chosen warehouse_id
      // in via EntitySelect's `context` prop (see requiresContext).
      requiresContext: ["warehouse_id"],
      requiresContextMessage: "Select a Warehouse above first",
      create: (values, context) =>
        createWarehouseSettingApi({
          type: "bin",
          ...values,
          warehouse_id: context.warehouse_id,
        }).then(unwrap),
    },
  },
  lot: {
    fetch: () => getLotsApi().then(unwrap),
    getLabel: (row) =>
      `${row.lot_no || `Lot #${row.id}`}${row.qty ? ` — ${row.qty}` : ""}`,
  },
};
