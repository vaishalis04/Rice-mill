import axiosInstance from "../../api/axiosInstance";

const BASE = "/dispatches";

export const getDispatchList = (params) => axiosInstance.get(BASE, { params });
export const getDispatchById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createDispatch = (data) => axiosInstance.post(BASE, data);
export const updateDispatch = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteDispatch = (id) => axiosInstance.delete(`${BASE}/${id}`);
