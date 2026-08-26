import axiosInstance from "./axiosInstance";

// ---------------- AUTH ----------------
export const loginApi = (email, password) =>
  axiosInstance.post("/auth/login", { email, password });

export const registerApi = (data) => axiosInstance.post("/auth/register", data);

export const getCurrentUserApi = () => axiosInstance.get("/auth/me");

export const logoutApi = () => axiosInstance.post("/auth/logout");

// ---------------- MASTER SETTINGS (role: admin) ----------------
export const createMasterSettingApi = (data) =>
  axiosInstance.post("/master-settings", data);

export const getMasterSettingsApi = (type) =>
  axiosInstance.get("/master-settings", { params: { type } });

export const getMasterSettingByIdApi = (id, type) =>
  axiosInstance.get(`/master-settings/${id}`, { params: { type } });

export const updateMasterSettingApi = (id, data) =>
  axiosInstance.put(`/master-settings/${id}`, data);

export const deleteMasterSettingApi = (id, type) =>
  axiosInstance.delete(`/master-settings/${id}`, { params: { type } });

// ---------------- VENDOR (role: purchase) ----------------
export const createVendorApi = (data) => axiosInstance.post("/vendors", data);
export const getVendorsApi = () => axiosInstance.get("/vendors");
export const getVendorByIdApi = (id) => axiosInstance.get(`/vendors/${id}`);
export const updateVendorApi = (id, data) =>
  axiosInstance.put(`/vendors/${id}`, data);
export const deleteVendorApi = (id) => axiosInstance.delete(`/vendors/${id}`);

// ---------------- VEHICLE / DRIVER (role: admin) ----------------
export const createVehicleDriverApi = (data) =>
  axiosInstance.post("/vehicles-drivers", data);

export const getVehiclesDriversApi = (type) =>
  axiosInstance.get("/vehicles-drivers", { params: { type } });

export const getVehicleDriverByIdApi = (id, type) =>
  axiosInstance.get(`/vehicles-drivers/${id}`, { params: { type } });

export const updateVehicleDriverApi = (id, data) =>
  axiosInstance.put(`/vehicles-drivers/${id}`, data);

export const deleteVehicleDriverApi = (id, type) =>
  axiosInstance.delete(`/vehicles-drivers/${id}`, { params: { type } });

// ---------------- PURCHASE ORDER (role: purchase) ----------------
export const createPurchaseOrderApi = (data) =>
  axiosInstance.post("/purchases", data);
export const createPurchaseOrderBulkApi = (data) =>
  axiosInstance.post("/purchases/bulk", data);
export const getPurchaseOrdersApi = () => axiosInstance.get("/purchases");

export const getPurchaseOrdersGroupedApi = () =>
  axiosInstance.get("/purchases/grouped");
export const getPurchaseOrderByIdApi = (id) =>
  axiosInstance.get(`/purchases/${id}`);
export const updatePurchaseOrderApi = (id, data) =>
  axiosInstance.put(`/purchases/${id}`, data);
export const deletePurchaseOrderApi = (id) =>
  axiosInstance.delete(`/purchases/${id}`);

export const getPurchaseOrderByPoNoApi = (po_no) =>
  axiosInstance.get(`/purchases/po/${po_no}`);
export const getPurchaseOrderPdfApi = (po_no) =>
  axiosInstance.get(`/purchases/po/${po_no}/pdf`, { responseType: "blob" });

export const addPurchaseOrderItemApi = (po_no, data) =>
  axiosInstance.post(`/purchases/po/${encodeURIComponent(po_no)}/items`, data);

export const updatePurchaseOrderHeaderApi = (po_no, data) =>
  axiosInstance.put(`/purchases/po/${encodeURIComponent(po_no)}/header`, data);

export const convertPurchaseApi = (data) =>
  axiosInstance.post("/purchases/convert", data);

// ---------------- GATE ENTRY (role: gate / gateman) ----------------
export const generateGateTokenApi = (data) =>
  axiosInstance.post("/gate/generatetoken", data);

