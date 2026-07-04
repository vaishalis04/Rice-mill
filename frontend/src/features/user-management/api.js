import axiosInstance from "../../api/axiosInstance";

const BASE = "/users";

export const getUserManagementList = (params) => axiosInstance.get(BASE, { params });
export const getUserManagementById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createUserManagement = (data) => axiosInstance.post(BASE, data);
export const updateUserManagement = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteUserManagement = (id) => axiosInstance.delete(`${BASE}/${id}`);
