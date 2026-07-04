import axiosInstance from "../../api/axiosInstance";

const BASE = "/finished-goods";

export const getFinishedGoodsList = (params) => axiosInstance.get(BASE, { params });
export const getFinishedGoodsById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createFinishedGoods = (data) => axiosInstance.post(BASE, data);
export const updateFinishedGoods = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteFinishedGoods = (id) => axiosInstance.delete(`${BASE}/${id}`);
