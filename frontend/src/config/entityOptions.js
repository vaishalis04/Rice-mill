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
  getPurchaseOrdersGroupedApi,
  createPurchaseOrderApi,
  getGateEntriesApi,
  getSamplingsApi,
  getLabTestsApi,
  getWarehouseSettingsApi,
  createWarehouseSettingApi,
  getLotsApi,
  getMachinesApi,
  createMachineApi,
  getProductionBatchesApi,
  getPackingsApi,
  getCustomersApi,
  createCustomerApi,
  getSalesOrdersApi,
  getSalesOrdersGroupedApi,
  getFinishedGoodsApi,
  getRolesApi,
} from "../api/api";
import { MATERIAL_CATEGORIES } from "../constants/materialCategories";
import { GRAIN_TYPES } from "../constants/grainTypes";

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
    fetch: async () => {
      const [vehicleRows, gateRows] = await Promise.all([
        getVehiclesDriversApi("vehicle").then(unwrap),
        getGateEntriesApi(undefined, undefined, 500).then(unwrap),
      ]);
      const exitedVehicleIds = new Set(
        (gateRows || [])
          .filter((row) => row.gate_status === "exited")
          .map((row) => String(row.vehicle_id))
          .filter(Boolean),
      );
      return (vehicleRows || []).filter(
        (row) => !exitedVehicleIds.has(String(row.id)),
      );
    },
    getLabel: (row) =>
      `${row.vehicle_no}${row.vehicle_type ? ` — ${row.vehicle_type}` : ""}`,
    quickCreate: {
      label: "Vehicle",
    fields: [
  {
    name: "vehicle_no",
    label: "Vehicle No.",
    required: true,
  },
  {
    name: "vehicle_type",
    label: "Vehicle Type",
    type: "select",
    required: true,
    placeholder: "Select Vehicle Type",
    options: [
      {
        value: "truck",
        label: "Truck",
      },
      {
        value: "tractor_trolley",
        label: "Tractor Trolley",
      },
    ],
  },
  {
    name: "capacity",
    label: "Capacity",
    type: "number",
  },
],
      create: (values) =>
        createVehicleDriverApi({ type: "vehicle", ...values }).then(unwrap),
    },
  },
  driver: {
    fetch: async () => {
      const [driverRows, gateRows] = await Promise.all([
        getVehiclesDriversApi("driver").then(unwrap),
        getGateEntriesApi(undefined, undefined, 500).then(unwrap),
      ]);
      const exitedDriverIds = new Set(
        (gateRows || [])
          .filter((row) => row.gate_status === "exited")
          .map((row) => String(row.driver_id))
          .filter(Boolean),
      );
      return (driverRows || []).filter(
        (row) => !exitedDriverIds.has(String(row.id)),
      );
    },
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
  // Not a real backend table — category is a free-text column on
  // material_master, not its own master. This "virtual" entity lets the
  // Category field behave like every other EntitySelect (search + a real
  // "+ Add new Category" option) by deriving its list from the defaults
  // plus whatever categories already exist on saved materials.
  material_category: {
    fetch: () =>
      getMasterSettingsApi("material")
        .then(unwrap)
        .then((materials) => {
          const used = (materials || [])
            .map((m) => m.category)
            .filter(Boolean);
          const all = Array.from(
            new Set([...MATERIAL_CATEGORIES.map((c) => c.value), ...used])
          );
          return all.map((v) => ({ id: v, name: v }));
        }),
    getLabel: (row) => row.name.charAt(0).toUpperCase() + row.name.slice(1),
    quickCreate: {
      label: "Category",
      fields: [{ name: "name", label: "Category Name", required: true }],
      // No API call — this isn't its own table, so "creating" a category
      // just means resolving it as a valid choice for right now. It's
      // properly persisted the moment the parent Material is saved with
      // this category value.
      create: (values) => {
        const v = String(values.name || "").trim().toLowerCase();
        if (!v) return Promise.reject(new Error("Category name is required"));
        return Promise.resolve({ id: v, name: v });
      },
    },
  },

  material: {
    fetch: () => getMasterSettingsApi("material").then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.material_code ? ` (${row.material_code})` : ""}`,
    quickCreate: {
      label: "Material",
      // material_code, name and category are all required by the backend
      // (controllers/masterSettings.controller.js — validateAndBuildPayload
      // for type "material"). category is a free-text field on the
      // backend (see materialMaster.model.js) rather than a locked enum,
      // so it's its own "material_category" entity here — giving it the
      // same "+ Add new Category" pattern Material itself has.
      fields: [
        { name: "name", label: "Name", required: true },
        { name: "material_code", label: "Material Code", required: true },
        {
          name: "category",
          label: "Category",
          type: "entity",
          entity: "material_category",
          required: true,
          creatable: true,
        },
      ],
      create: (values) =>
        createMasterSettingApi({ type: "material", ...values }).then(unwrap),
    },
  },
  variety: {
    fetch: () => getMasterSettingsApi("variety").then(unwrap),
    getLabel: (row) => row.variety_name,
    quickCreate: {
      label: "Variety",
      // Both required by the backend (controllers/masterSettings.controller.js,
      // type "variety"); variety_name must also be unique or the create call
      // is rejected with 409.
      fields: [
        { name: "variety_name", label: "Variety Name", required: true },
        {
          name: "grain_type",
          label: "Grain Type",
          type: "select",
          required: true,
          options: GRAIN_TYPES,
        },
      ],
      create: (values) =>
        createMasterSettingApi({ type: "variety", ...values }).then(unwrap),
    },
  },
  uom: {
    fetch: () => getMasterSettingsApi("uom").then(unwrap),
    getLabel: (row) => `${row.name}${row.uom_code ? ` (${row.uom_code})` : ""}`,
  },
  plant: {
    fetch: () => getMasterSettingsApi("plant").then(unwrap),
    getLabel: (row) => `${row.name}${row.plant_code ? ` (${row.plant_code})` : ""}`,
  },
  role: {
    fetch: () => getRolesApi().then(unwrap),
    getLabel: (row) => row.role_name,
  },
  purchase_order: {
    fetch: () => getPurchaseOrdersGroupedApi().then(unwrap),
    // One PO number, one line per material it covers — e.g.
    // "PO-20260818-002 — ABCD (101) — 2 materials: Polished Rice 15kg,
    // Jute Bag 20kg" so a multi-material PO reads as ONE order, not as
    // several confusingly-duplicated rows sharing the same PO number.
    // Falls back to a flat single-line label for a just-quick-created PO
    // (which doesn't have `items` yet, only the fields it was created with).
    getLabel: (row) => {
      const vendorLabel = row.vendor
        ? `${row.vendor.name}${row.vendor.vendor_code ? ` (${row.vendor.vendor_code})` : ""}`
        : "?";
      if (Array.isArray(row.items)) {
        const itemsSummary = row.items
          .map((i) => `${i.material?.name || "?"} ${i.qty}kg`)
          .join(", ");
        return `${row.po_no} — ${vendorLabel} — ${row.items.length === 1 ? "1 material" : `${row.items.length} materials`}: ${itemsSummary}`;
      }
      return `${row.po_no} — ${vendorLabel} — ${row.material?.name || "?"} ${row.qty ?? "?"}kg`;
    },
    quickCreate: {
      label: "Purchase Order",
      fields: [
        { name: "po_no", label: "PO No.", required: true },
        { name: "qty", label: "Qty (Tons)", type: "number", required: true },
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
  // The backend paginates /gate at 20 rows/page by default (entry_time
  // DESC). Every dropdown that looks up gate entries here — this one, plus
  // the "which vehicle/driver is exited" checks above — needs the whole
  // working set, not just page 1: once the mill has more than 20 gate
  // entries total (easy to hit fast), the entry someone actually needs
  // silently falls off page 1 and the dropdown shows "No matches" even
  // though the entry genuinely exists and is in the right status. The
  // explicit limit here is that fix — high enough to cover the working set
  // of open/recent entries without pulling the entire historical table.
  gate_entry: {
    fetch: () => getGateEntriesApi(undefined, undefined, 500).then(unwrap),
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
  machine: {
    fetch: () => getMachinesApi({ type: "master" }).then(unwrap),
    getLabel: (row) =>
      `${row.name}${row.machine_code ? ` (${row.machine_code})` : ""}`,
    quickCreate: {
      label: "Machine",
      fields: [
        { name: "machine_code", label: "Machine Code", required: true },
        { name: "name", label: "Name", required: true },
        { name: "machine_type", label: "Machine Type" },
        { name: "capacity_per_hr", label: "Capacity / hr", type: "number" },
      ],
      create: (values) =>
        createMachineApi({ type: "master", ...values }).then(unwrap),
    },
  },
  production_batch: {
    fetch: () => getProductionBatchesApi().then(unwrap),
    getLabel: (row) =>
      `${row.batch_no || `Batch #${row.id}`}${
        row.current_stage ? ` (${row.current_stage})` : ""
      }`,
  },
  packing: {
    fetch: () => getPackingsApi().then(unwrap),
    getLabel: (row) =>
      `${row.batch_no || `Packing #${row.id}`}${
        row.pack_size ? ` — ${row.pack_size}kg x${row.bag_count ?? "?"}` : ""
      }`,
  },
 customer: {
  fetch: () => getCustomersApi().then(unwrap),

  getLabel: (row) =>
    `${row.name}${row.customer_code ? ` (${row.customer_code})` : ""}`,

  quickCreate: {
    label: "Customer",

    fields: [
      { name: "name", label: "Name", required: true },
      { name: "gstin", label: "GSTIN" },
      { name: "address", label: "Address" },
    ],

    create: (values) =>
      createCustomerApi(values).then(unwrap),
  },
},
  sales_order: {
    fetch: () => getSalesOrdersApi().then(unwrap),
    getLabel: (row) => {
      const remaining = Number(row.qty || 0) - Number(row.dispatched_qty || 0);
      return `${row.so_no || `SO #${row.id}`} — ${row.customer?.name || "?"} — ${row.material?.name || "?"} (${remaining}/${row.qty ?? "?"}kg left) [${row.so_status}]`;
    },
  },
  // Grouped view: one SO number, one option per option list, with EVERY
  // material it covers nested under `items` — same idea as purchase_order
  // above. Used by Gate Entry's Sales Order picker so a multi-material SO
  // reads as ONE order, and every material on it can be shown/auto-selected
  // together rather than picking just one flat line.
  sales_order_grouped: {
    fetch: () => getSalesOrdersGroupedApi().then(unwrap),
    getLabel: (row) => {
      const customerLabel = row.customer
        ? `${row.customer.name}${row.customer.customer_code ? ` (${row.customer.customer_code})` : ""}`
        : "?";
      if (Array.isArray(row.items)) {
        const itemsSummary = row.items
          .map((i) => {
            const remaining = Number(i.qty || 0) - Number(i.dispatched_qty || 0);
            return `${i.material?.name || "?"} (${remaining}/${i.qty}kg left)`;
          })
          .join(", ");
        return `${row.so_no} — ${customerLabel} — ${row.items.length === 1 ? "1 material" : `${row.items.length} materials`}: ${itemsSummary}`;
      }
      return `${row.so_no} — ${customerLabel}`;
    },
  },
  // Only "ready" FG rows are ever pickable for dispatch — see DispatchPage,
  // which fetches this filtered rather than through useEntityLookup.
  finished_good: {
    fetch: () => getFinishedGoodsApi({ status: "ready" }).then(unwrap),
    getLabel: (row) =>
      `FG #${row.id} — ${row.qty ?? "?"}kg (${row.pack_size ?? "?"})`,
  },
};