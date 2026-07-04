import axiosInstance from "../../api/axiosInstance";

const BASE = "/by-products";

export const getByProductManagementList = (params) => axiosInstance.get(BASE, { params });
export const getByProductManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createByProductManagement = (data) => axiosInstance.post(BASE, data);
export const updateByProductManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteByProductManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
