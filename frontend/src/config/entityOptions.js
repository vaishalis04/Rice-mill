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
  getVehiclesDriversApi,
  getMasterSettingsApi,
  getPurchaseOrdersApi,
  getGateEntriesApi,
} from "../api/api";

const unwrap = (res) => res.data.data ?? res.data;

export const ENTITY_OPTIONS = {
  vendor: {
    fetch: () => getVendorsApi().then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.vendor_code ? ` (${row.vendor_code})` : ""}`,
  },
  vehicle: {
    fetch: () => getVehiclesDriversApi("vehicle").then(unwrap),
    getLabel: (row) =>
      `${row.vehicle_no}${row.vehicle_type ? ` — ${row.vehicle_type}` : ""}`,
  },
  driver: {
    fetch: () => getVehiclesDriversApi("driver").then(unwrap),
    getLabel: (row) => `${row.name}${row.mobile ? ` (${row.mobile})` : ""}`,
  },
  material: {
    fetch: () => getMasterSettingsApi("material").then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.material_code ? ` (${row.material_code})` : ""}`,
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
  },
  gate_entry: {
    fetch: () => getGateEntriesApi().then(unwrap),
    getLabel: (row) =>
      `${row.token_no || row.challan_no || `Entry #${row.id}`}${
        row.gate_status ? ` (${row.gate_status})` : ""
      }`,
  },
};
