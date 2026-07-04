import axiosInstance from "../../api/axiosInstance";

const BASE = "/production-batches";

export const getDryerManagementList = (params) => axiosInstance.get(BASE, { params });
export const getDryerManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createDryerManagement = (data) => axiosInstance.post(BASE, data);
export const updateDryerManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteDryerManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
