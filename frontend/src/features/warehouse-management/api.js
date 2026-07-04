import axiosInstance from "../../api/axiosInstance";

const BASE = "/stacks";

export const getWarehouseManagementList = (params) => axiosInstance.get(BASE, { params });
export const getWarehouseManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createWarehouseManagement = (data) => axiosInstance.post(BASE, data);
export const updateWarehouseManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteWarehouseManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
