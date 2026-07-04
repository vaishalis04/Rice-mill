// Run with: npm run db:sync
// TODO: decide sync strategy (alter/force) per environment; wire up plant_id
// seeding, default roles/permissions, and master data seed scripts here.

const { sequelize } = require("../models/index");

(async () => {
  try {
    await sequelize.sync({ alter: false });
    console.log("✅ Database synced");
    process.exit(0);
  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    process.exit(1);
  }
})();