export const gateCheckinApi = (id) =>
  axiosInstance.post("/gate/checkin", { id });

export const gateCheckoutApi = (id) =>
  axiosInstance.post("/gate/checkout", { id });

export const gateSendToWarehouseApi = (id, extra = {}) =>
  axiosInstance.post("/gate/send-to-warehouse", { id, ...extra });

// ---------------- LOADING (role: gate) ----------------
export const getLoadingsApi = (params = {}) =>
  axiosInstance.get("/loading", { params });

export const getLoadingByIdApi = (id) => axiosInstance.get(`/loading/${id}`);

export const createLoadingApi = (data) => axiosInstance.post("/loading", data);

export const updateLoadingApi = (id, data) =>
  axiosInstance.put(`/loading/${id}`, data);

export const deleteLoadingApi = (id) => axiosInstance.delete(`/loading/${id}`);

export const uploadGatePhotoApi = (photoBlob) => {
  const formData = new FormData();
  formData.append("photo", photoBlob, "driver-photo.jpg");

  return axiosInstance.post("/gate/upload-photo", formData, {
    headers: { "Content-Type": undefined },
  });
};

export const getGateEntriesApi = (status, entry_type) => {
  const params = {};
  if (status) params.status = status;
  if (entry_type) params.entry_type = entry_type;
  return axiosInstance.get("/gate", { params });
};

export const getGateEntryByIdApi = (id) => axiosInstance.get(`/gate/${id}`);

export const createGateEntryApi = (data) => axiosInstance.post("/gate", data); 

export const updateGateEntryApi = (id, data) =>
  axiosInstance.put(`/gate/${id}`, data);

export const deleteGateEntryApi = (id) => axiosInstance.delete(`/gate/${id}`);

// ---------------- SAMPLING (role: lab) ----------------
export const createSamplingApi = (data) =>
  axiosInstance.post("/sampling", data);

export const getSamplingsApi = (gate_entry_id) =>
  axiosInstance.get("/sampling", {
    params: gate_entry_id ? { gate_entry_id } : {},
  });

export const getSamplingByIdApi = (id) => axiosInstance.get(`/sampling/${id}`);

export const updateSamplingApi = (id, data) =>
  axiosInstance.put(`/sampling/${id}`, data);

export const deleteSamplingApi = (id) =>
  axiosInstance.delete(`/sampling/${id}`);

// ---------------- LAB TEST (role: lab) ----------------
export const createLabTestApi = (data) =>
  axiosInstance.post("/lab-tests", data);

export const getLabTestsApi = (params = {}) =>
  axiosInstance.get("/lab-tests", { params });

export const getLabTestByIdApi = (id) => axiosInstance.get(`/lab-tests/${id}`);

export const updateLabTestApi = (id, data) =>
  axiosInstance.put(`/lab-tests/${id}`, data);

export const updateLabTestVerdictApi = (id, verdict) =>
  axiosInstance.patch(`/lab-tests/${id}/verdict`, { verdict });

export const deleteLabTestApi = (id) =>
  axiosInstance.delete(`/lab-tests/${id}`);

// ---------------- NEGOTIATION (role: purchase) ----------------

export const createNegotiationApi = (data) =>
  axiosInstance.post("/negotiations", data);

export const getNegotiationsApi = (lab_test_id) =>
  axiosInstance.get("/negotiations", {
    params: lab_test_id ? { lab_test_id } : {},
  });

export const getNegotiationByIdApi = (id) =>
  axiosInstance.get(`/negotiations/${id}`);

export const updateNegotiationApi = (id, data) =>
  axiosInstance.put(`/negotiations/${id}`, data);

export const respondNegotiationApi = (id, vendor_response) =>
  axiosInstance.patch(`/negotiations/${id}/respond`, { vendor_response });

export const deleteNegotiationApi = (id) =>
  axiosInstance.delete(`/negotiations/${id}`);

