import axiosInstance from "../../api/axiosInstance";

const BASE = "/sampling";

export const getSamplingList = (params) => axiosInstance.get(BASE, { params });
export const getSamplingById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createSampling = (data) => axiosInstance.post(BASE, data);
export const updateSampling = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteSampling = (id) => axiosInstance.delete(`${BASE}/${id}`);
