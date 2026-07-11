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

// ---------------- Add more sections below as your backend grows ----------
