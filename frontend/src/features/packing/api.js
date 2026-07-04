import axiosInstance from "../../api/axiosInstance";

const BASE = "/packing";

export const getPackingList = (params) => axiosInstance.get(BASE, { params });
export const getPackingById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createPacking = (data) => axiosInstance.post(BASE, data);
export const updatePacking = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deletePacking = (id) => axiosInstance.delete(`${BASE}/${id}`);
