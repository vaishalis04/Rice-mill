import axiosInstance from "../../api/axiosInstance";

const BASE = "/invoices";

export const getAccountsFinanceList = (params) => axiosInstance.get(BASE, { params });
export const getAccountsFinanceById = (id) => axiosInstance.get(`${BASE}/${id}`);
export const createAccountsFinance = (data) => axiosInstance.post(BASE, data);
export const updateAccountsFinance = (id, data) => axiosInstance.patch(`${BASE}/${id}`, data);
export const deleteAccountsFinance = (id) => axiosInstance.delete(`${BASE}/${id}`);
