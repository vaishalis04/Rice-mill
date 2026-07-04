import axiosInstance from "../../api/axiosInstance";

const BASE = "/gps";

export const getGpsTrackingList = (params) => axiosInstance.get(BASE, { params });
export const getGpsTrackingById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createGpsTracking = (data) => axiosInstance.post(BASE, data);
export const updateGpsTracking = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteGpsTracking = (id) => axiosInstance.delete(`${BASE}/${id}`);