// ---------------- CUSTOMERS (role: sales) ----------------
export const createCustomerApi = (data) =>
  axiosInstance.post("/customers", data);

export const getCustomersApi = (params = {}) =>
  axiosInstance.get("/customers", { params });

export const getCustomerByIdApi = (id) => axiosInstance.get(`/customers/${id}`);

export const getCustomerHistoryApi = (id) =>
  axiosInstance.get(`/customers/${id}/history`);

export const updateCustomerApi = (id, data) =>
  axiosInstance.put(`/customers/${id}`, data);

export const deleteCustomerApi = (id) =>
  axiosInstance.delete(`/customers/${id}`);

// ---------------- SALES ORDERS (role: sales) ----------------
export const createSalesOrderApi = (data) =>
  axiosInstance.post("/sales-orders", data);

export const createSalesOrderBulkApi = (data) =>
  axiosInstance.post("/sales-orders/bulk", data);

export const getSalesOrdersApi = (params = {}) =>
  axiosInstance.get("/sales-orders", { params });

export const getSalesOrdersGroupedApi = (params = {}) =>
  axiosInstance.get("/sales-orders/grouped", { params });

export const getSalesOrderByIdApi = (id) =>
  axiosInstance.get(`/sales-orders/${id}`);

export const updateSalesOrderApi = (id, data) =>
  axiosInstance.put(`/sales-orders/${id}`, data);

export const deleteSalesOrderApi = (id) =>
  axiosInstance.delete(`/sales-orders/${id}`);

export const addSalesOrderItemApi = (so_no, data) =>
  axiosInstance.post(
    `/sales-orders/so/${encodeURIComponent(so_no)}/items`,
    data,
  );

export const updateSalesOrderHeaderApi = (so_no, data) =>
  axiosInstance.put(
    `/sales-orders/so/${encodeURIComponent(so_no)}/header`,
    data,
  );

// ---------------- DISPATCH (role: dispatch) ----------------
export const createDispatchApi = (data) =>
  axiosInstance.post("/dispatch", data);

export const getDispatchesApi = (params = {}) =>
  axiosInstance.get("/dispatch", { params });

export const getDispatchByIdApi = (id) =>
  axiosInstance.get(`/dispatches/${id}`);

export const updateDispatchApi = (id, data) =>
  axiosInstance.put(`/dispatch/${id}`, data);

export const deleteDispatchApi = (id) =>
  axiosInstance.delete(`/dispatch/${id}`);

export const getDispatchChallanPdfApi = (id) =>
  axiosInstance.get(`/dispatch/${id}/challan`, { responseType: "blob" });

// ---------------- DASHBOARD (any logged-in role) ----------------
export const getDashboardKpisApi = () => axiosInstance.get("/dashboard/kpis");

export const getDailyIntakeTrendApi = (days) =>
  axiosInstance.get("/dashboard/daily-intake-trend", {
    params: days ? { days } : {},
  });

// ---------------- REPORTS (role: admin) ----------------
export const getGateRegisterReportApi = (params = {}) =>
  axiosInstance.get("/reports/gate-register", {
    params,
    responseType: params.format === "csv" ? "blob" : "json",
  });

export const getProductionSummaryReportApi = (params = {}) =>
  axiosInstance.get("/reports/production-summary", {
    params,
    responseType: params.format === "csv" ? "blob" : "json",
  });

export const getMaterialFlowReportApi = (params = {}) =>
  axiosInstance.get("/reports/material-flow", {
    params,
    responseType: params.format === "csv" ? "blob" : "json",
  });

// ---------------- PACKING (role: production) ----------------
export const getGradedOutputsApi = (batch_id) =>
  axiosInstance.get(`/packing/graded-outputs/${batch_id}`);

export const createPackingApi = (data) => axiosInstance.post("/packing", data);

export const getPackingsApi = (params = {}) =>
  axiosInstance.get("/packing", { params });

