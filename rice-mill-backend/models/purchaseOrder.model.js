const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class PurchaseOrder extends Model {}

PurchaseOrder.init(
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    po_no: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },

    vendor_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "vendors",
        key: "id",
      },
    },

    material_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "material_master",
        key: "id",
      },
    },

    variety_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "variety_master",
        key: "id",
      },
    },

    qty: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    rate: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },

    po_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    validity: {
      type: DataTypes.DATEONLY,
    },

    do_no: {
      type: DataTypes.STRING(30),
    },

    uploaded_by_vendor: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    updated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    approval_status: {
      type: DataTypes.ENUM("pending_approval", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending_approval",
    },

    approved_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    plant_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "plant_master",
        key: "id",
      },
    },

    // Detailed item information
    items: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    modelName: "PurchaseOrder",
    tableName: "purchase_order",
    timestamps: true,
    underscored: true,
    paranoid: false,
  },
);

module.exports = PurchaseOrder;