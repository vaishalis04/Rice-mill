const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class PaymentSettlement extends Model {}

// "Payment Settlement Advice" — the broker/lorry freight settlement slip
// the mill hands a buyer after an outward sale (matches the paper form:
// G.P. No., party/broker/GST details, load/empty/net weight, an item+return
// table, then TDS/Dana/Commission/CD/Hammali deductions down to a Net
// Payable Amount, plus the Lorry Freight/Brokerage details block).
// Entirely manual-entry, like the paper form it replaces — not tied to any
// gate entry or Sales Order, since these settlements are frequently done
// against a separate broker "sauda" (trade contract), not a gate visit.
PaymentSettlement.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    gp_no: { type: DataTypes.STRING(30), allowNull: true }, // "G.P.NO-942" banner; for a settlement made against a truck: its Gate Pass no. (e.g. GP-OUT-0042)
    // The truck (gate entry) this settlement is made against. Optional — a
    // settlement can still be typed in by hand with no truck, as before.
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "gate_entry", key: "id" } },
    settlement_date: { type: DataTypes.DATEONLY, allowNull: false },

    party_name: { type: DataTypes.STRING(150), allowNull: false },
    lorry_no: { type: DataTypes.STRING(20), allowNull: true },
    invoice_number_dated: { type: DataTypes.STRING(100), allowNull: true }, // free text, e.g. "25/27-08-2026"
    gst_number: { type: DataTypes.STRING(20), allowNull: true },
    party_mobile: { type: DataTypes.STRING(15), allowNull: true },
    broker_name: { type: DataTypes.STRING(150), allowNull: true },
    broker_pan: { type: DataTypes.STRING(15), allowNull: true },

    // Weights in KG throughout — matching the reference paper form exactly
    // (load/empty/net weight and the item table's own Weight column) and
    // the weighbridge slips this app already records in kg elsewhere. Rate
    // is Rs/kg. A real Quintal (100 kg — see
    // paymentSettlement.controller.js's KG_PER_REAL_QUINTAL) only enters
    // the picture for Commission's "X/qtl" figure, verified against the
    // reference image's own printed numbers.
    load_weight: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    empty_weight: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    less_bag_weight: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    less_moisture: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    less_misc: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },

    // Item/Return rows — [{ item_name, bags, weight, rate, is_return }].
    // "Weight" on the main (non-return) row defaults to the final net
    // weight above but can be overridden; amount and the TOTAL row are
    // always recomputed from these, never stored redundantly.
    items: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },

    // Deductions — each pairs a manual input with its computed amount.
    tds_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, // manual, like the paper form
    less_dana_pct: { type: DataTypes.DECIMAL(6, 3), allowNull: false, defaultValue: 0 }, // e.g. 0.3 for "300 Gram", 1 for "1 KG" — verified: 30670kg x 0.3% x Rs28/kg = Rs 2576, matching the reference image exactly
    quality_difference: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, // manual
    // "10/qtl" (flat Rs per real 100kg quintal) or "1%" (percent of total
    // amount) — see paymentSettlement.controller.js's computeCommission
    // for exactly how this is parsed, verified against the reference
    // image's own printed Commission figure.
    commission_input: { type: DataTypes.STRING(20), allowNull: true, defaultValue: "0" },
    // The Excel's dropdown beside this row: the same figure is either a broker
    // "commission" (also shown under Brokerage Details) or a "trade_discount"
    // (a price reduction — NOT brokerage). Either way it is deducted from the
    // Net Payable Amount. Existing rows default to "commission" = unchanged.
    commission_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "commission" },
    cd_pct: { type: DataTypes.DECIMAL(6, 3), allowNull: false, defaultValue: 0 },
    less_hammali: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, // manual flat amount
    balance_freight: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, // manual flat amount ("BALANCE FREIGHT" on the Excel form), deducted from Net Payable
    rounded_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, // manual +/- adjustment

    // Lorry Freight Payment Details / Brokerage Details block.
    sauda_date: { type: DataTypes.DATEONLY, allowNull: true },
    sauda: { type: DataTypes.STRING(50), allowNull: true }, // e.g. "60MT"
    inward_date: { type: DataTypes.DATEONLY, allowNull: true },
    inward_weight: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
    pending_sauda: { type: DataTypes.STRING(100), allowNull: true },
    // Every load made against the same order so far — [{ date, weight }] with
    // weight in kg (the Excel's INWARD DETAILS rows + their total). Older
    // settlements only have the single inward_date / inward_weight above,
    // which the PDF still prints when this is empty.
    inward_details: { type: DataTypes.JSON, allowNull: true },

    payment_through: { type: DataTypes.STRING(100), allowNull: true },
    payment_date: { type: DataTypes.DATEONLY, allowNull: true },
    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue:
        "THE ABOVE DEDUCTION ARE AS PER BARGAIN CONDITION.\nPLEASE DON'T ACCEPT DRAFT/PAYMENT, IF THE DEDUCTION IS NOT ACCEPTABLE.",
    },

    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "PaymentSettlement",
    tableName: "payment_settlements",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = PaymentSettlement;