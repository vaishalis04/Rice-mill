# Rice Mill ERP — Backend (Structure Skeleton)

Node.js + Express + MySQL + Sequelize backend skeleton for the **Rice Mill
Inventory, Procurement, Production & Dispatch Management System**, generated
to match the architecture in `Rice-Mill-ERP-Design.html`.

> This is a **structure-only scaffold** — folders, file names, model shells,
> and stubbed CRUD routes/controllers with `TODO` markers. No business logic,
> validation, or associations are implemented yet. It mirrors the same
> conventions used in the Job Junction backend (config/controllers/models/
> routes/helpers/middlewares/database).

## Folder Structure

```
rice-mill-backend/
├── app.js                     # Express app + route mounting
├── package.json
├── .env.example
├── config/
│   └── db.js                  # Sequelize MySQL connection
├── database/
│   ├── schema.sql              # TODO: full DDL (see architecture doc Section 7)
│   └── sync.js                 # sequelize.sync() runner
├── helpers/
│   ├── jwt.helper.js
│   ├── multer.helper.js
│   ├── helperFunction.js
│   └── responseHandler.js
├── middlewares/
│   ├── auth.middleware.js
│   └── permission.middleware.js
├── models/                     # 49 Sequelize model shells (18 master + 31 transaction)
│   └── index.js                 # central import + TODO associations
├── controllers/                # 31 controller files (one per ERP module, see below)
├── routes/                     # 31 matching route files
└── uploads/
```

## Module → File Mapping (per architecture doc Section 5)

| # | ERP Module | Controller / Route | Key Models |
|---|---|---|---|
| — | Auth | `auth` | User |
| 26 | User Management | `user` | User, Role, Permission, RolePermission |
| 25 | Master Settings | `masterSettings` | PlantMaster, MaterialMaster, VarietyMaster, UomMaster, RateMaster, QualityParameterMaster, ReasonCodeMaster |
| 3 | Vendor Management | `vendor` | Vendor |
| 2 | Vendor Portal | `vendorPortal` | PurchaseOrder |
| — | Customer Management | `customer` | Customer |
| 20 | Vehicle Management | `vehicleDriver` | Vehicle, Driver |
| 1 | Gate Management | `gate` | GateEntry |
| 4 | Purchase Management | `purchase` | PurchaseOrder, Purchase |
| 5 | Sampling | `sampling` | Sampling |
| 6 | Laboratory (QC-Inbound) | `labTest` | LabTest |
| 7 | Negotiation | `negotiation` | Negotiation |
| 8 | Weighbridge | `weighbridge` | WeightSlip |
| 9 | Warehouse Management | `warehouse` | WarehouseMaster, BinStackMaster, Stack |
| 10 | Inventory | `inventory` | Inventory, StockMovement, Lot |
| 11 | Production | `production` | ProductionBatch |
| 12 | Dryer Management | `dryer` | Dryer |
| 13, 29 | Machine Mgmt + Maintenance | `machine` | MachineMaster, MachineLog, MachineMaintenance |
| 14 | Quality Control (in-process) | `qualityControl` | QualityCheck |
| — | Reject / Waste | `rejectWaste` | RejectMaterial, WasteManagement |
| 15 | By-Product Management | `byProduct` | ByProductInventory |
| 16 | Packing | `packing` | Packing |
| 17 | Finished Goods | `finishedGoods` | FinishedGoods |
| 18 | Sales Order Management | `salesOrder` | SalesOrder |
| 19 | Dispatch | `dispatch` | Dispatch |
| 21 | GPS Tracking (optional) | `gpsTracking` | Vehicle |
| 22 | Accounts/Finance | `accounts` | Invoice, Payment |
| 23 | Reports & Analytics | `reports` | (cross-module) |
| 24 | Dashboard | `dashboard` | (cross-module) |
| 27 | Audit Logs | `auditLog` | AuditLog |
| 28 | Notifications | `notification` | Notification |

## Next Steps (build-out order suggested)

1. Fill in `models/*.model.js` column definitions from architecture doc Section 7.
2. Define associations in `models/index.js` (see Section 6 ER Diagram / Section 8).
3. Implement `helpers/jwt.helper.js` + `middlewares/auth.middleware.js`, then `auth` module.
4. Build core flow modules in process order: Gate → Sampling → Lab → Weighbridge →
   Warehouse/Inventory → Production → QC → Packing → Finished Goods → Sales Order → Dispatch → Accounts.
5. Add `reports`, `dashboard`, `auditLog`, `notification` once core flow works end-to-end.
