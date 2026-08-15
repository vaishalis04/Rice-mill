const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Lot extends Model {}

Lot.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    lot_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    purchase_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "purchase", key: "id" } }, // null for production-generated lots
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    variety_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "variety_master", key: "id" } },
    // qty = ACCEPTED qty only (bag_size * accepted_bags), set once unloading is completed.
    // 0 while unloading_status = 'in_progress' (bags not counted yet).
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    parent_lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } }, // self-FK: traceability backbone
    destination: { type: DataTypes.ENUM("warehouse", "production"), allowNull: true }, // set via PATCH /api/lots/:id/route

    // --- Unloading workflow (Start Unloading -> manual factory check -> bag count) ---
    // Target placement chosen at "Start Unloading" time; the Stack row itself is only
    // created once bags are counted and the accepted qty is known (see completeUnloading).
    warehouse_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "warehouse_master", key: "id" } },
    bin_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "bin_stack_master", key: "id" } },
    // 'in_progress': truck opened for unloading, manual check happening at factory, bags not yet counted.
    // 'completed': bag size + accepted/rejected bags recorded, qty finalized, Stack + Inventory created.
    unloading_status: {
      type: DataTypes.ENUM("in_progress", "completed"),
      allowNull: false,
      defaultValue: "in_progress",
    },
    bag_size: { type: DataTypes.DECIMAL(10, 2), allowNull: true }, // kg per bag, entered at completion
    accepted_bags: { type: DataTypes.INTEGER, allowNull: true },
    rejected_bags: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    rejected_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: true, defaultValue: 0 }, // bag_size * rejected_bags
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Lot",
    tableName: "lots",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Lot;