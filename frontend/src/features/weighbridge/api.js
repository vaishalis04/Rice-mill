import axiosInstance from "../../api/axiosInstance";

const BASE = "/weight-slips";

export const getWeighbridgeList = (params) => axiosInstance.get(BASE, { params });
export const getWeighbridgeById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createWeighbridge = (data) => axiosInstance.post(BASE, data);
export const updateWeighbridge = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteWeighbridge = (id) => axiosInstance.delete(`${BASE}/${id}`);
