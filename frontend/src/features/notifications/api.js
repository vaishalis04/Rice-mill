import axiosInstance from "../../api/axiosInstance";

const BASE = "/webhooks/whatsapp/notify";

export const getNotificationsList = (params) => axiosInstance.get(BASE, { params });
export const getNotificationsById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createNotifications = (data) => axiosInstance.post(BASE, data);
export const updateNotifications = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteNotifications = (id) => axiosInstance.delete(`${BASE}/${id}`);
