import axiosInstance from "../../api/axiosInstance";

const BASE = "/sales-orders";

export const getSalesOrderList = (params) => axiosInstance.get(BASE, { params });
export const getSalesOrderById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createSalesOrder = (data) => axiosInstance.post(BASE, data);
export const updateSalesOrder = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteSalesOrder = (id) => axiosInstance.delete(`${BASE}/${id}`);