export const getPackingByIdApi = (id) => axiosInstance.get(`/packing/${id}`);

export const updatePackingApi = (id, data) =>
  axiosInstance.put(`/packing/${id}`, data);

export const deletePackingApi = (id) => axiosInstance.delete(`/packing/${id}`);

// ---------------- FINISHED GOODS (role: warehouse) ----------------
export const getFinishedGoodsApi = (params = {}) =>
  axiosInstance.get("/finished-goods", { params });

export const getFinishedGoodByIdApi = (id) =>
  axiosInstance.get(`/finished-goods/${id}`);

export const updateFinishedGoodApi = (id, data) =>
  axiosInstance.put(`/finished-goods/${id}`, data);

export const createFinishedGoodApi = (data) =>
  axiosInstance.post("/finished-goods", data);

export const deleteFinishedGoodApi = (id) =>
  axiosInstance.delete(`/finished-goods/${id}`);

export const flagAgingApi = () =>
  axiosInstance.post("/finished-goods/flag-aging");

// ---------------- MACHINES (role: production) ----------------
export const getMachinesApi = (params = {}) =>
  axiosInstance.get("/machines", { params });

export const getMachineByIdApi = (id, type = "master") =>
  axiosInstance.get(`/machines/${id}`, { params: { type } });

export const createMachineApi = (data) => axiosInstance.post("/machines", data);

export const updateMachineApi = (id, data) =>
  axiosInstance.put(`/machines/${id}`, data);

export const deleteMachineApi = (id, type) =>
  axiosInstance.delete(`/machines/${id}`, { params: { type } });

// ---------------- PRODUCTION BATCHES (role: production) ----------------
export const createProductionBatchApi = (data) =>
  axiosInstance.post("/production/batches", data);

export const getProductionBatchesApi = (params = {}) =>
  axiosInstance.get("/production/batches", { params });

export const getProductionBatchByIdApi = (id) =>
  axiosInstance.get(`/production/batches/${id}`);

export const updateProductionBatchApi = (id, data) =>
  axiosInstance.put(`/production/batches/${id}`, data);

export const deleteProductionBatchApi = (id) =>
  axiosInstance.delete(`/production/batches/${id}`);

export const finalizeProductionBatchApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/finalize`, data);

export const patchDryerStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/dryer`, data);

export const patchMillingStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/milling`, data);

export const patchSeparatorStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/separator`, data);

export const patchShinerStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/shiner`, data);

export const patchColorSorterStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/color-sorter`, data);

export const patchLengthGradingStageApi = (id, data) =>
  axiosInstance.patch(`/production/batches/${id}/length-grading`, data);

export const createWeightSlipApi = (data) =>
  axiosInstance.post("/weight-slips", data);

export const getWeightSlipsApi = (gate_entry_id) =>
  axiosInstance.get("/weight-slips", {
    params: gate_entry_id ? { gate_entry_id } : {},
  });

export const getWeightSlipByIdApi = (id) =>
  axiosInstance.get(`/weight-slips/${id}`);

export const updateWeightSlipApi = (id, data) =>
  axiosInstance.put(`/weight-slips/${id}`, data);

export const deleteWeightSlipApi = (id) =>
  axiosInstance.delete(`/weight-slips/${id}`);

export const startUnloadingApi = (data) =>
  axiosInstance.post("/lots/start-unloading", data);

export const completeUnloadingApi = (id, data) =>
  axiosInstance.patch(`/lots/${id}/complete-unloading`, data);

export const getLotsApi = (params = {}) =>
  axiosInstance.get("/lots", { params });

export const getLotByIdApi = (id) => axiosInstance.get(`/lots/${id}`);

export const updateLotApi = (id, data) =>
  axiosInstance.put(`/lots/${id}`, data);

export const routeLotApi = (id, destination) =>
  axiosInstance.patch(`/lots/${id}/route`, { destination });

export const deleteLotApi = (id) => axiosInstance.delete(`/lots/${id}`);

