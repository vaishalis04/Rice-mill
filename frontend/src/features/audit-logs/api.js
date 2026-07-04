import axiosInstance from "../../api/axiosInstance";

const BASE = "/audit-logs";

export const getAuditLogsList = (params) => axiosInstance.get(BASE, { params });
export const getAuditLogsById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createAuditLogs = (data) => axiosInstance.post(BASE, data);
export const updateAuditLogs = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteAuditLogs = (id) => axiosInstance.delete(`${BASE}/${id}`);
