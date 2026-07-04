import axiosInstance from "../../api/axiosInstance";

const BASE = "/dashboard/kpis";

export const getDashboardList = (params) => axiosInstance.get(BASE, { params });
export const getDashboardById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createDashboard = (data) => axiosInstance.post(BASE, data);
export const updateDashboard = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteDashboard = (id) => axiosInstance.delete(`${BASE}/${id}`);
