import axiosInstance from "../../api/axiosInstance";

const BASE = "/gate-entries";

export const getGateManagementList = (params) => axiosInstance.get(BASE, { params });
export const getGateManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createGateManagement = (data) => axiosInstance.post(BASE, data);
export const updateGateManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteGateManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
