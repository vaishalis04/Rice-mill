import axiosInstance from "../../api/axiosInstance";

const BASE = "/inventory";

export const getInventoryList = (params) => axiosInstance.get(BASE, { params });
export const getInventoryById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createInventory = (data) => axiosInstance.post(BASE, data);
export const updateInventory = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteInventory = (id) => axiosInstance.delete(`${BASE}/${id}`);
