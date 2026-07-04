import axiosInstance from "../../api/axiosInstance";

const BASE = "/maintenance";

export const getMaintenanceList = (params) => axiosInstance.get(BASE, { params });
export const getMaintenanceById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createMaintenance = (data) => axiosInstance.post(BASE, data);
export const updateMaintenance = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteMaintenance = (id) => axiosInstance.delete(`${BASE}/${id}`);
