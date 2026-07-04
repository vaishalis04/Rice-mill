import axiosInstance from "../../api/axiosInstance";

const BASE = "/vendors";

export const getVendorManagementList = (params) => axiosInstance.get(BASE, { params });
export const getVendorManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createVendorManagement = (data) => axiosInstance.post(BASE, data);
export const updateVendorManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteVendorManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
