import axiosInstance from "../../api/axiosInstance";

const BASE = "/settings";

export const getMasterSettingsList = (params) => axiosInstance.get(BASE, { params });
export const getMasterSettingsById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createMasterSettings = (data) => axiosInstance.post(BASE, data);
export const updateMasterSettings = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteMasterSettings = (id) => axiosInstance.delete(`${BASE}/${id}`);
