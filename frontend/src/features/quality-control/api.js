import axiosInstance from "../../api/axiosInstance";

const BASE = "/production-batches";

export const getQualityControlList = (params) => axiosInstance.get(BASE, { params });
export const getQualityControlById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createQualityControl = (data) => axiosInstance.post(BASE, data);
export const updateQualityControl = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteQualityControl = (id) => axiosInstance.delete(`${BASE}/${id}`);
