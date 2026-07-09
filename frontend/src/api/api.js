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

// ---------------- Add more sections below as your backend grows ----------
// export const getPaddyStockApi = () => axiosInstance.get("/paddy/stock");
// export const createSaleApi = (data) => axiosInstance.post("/sales", data);
