const express = require("express");
const router  = express.Router();

const {
  getOverview,
  listStudents,
  setPaid,
  assignTask,
  submitTask,
  verifyTask,
  listWorklogs,
} = require("../controllers/overview.controller");

const { requireAuth } = require("../middleware/auth.middleware");

// All routes require a valid JWT
router.use(requireAuth);

// Dashboard
router.get("/",                 getOverview);   // admin — full dashboard stats

// Students
router.get("/students",         listStudents);  // admin — all students with stats

// Payment
router.patch("/pay/:email",     setPaid);       // admin — mark student as paid/unpaid

// Legacy stubs (deprecated — kept so old calls don't crash)
router.get(   "/worklogs",              listWorklogs);
router.post(  "/worklogs",              assignTask);
router.patch( "/worklogs/:id/submit",   submitTask);
router.patch( "/worklogs/:id/verify",   verifyTask);

module.exports = router;