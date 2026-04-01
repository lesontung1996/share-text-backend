const db = require("../db");
const { safeCompare } = require("../utils/token");

/**
 * Verifies that the request carries the X-Creator-Token
 * that matches the room identified by :room_code.
 *
 * On success:  attaches req.room to the request object, then calls next().
 * On failure:  responds immediately with 401, 403, or 404.
 */
async function requireCreator(req, res, next) {
  const token = req.headers["x-creator-token"];

  if (!token) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "X-Creator-Token header is missing",
    });
  }

  const room = await db.query(`SELECT * FROM rooms WHERE room_code = $1`, [
    req.params.room_code,
  ]);

  if (!room.rows[0]) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: "Room does not exist",
    });
  }

  // Constant-time comparison prevents timing attacks
  const valid = safeCompare(token, room.rows[0].creator_token);

  if (!valid) {
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Invalid creator token",
    });
  }

  req.room = room.rows[0];
  next();
}

module.exports = requireCreator;
