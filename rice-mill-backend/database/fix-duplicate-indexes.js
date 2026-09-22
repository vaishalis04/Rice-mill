// database/fix-duplicate-indexes.js
//
// Run once with: node database/fix-duplicate-indexes.js
//
// Repeatedly running `npm run db:sync` (sequelize.sync({ alter: true }))
// against MySQL can leave behind duplicate auto-named indexes — one per
// foreign key / declared index, added again on every alter pass instead
// of being reused. MySQL allows at most 64 keys per table, so a
// heavily-referenced table like gate_entry (10 FK columns) eventually
// hits that ceiling and every future sync fails with:
//   "Too many keys specified; max 64 keys allowed"
//
// This scans every table in the current database, finds indexes that
// cover the exact same column(s) with the exact same uniqueness, and
// drops every copy except the first — PRIMARY is never touched.

const sequelize = require("../config/db");

(async () => {
  try {
    const [tables] = await sequelize.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    );

    let totalDropped = 0;

    for (const { TABLE_NAME: table } of tables) {
      const [rows] = await sequelize.query(
        `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        { replacements: [table] }
      );

      if (rows.length === 0) continue;

      // Group rows into { indexName: { columns: [...], nonUnique } }
      const byIndex = {};
      for (const row of rows) {
        if (!byIndex[row.INDEX_NAME]) {
          byIndex[row.INDEX_NAME] = { columns: [], nonUnique: row.NON_UNIQUE };
        }
        byIndex[row.INDEX_NAME].columns.push(row.COLUMN_NAME);
      }

      const indexNames = Object.keys(byIndex);
      if (indexNames.length <= 5) continue; // nothing unusual here, skip quietly

      const seenSignatures = new Set();
      const toDrop = [];

      for (const name of indexNames) {
        if (name === "PRIMARY") continue;
        const info = byIndex[name];
        const signature = `${info.columns.join(",")}|${info.nonUnique}`;
        if (seenSignatures.has(signature)) {
          toDrop.push(name);
        } else {
          seenSignatures.add(signature);
        }
      }

      if (toDrop.length === 0) continue;

      console.log(
        `\n${table}: ${indexNames.length} indexes found, dropping ${toDrop.length} duplicate(s)`
      );

      for (const name of toDrop) {
        try {
          await sequelize.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
          console.log(`  ✅ dropped ${name}`);
          totalDropped++;
        } catch (err) {
          console.log(`  ⚠️ could not drop ${name}: ${err.message}`);
        }
      }
    }

    console.log(`\nDone — removed ${totalDropped} duplicate index(es) in total.`);
    console.log("Now re-run: npm run db:sync");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  }
})();