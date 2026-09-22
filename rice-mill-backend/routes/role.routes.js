const router = require("express").Router();
const Controller = require("../controllers/role.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Custom role + permission management — admin only.
// Mounted at /api/role-management (deliberately NOT /api/roles, since that
// path likely already serves the lightweight role-name list used by the
// "role" EntitySelect dropdown elsewhere in the app — check
// user.routes.js / entityOptions.js before assuming, to avoid a collision).
router.use(verifyAccessToken, attachUser, authorize("admin"));

router.get("/permissions", Controller.getPermissions);
router.post("/permissions", Controller.createPermission);
router.delete("/permissions/:id", Controller.deletePermission);

router.get("/", Controller.getAll);
router.get("/:id", Controller.getById);
router.post("/", Controller.create);
router.put("/:id", Controller.update);
router.put("/:id/permissions", Controller.setPermissions);
router.delete("/:id", Controller.delete);

module.exports = router;