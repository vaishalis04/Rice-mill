require("dotenv").config();
const sequelize = require("../config/db");

(async () => {
  try {
    const [indexes] = await sequelize.query(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'weight_slip'
         AND COLUMN_NAME = 'slip_no'
         AND NON_UNIQUE = 0
         AND INDEX_NAME <> 'PRIMARY'`
    );
    for (const { INDEX_NAME: name } of indexes) {
      await sequelize.query(`ALTER TABLE \`weight_slip\` DROP INDEX \`${name}\``);
      console.log(`Removed unique index ${name} from weight_slip.slip_no`);
    }
    console.log(indexes.length ? "Duplicate slip numbers are now allowed." : "No unique slip number index found; nothing to change.");
    await sequelize.close();
  } catch (err) {
    console.error("Could not update weight slip indexes:", err.message);
    await sequelize.close();
    process.exitCode = 1;
  }
})();