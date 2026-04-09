const db = require("../db");

/**
 * Verifies that the request carries a valid X-Session-Token
 * that belongs to an active participant in the requested room.
 *
 * On success:  attaches req.participant and req.room to the request object,
 *              then calls next().
 * On failure:  responds immediately with 401 or 403 — never calls next().
 */
const requireSession = async (req, res, next) => {
  const token = req.headers["x-session-token"];
  if (!token) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "X-Session-Token header is missing",
    });
  }

  const { room_code } = req.params;

  if (room_code) {
    const participant = await db.query(
      `SELECT p.*, r.is_active, r.expires_at FROM participants p JOIN rooms r ON p.room_id = r.id WHERE p.session_token = $1 AND r.room_code = $2`,
      [token, room_code],
    );
  
    if (!participant.rows.length) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Session token is not valid for this room",
      });
    }
  
    if (!participant.rows[0].is_active) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Room is not active",
      });
    }
  
    if (participant.rows[0].expires_at < new Date()) {
      return res.status(410).json({
        error: "GONE",
        message: "Room has expired",
      });
    }
    req.participant = participant.rows[0];
  }

  next();
};

module.exports = requireSession;
