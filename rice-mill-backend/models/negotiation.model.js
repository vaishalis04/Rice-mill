const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Negotiation extends Model {}

Negotiation.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    lab_test_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "lab_test", key: "id" } },
    old_rate: { type: DataTypes.DECIMAL(10, 2) },
    proposed_rate: { type: DataTypes.DECIMAL(10, 2) },
    vendor_response: { type: DataTypes.ENUM("accept", "reject"), allowNull: true },
    negotiated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    negotiated_at: { type: DataTypes.DATE },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Negotiation",
    tableName: "negotiation",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Negotiation;
