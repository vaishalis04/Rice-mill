import axiosInstance from "../../api/axiosInstance";

const BASE = "/machine-logs";

export const getMachineManagementList = (params) => axiosInstance.get(BASE, { params });
export const getMachineManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createMachineManagement = (data) => axiosInstance.post(BASE, data);
export const updateMachineManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteMachineManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
