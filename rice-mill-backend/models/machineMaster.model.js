const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// machine_code, name, type(huller/separator/shiner/colorsorter/grader/dryer), capacity_per_hr, install_date
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class MachineMaster extends Model {}

MachineMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "MachineMaster",
    tableName: "machine_master",
    timestamps: true,
    underscored: true,
  }
);

module.exports = MachineMaster;
