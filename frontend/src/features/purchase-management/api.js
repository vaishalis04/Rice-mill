import axiosInstance from "../../api/axiosInstance";

const BASE = "/purchases";

export const getPurchaseManagementList = (params) => axiosInstance.get(BASE, { params });
export const getPurchaseManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createPurchaseManagement = (data) => axiosInstance.post(BASE, data);
export const updatePurchaseManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deletePurchaseManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