// ---------------- WAREHOUSE / BIN / STACK (role: warehouse) ----------------
export const createWarehouseSettingApi = (data) =>
  axiosInstance.post("/warehouse", data);

export const getWarehouseSettingsApi = (type) =>
  axiosInstance.get("/warehouse", { params: { type } });

export const getWarehouseSettingByIdApi = (id, type) =>
  axiosInstance.get(`/warehouse/${id}`, { params: { type } });

export const updateWarehouseSettingApi = (id, data) =>
  axiosInstance.put(`/warehouse/${id}`, data);

export const deleteWarehouseSettingApi = (id, type) =>
  axiosInstance.delete(`/warehouse/${id}`, { params: { type } });

export const getWarehouseStockApi = (params = {}) =>
  axiosInstance.get("/warehouse/stock", { params });

// ---------------- INVENTORY (read-only, role: warehouse) ----------------
export const getInventoryApi = (params = {}) =>
  axiosInstance.get("/inventory", { params });

export const getInventoryByIdApi = (id) =>
  axiosInstance.get(`/inventory/${id}`);

// ---------------- USERS (role: admin) ----------------
export const getUsersApi = (params = {}) =>
  axiosInstance.get("/users", { params });

export const getUserByIdApi = (id) => axiosInstance.get(`/users/${id}`);

export const createUserApi = (data) => axiosInstance.post("/users", data);

export const updateUserApi = (id, data) =>
  axiosInstance.put(`/users/${id}`, data);

export const deleteUserApi = (id) => axiosInstance.delete(`/users/${id}`);

export const getRolesApi = () => axiosInstance.get("/users/roles");

// ---------------- ANALYTICS (role: admin) ----------------
export const getAnalyticsSummaryApi = (params = {}) =>
  axiosInstance.get("/analytics/summary", { params });

export const getProductionTrendApi = (params = {}) =>
  axiosInstance.get("/analytics/production-trend", { params });

export const getMaterialFlowSnapshotApi = (params = {}) =>
  axiosInstance.get("/analytics/material-flow", { params });

export const getFleetSnapshotApi = (params = {}) =>
  axiosInstance.get("/analytics/fleet-snapshot", { params });

export const getGateActivityApi = (params = {}) =>
  axiosInstance.get("/analytics/gate-activity", { params });

// ---------------- PURCHASE ORDER APPROVAL (role: admin) ----------------

export const getPendingPurchaseOrdersApi = () =>
  axiosInstance.get("/purchases/pending-approval");

export const updatePurchaseOrderBeforeApprovalApi = (po_no, data) =>
  axiosInstance.put(
    `/purchases/po/${encodeURIComponent(po_no)}/approval-edit`,
    data,
  );

export const approvePurchaseOrderApi = (po_no) =>
  axiosInstance.patch(`/purchases/po/${encodeURIComponent(po_no)}/approve`);

export const rejectPurchaseOrderApi = (po_no, data) =>
  axiosInstance.patch(
    `/purchases/po/${encodeURIComponent(po_no)}/reject`,
    data,
  );

// ---------------- SALES ORDER APPROVAL (role: admin) ----------------
export const getPendingSalesOrdersApi = () =>
  axiosInstance.get("/sales-orders/pending-approval");

export const updateSalesOrderBeforeApprovalApi = (so_no, data) =>
  axiosInstance.put(
    `/sales-orders/so/${encodeURIComponent(so_no)}/approval-edit`,
    data,
  );

export const approveSalesOrderApi = (so_no) =>
  axiosInstance.patch(`/sales-orders/so/${encodeURIComponent(so_no)}/approve`);

export const rejectSalesOrderApi = (so_no, data) =>
  axiosInstance.patch(
    `/sales-orders/so/${encodeURIComponent(so_no)}/reject`,
    data,
  );

export const getGateEntryApi = (id) => {
  return api.get(`/gate-entries/${id}`);
};
