import { Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import { GateManagementList, GateManagementForm, GateManagementDetail } from "../features/gate-management";
import { VendorPortalList, VendorPortalForm, VendorPortalDetail } from "../features/vendor-portal";
import { VendorManagementList, VendorManagementForm, VendorManagementDetail } from "../features/vendor-management";
import { PurchaseManagementList, PurchaseManagementForm, PurchaseManagementDetail } from "../features/purchase-management";
import { SamplingList, SamplingForm, SamplingDetail } from "../features/sampling";
import { LaboratoryList, LaboratoryForm, LaboratoryDetail } from "../features/laboratory";
import { NegotiationList, NegotiationForm, NegotiationDetail } from "../features/negotiation";
import { WeighbridgeList, WeighbridgeForm, WeighbridgeDetail } from "../features/weighbridge";
import { WarehouseManagementList, WarehouseManagementForm, WarehouseManagementDetail } from "../features/warehouse-management";
import { InventoryList, InventoryForm, InventoryDetail } from "../features/inventory";
import { ProductionList, ProductionForm, ProductionDetail } from "../features/production";
import { DryerManagementList, DryerManagementForm, DryerManagementDetail } from "../features/dryer-management";
import { MachineManagementList, MachineManagementForm, MachineManagementDetail } from "../features/machine-management";
import { QualityControlList, QualityControlForm, QualityControlDetail } from "../features/quality-control";
import { ByProductManagementList, ByProductManagementForm, ByProductManagementDetail } from "../features/by-product-management";
import { PackingList, PackingForm, PackingDetail } from "../features/packing";
import { FinishedGoodsList, FinishedGoodsForm, FinishedGoodsDetail } from "../features/finished-goods";
import { SalesOrderList, SalesOrderForm, SalesOrderDetail } from "../features/sales-order";
import { DispatchList, DispatchForm, DispatchDetail } from "../features/dispatch";
import { VehicleManagementList, VehicleManagementForm, VehicleManagementDetail } from "../features/vehicle-management";
import { GpsTrackingList, GpsTrackingForm, GpsTrackingDetail } from "../features/gps-tracking";
import { AccountsFinanceList, AccountsFinanceForm, AccountsFinanceDetail } from "../features/accounts-finance";
import { ReportsAnalyticsList, ReportsAnalyticsForm, ReportsAnalyticsDetail } from "../features/reports-analytics";
import { DashboardList, DashboardForm, DashboardDetail } from "../features/dashboard";
import { MasterSettingsList, MasterSettingsForm, MasterSettingsDetail } from "../features/master-settings";
import { UserManagementList, UserManagementForm, UserManagementDetail } from "../features/user-management";
import { AuditLogsList, AuditLogsForm, AuditLogsDetail } from "../features/audit-logs";
import { NotificationsList, NotificationsForm, NotificationsDetail } from "../features/notifications";
import { MaintenanceList, MaintenanceForm, MaintenanceDetail } from "../features/maintenance";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="gate-management" element={<GateManagementList />} />
        <Route path="gate-management/new" element={<GateManagementForm />} />
        <Route path="gate-management/:id" element={<GateManagementDetail />} />
        <Route path="vendor-portal" element={<VendorPortalList />} />
        <Route path="vendor-portal/new" element={<VendorPortalForm />} />
        <Route path="vendor-portal/:id" element={<VendorPortalDetail />} />
        <Route path="vendor-management" element={<VendorManagementList />} />
        <Route path="vendor-management/new" element={<VendorManagementForm />} />
        <Route path="vendor-management/:id" element={<VendorManagementDetail />} />
        <Route path="purchase-management" element={<PurchaseManagementList />} />
        <Route path="purchase-management/new" element={<PurchaseManagementForm />} />
        <Route path="purchase-management/:id" element={<PurchaseManagementDetail />} />
        <Route path="sampling" element={<SamplingList />} />
        <Route path="sampling/new" element={<SamplingForm />} />
        <Route path="sampling/:id" element={<SamplingDetail />} />
        <Route path="laboratory" element={<LaboratoryList />} />
        <Route path="laboratory/new" element={<LaboratoryForm />} />
        <Route path="laboratory/:id" element={<LaboratoryDetail />} />
        <Route path="negotiation" element={<NegotiationList />} />
        <Route path="negotiation/new" element={<NegotiationForm />} />
        <Route path="negotiation/:id" element={<NegotiationDetail />} />
        <Route path="weighbridge" element={<WeighbridgeList />} />
        <Route path="weighbridge/new" element={<WeighbridgeForm />} />
        <Route path="weighbridge/:id" element={<WeighbridgeDetail />} />
        <Route path="warehouse-management" element={<WarehouseManagementList />} />
        <Route path="warehouse-management/new" element={<WarehouseManagementForm />} />
        <Route path="warehouse-management/:id" element={<WarehouseManagementDetail />} />
        <Route path="inventory" element={<InventoryList />} />
        <Route path="inventory/new" element={<InventoryForm />} />
        <Route path="inventory/:id" element={<InventoryDetail />} />
        <Route path="production" element={<ProductionList />} />
        <Route path="production/new" element={<ProductionForm />} />
        <Route path="production/:id" element={<ProductionDetail />} />
        <Route path="dryer-management" element={<DryerManagementList />} />
        <Route path="dryer-management/new" element={<DryerManagementForm />} />
        <Route path="dryer-management/:id" element={<DryerManagementDetail />} />
        <Route path="machine-management" element={<MachineManagementList />} />
        <Route path="machine-management/new" element={<MachineManagementForm />} />
        <Route path="machine-management/:id" element={<MachineManagementDetail />} />
        <Route path="quality-control" element={<QualityControlList />} />
        <Route path="quality-control/new" element={<QualityControlForm />} />
        <Route path="quality-control/:id" element={<QualityControlDetail />} />
        <Route path="by-product-management" element={<ByProductManagementList />} />
        <Route path="by-product-management/new" element={<ByProductManagementForm />} />
        <Route path="by-product-management/:id" element={<ByProductManagementDetail />} />
        <Route path="packing" element={<PackingList />} />
        <Route path="packing/new" element={<PackingForm />} />
        <Route path="packing/:id" element={<PackingDetail />} />
        <Route path="finished-goods" element={<FinishedGoodsList />} />
        <Route path="finished-goods/new" element={<FinishedGoodsForm />} />
        <Route path="finished-goods/:id" element={<FinishedGoodsDetail />} />
        <Route path="sales-order" element={<SalesOrderList />} />
        <Route path="sales-order/new" element={<SalesOrderForm />} />
        <Route path="sales-order/:id" element={<SalesOrderDetail />} />
        <Route path="dispatch" element={<DispatchList />} />
        <Route path="dispatch/new" element={<DispatchForm />} />
        <Route path="dispatch/:id" element={<DispatchDetail />} />
        <Route path="vehicle-management" element={<VehicleManagementList />} />
        <Route path="vehicle-management/new" element={<VehicleManagementForm />} />
        <Route path="vehicle-management/:id" element={<VehicleManagementDetail />} />
        <Route path="gps-tracking" element={<GpsTrackingList />} />
        <Route path="gps-tracking/new" element={<GpsTrackingForm />} />
        <Route path="gps-tracking/:id" element={<GpsTrackingDetail />} />
        <Route path="accounts-finance" element={<AccountsFinanceList />} />
        <Route path="accounts-finance/new" element={<AccountsFinanceForm />} />
        <Route path="accounts-finance/:id" element={<AccountsFinanceDetail />} />
        <Route path="reports-analytics" element={<ReportsAnalyticsList />} />
        <Route path="reports-analytics/new" element={<ReportsAnalyticsForm />} />
        <Route path="reports-analytics/:id" element={<ReportsAnalyticsDetail />} />
        <Route path="dashboard" element={<DashboardList />} />
        <Route path="dashboard/new" element={<DashboardForm />} />
        <Route path="dashboard/:id" element={<DashboardDetail />} />
        <Route path="master-settings" element={<MasterSettingsList />} />
        <Route path="master-settings/new" element={<MasterSettingsForm />} />
        <Route path="master-settings/:id" element={<MasterSettingsDetail />} />
        <Route path="user-management" element={<UserManagementList />} />
        <Route path="user-management/new" element={<UserManagementForm />} />
        <Route path="user-management/:id" element={<UserManagementDetail />} />
        <Route path="audit-logs" element={<AuditLogsList />} />
        <Route path="audit-logs/new" element={<AuditLogsForm />} />
        <Route path="audit-logs/:id" element={<AuditLogsDetail />} />
        <Route path="notifications" element={<NotificationsList />} />
        <Route path="notifications/new" element={<NotificationsForm />} />
        <Route path="notifications/:id" element={<NotificationsDetail />} />
        <Route path="maintenance" element={<MaintenanceList />} />
        <Route path="maintenance/new" element={<MaintenanceForm />} />
        <Route path="maintenance/:id" element={<MaintenanceDetail />} />
      </Route>
    </Routes>
  );
}
