const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class MaterialMaster extends Model {}

MaterialMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    material_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    category: { type: DataTypes.ENUM("paddy", "rice", "husk", "bran", "broken", "other"), allowNull: false },
    uom_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "uom_master", key: "id" } }, // normalized from raw "uom" string
    variety_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "variety_master", key: "id" } },
    hsn_code: { type: DataTypes.STRING(15) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "MaterialMaster",
    tableName: "material_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = MaterialMaster;
