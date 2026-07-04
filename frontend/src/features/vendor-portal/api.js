import axiosInstance from "../../api/axiosInstance";

const BASE = "/vendor-portal";

export const getVendorPortalList = (params) => axiosInstance.get(BASE, { params });
export const getVendorPortalById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createVendorPortal = (data) => axiosInstance.post(BASE, data);
export const updateVendorPortal = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteVendorPortal = (id) => axiosInstance.delete(`${BASE}/${id}`);
