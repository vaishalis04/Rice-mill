// ============================================================
// api.js — ALL API calls for the app live here in one place.
// Add new endpoints as new sections below as the app grows
// (e.g. PADDY, INVENTORY, SALES sections).
// ============================================================
import axiosInstance from "./axiosInstance";

// ---------------- AUTH ----------------
export const loginApi = (email, password) =>
  axiosInstance.post("/auth/login", { email, password });

export const registerApi = (data) =>
  axiosInstance.post("/auth/register", data);

export const getCurrentUserApi = () => axiosInstance.get("/auth/me");

export const logoutApi = () => axiosInstance.post("/auth/logout");

// ---------------- USERS (example - edit/remove as needed) ----------------
export const getAllUsersApi = () => axiosInstance.get("/users");
export const getUserByIdApi = (id) => axiosInstance.get(`/users/${id}`);
export const updateUserApi = (id, data) =>
  axiosInstance.put(`/users/${id}`, data);
export const deleteUserApi = (id) => axiosInstance.delete(`/users/${id}`);

// ---------------- MASTER SETTINGS (role: admin) ----------------
// One set of routes for 7 sub-tables, selected via `type`:
// plant | material | variety | uom | rate | quality_parameter | reason_code
export const createMasterSettingApi = (data) =>
  axiosInstance.post("/master-settings", data); // data must include `type`

export const getMasterSettingsApi = (type) =>
  axiosInstance.get("/master-settings", { params: { type } });

export const getMasterSettingByIdApi = (id, type) =>
  axiosInstance.get(`/master-settings/${id}`, { params: { type } });

export const updateMasterSettingApi = (id, data) =>
  axiosInstance.put(`/master-settings/${id}`, data); // data must include `type`

export const deleteMasterSettingApi = (id, type) =>
  axiosInstance.delete(`/master-settings/${id}`, { params: { type } }); // soft delete

// ---------------- VENDOR (role: purchase) ----------------
export const createVendorApi = (data) => axiosInstance.post("/vendors", data);
export const getVendorsApi = () => axiosInstance.get("/vendors");
export const getVendorByIdApi = (id) => axiosInstance.get(`/vendors/${id}`);
export const updateVendorApi = (id, data) =>
  axiosInstance.put(`/vendors/${id}`, data);
export const deleteVendorApi = (id) => axiosInstance.delete(`/vendors/${id}`); // soft delete

// ---------------- VEHICLE / DRIVER (role: admin) ----------------
// One module fronting two tables, selected via `type`: vehicle | driver
export const createVehicleDriverApi = (data) =>
  axiosInstance.post("/vehicles-drivers", data); // data must include `type`

export const getVehiclesDriversApi = (type) =>
  axiosInstance.get("/vehicles-drivers", { params: { type } });

export const getVehicleDriverByIdApi = (id, type) =>
  axiosInstance.get(`/vehicles-drivers/${id}`, { params: { type } });

export const updateVehicleDriverApi = (id, data) =>
  axiosInstance.put(`/vehicles-drivers/${id}`, data); // data must include `type`

export const deleteVehicleDriverApi = (id, type) =>
  axiosInstance.delete(`/vehicles-drivers/${id}`, { params: { type } }); // soft delete

// ---------------- PURCHASE ORDER (role: purchase) ----------------
export const createPurchaseOrderApi = (data) =>
  axiosInstance.post("/purchases", data);
export const getPurchaseOrdersApi = () => axiosInstance.get("/purchases");
export const getPurchaseOrderByIdApi = (id) =>
  axiosInstance.get(`/purchases/${id}`);
export const updatePurchaseOrderApi = (id, data) =>
  axiosInstance.put(`/purchases/${id}`, data);
export const deletePurchaseOrderApi = (id) =>
  axiosInstance.delete(`/purchases/${id}`); // soft delete

// Converts a weighed gate entry into a final purchase.
// NOTE: will fail with "Invalid weight_slip_id" until the weighbridge
// module exists on the backend (per the API docs) — surface that error as-is.
export const convertPurchaseApi = (data) =>
  axiosInstance.post("/purchases/convert", data);

// ---------------- GATE ENTRY (role: gate / gateman) ----------------
export const generateGateTokenApi = (data) =>
  axiosInstance.post("/gate/generatetoken", data);

export const gateCheckinApi = (id) =>
  axiosInstance.post("/gate/checkin", { id });

export const gateCheckoutApi = (id) =>
  axiosInstance.post("/gate/checkout", { id });

export const getGateEntriesApi = (status) =>
  axiosInstance.get("/gate", { params: status ? { status } : {} });

export const getGateEntryByIdApi = (id) => axiosInstance.get(`/gate/${id}`);

export const createGateEntryApi = (data) => axiosInstance.post("/gate", data); // manual/admin create

export const updateGateEntryApi = (id, data) =>
  axiosInstance.put(`/gate/${id}`, data);

export const deleteGateEntryApi = (id) =>
  axiosInstance.delete(`/gate/${id}`); // soft delete

// ---------------- SAMPLING (role: lab) ----------------
// Precondition: gate entry must be at gate_status "waiting_sampling".
// On success the linked gate entry auto-moves to "sampling_done".
export const createSamplingApi = (data) =>
  axiosInstance.post("/sampling", data);

export const getSamplingsApi = (gate_entry_id) =>
  axiosInstance.get("/sampling", {
    params: gate_entry_id ? { gate_entry_id } : {},
  });

export const getSamplingByIdApi = (id) =>
  axiosInstance.get(`/sampling/${id}`);

