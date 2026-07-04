import axiosInstance from "../../api/axiosInstance";

const BASE = "/lab-tests";

export const getLaboratoryList = (params) => axiosInstance.get(BASE, { params });
export const getLaboratoryById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createLaboratory = (data) => axiosInstance.post(BASE, data);
export const updateLaboratory = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteLaboratory = (id) => axiosInstance.delete(`${BASE}/${id}`);
