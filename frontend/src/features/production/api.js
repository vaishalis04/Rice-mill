import axiosInstance from "../../api/axiosInstance";

const BASE = "/production-batches";

export const getProductionList = (params) => axiosInstance.get(BASE, { params });
export const getProductionById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createProduction = (data) => axiosInstance.post(BASE, data);
export const updateProduction = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteProduction = (id) => axiosInstance.delete(`${BASE}/${id}`);