export const updateSamplingApi = (id, data) =>
  axiosInstance.put(`/sampling/${id}`, data);

export const deleteSamplingApi = (id) =>
  axiosInstance.delete(`/sampling/${id}`); // soft delete

// ---------------- LAB TEST (role: lab) ----------------
// verdict must be one of: accepted | rejected | negotiation.
// Submitting (or later revising via /verdict) re-applies the gate-status rule:
// accepted -> lab_accepted, rejected -> rejected, negotiation -> unchanged (sampling_done)
export const createLabTestApi = (data) =>
  axiosInstance.post("/lab-tests", data);

// params can include { sampling_id } and/or { verdict }
export const getLabTestsApi = (params = {}) =>
  axiosInstance.get("/lab-tests", { params });

export const getLabTestByIdApi = (id) =>
  axiosInstance.get(`/lab-tests/${id}`);

export const updateLabTestApi = (id, data) =>
  axiosInstance.put(`/lab-tests/${id}`, data);

export const updateLabTestVerdictApi = (id, verdict) =>
  axiosInstance.patch(`/lab-tests/${id}/verdict`, { verdict });

export const deleteLabTestApi = (id) =>
  axiosInstance.delete(`/lab-tests/${id}`); // soft delete

// ---------------- NEGOTIATION (role: purchase) ----------------
// Only usable when the linked lab test's verdict is "negotiation".
// respond(accept) -> updates linked PurchaseOrder.rate to proposed_rate, gate entry -> lab_accepted
// respond(reject) -> gate entry -> rejected. Can only be responded to once.
export const createNegotiationApi = (data) =>
  axiosInstance.post("/negotiations", data);

export const getNegotiationsApi = (lab_test_id) =>
  axiosInstance.get("/negotiations", {
    params: lab_test_id ? { lab_test_id } : {},
  });

export const getNegotiationByIdApi = (id) =>
  axiosInstance.get(`/negotiations/${id}`);

export const updateNegotiationApi = (id, data) =>
  axiosInstance.put(`/negotiations/${id}`, data);

export const respondNegotiationApi = (id, vendor_response) =>
  axiosInstance.patch(`/negotiations/${id}/respond`, { vendor_response });

export const deleteNegotiationApi = (id) =>
  axiosInstance.delete(`/negotiations/${id}`); // soft delete

// ---------------- Add more sections below as your backend grows ----------

// ---------------- WEIGHBRIDGE / WEIGHT SLIPS (role: gate) ----------------
// Only works when the gate entry is at "accepted". Net weight is computed
// automatically, a Purchase record gets finalized, and the gate entry
// advances to "in_process". Pass final_rate in the body if the gate entry
// has no linked PO.
export const createWeightSlipApi = (data) =>
  axiosInstance.post("/weighbridge", data);

export const getWeightSlipsApi = (gate_entry_id) =>
  axiosInstance.get("/weighbridge", {
    params: gate_entry_id ? { gate_entry_id } : {},
  });

export const getWeightSlipByIdApi = (id) =>
  axiosInstance.get(`/weighbridge/${id}`);

export const updateWeightSlipApi = (id, data) =>
  axiosInstance.put(`/weighbridge/${id}`, data);

export const deleteWeightSlipApi = (id) =>
  axiosInstance.delete(`/weighbridge/${id}`); // soft delete

// ---------------- LOTS / UNLOADING (role: warehouse) ----------------
// Only works once the gate entry is "in_process" (weighed) with a
// finalized Purchase. Creating a lot also opens its Stack + Inventory.
export const createLotApi = (data) => axiosInstance.post("/lots", data);

export const getLotsApi = (params = {}) =>
  axiosInstance.get("/lots", { params });

export const getLotByIdApi = (id) => axiosInstance.get(`/lots/${id}`);

export const updateLotApi = (id, data) =>
  axiosInstance.put(`/lots/${id}`, data);

// destination: "warehouse" | "production" — either advances the linked
// gate entry to "unloaded".
export const routeLotApi = (id, destination) =>
  axiosInstance.patch(`/lots/${id}/route`, { destination });

export const deleteLotApi = (id) => axiosInstance.delete(`/lots/${id}`); // soft delete

// ---------------- WAREHOUSE / BIN / STACK (role: warehouse) ----------------
// One module fronting three tables, selected via `type`: warehouse | bin | stack
export const createWarehouseSettingApi = (data) =>
  axiosInstance.post("/warehouse", data); // data must include `type`

export const getWarehouseSettingsApi = (type) =>
  axiosInstance.get("/warehouse", { params: { type } });

export const getWarehouseSettingByIdApi = (id, type) =>
  axiosInstance.get(`/warehouse/${id}`, { params: { type } });

export const updateWarehouseSettingApi = (id, data) =>
  axiosInstance.put(`/warehouse/${id}`, data); // data must include `type`

export const deleteWarehouseSettingApi = (id, type) =>
  axiosInstance.delete(`/warehouse/${id}`, { params: { type } }); // soft delete

// Live Inventory balances joined with lot/material/warehouse — feeds the
// Warehouse page's stock table.
export const getWarehouseStockApi = (params = {}) =>
  axiosInstance.get("/warehouse/stock", { params });

// ---------------- INVENTORY (read-only, role: warehouse) ----------------
// create/update/delete/ledger are backend stubs for a later module — only
// list/get are wired up here.
export const getInventoryApi = (params = {}) =>
  axiosInstance.get("/inventory", { params });

export const getInventoryByIdApi = (id) =>
  axiosInstance.get(`/inventory/${id}`);
