import axiosInstance from "../../api/axiosInstance";

const BASE = "/vehicles";

export const getVehicleManagementList = (params) => axiosInstance.get(BASE, { params });
export const getVehicleManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createVehicleManagement = (data) => axiosInstance.post(BASE, data);
export const updateVehicleManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteVehicleManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
