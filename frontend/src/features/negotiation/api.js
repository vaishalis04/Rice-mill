import axiosInstance from "../../api/axiosInstance";

const BASE = "/negotiations";

export const getNegotiationList = (params) => axiosInstance.get(BASE, { params });
export const getNegotiationById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createNegotiation = (data) => axiosInstance.post(BASE, data);
export const updateNegotiation = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteNegotiation = (id) => axiosInstance.delete(`${BASE}/${id}`);
