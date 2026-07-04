const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// batch_no (UNIQUE), lot_id (FK), process_type(dry/wet), input_qty, plant_id (FK), production_date, status
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class ProductionBatch extends Model {}

ProductionBatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "ProductionBatch",
    tableName: "production_batch",
    timestamps: true,
    underscored: true,
  }
);

module.exports = ProductionBatch;
