const express = require("express");
const router = express.Router();
const db = require("../db");
const requireSession = require("../middlewares/requireSession");

router.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM participants");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});

/**
 * @route   POST /api/rooms/:room_code/heartbeat
 * @desc    Refresh last_seen_at to stay listed as active
 * @access  Private — requires X-Session-Token header
 *
 * @header  {string} X-Session-Token
 * @param   {string} room_code
 *
 * @returns {204} No content
 * @returns {401} { error: "UNAUTHORIZED", message: "X-Session-Token header is missing" }
 * @returns {404} { error: "NOT_FOUND",    message: "Session not found" }
 *
 * @note    Call every 15–20 seconds. Skip this if using WebSockets —
 *          presence is tracked by connection liveness instead.
 */
// router.post("/:room_code/heartbeat", requireSession, heartbeat);

module.exports = router;
