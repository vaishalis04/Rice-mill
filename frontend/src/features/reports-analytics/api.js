import axiosInstance from "../../api/axiosInstance";

const BASE = "/reports";

export const getReportsAnalyticsList = (params) => axiosInstance.get(BASE, { params });
export const getReportsAnalyticsById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createReportsAnalytics = (data) => axiosInstance.post(BASE, data);
export const updateReportsAnalytics = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteReportsAnalytics = (id) => axiosInstance.delete(`${BASE}/${id}`);
