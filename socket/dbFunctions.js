const db = require("../db");
const { generateToken } = require("../utils/token");
const { uniqueNamesGenerator, adjectives, animals } = require("unique-names-generator");

/**
 * Verify an existing session token or create a new participant for the room.
 *
 * - If sessionToken is present and valid for room_code: refreshes last_seen_at,
 *   attaches participant to socket, and returns { participant }.
 * - If sessionToken is absent or invalid: checks room availability, generates
 *   a new token, inserts a participant row, and returns { participant, newToken }.
 *
 * Throws an Error with a .code property on NOT_FOUND / GONE / ROOM_FULL.
 */
const joinRoom = async (socket, room_code, session_token) => {
  // 1. Re-use existing session if token is provided and valid
  if (session_token) {
    const existing = await db.query(
      `SELECT p.*, r.is_active, r.expires_at, r.initial_text, r.room_code
       FROM participants p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.session_token = $1 AND r.room_code = $2`,
      [session_token, room_code],
    );
    if (existing.rows[0]) {
      await db.query(
        `UPDATE participants SET last_seen_at = now() WHERE session_token = $1`,
        [session_token],
      );
      socket.participant = existing.rows[0];
      socket.roomCode = room_code;
      socket.sessionToken = session_token;
      return { participant: existing.rows[0] };
    }
  }

  // 2. Look up room, check expiry and capacity
  const room = await db.query(`SELECT * FROM rooms WHERE room_code = $1`, [
    room_code,
  ]);
  if (!room.rows[0]) {
    throw Object.assign(new Error("Room does not exist"), { code: "NOT_FOUND" });
  }
  if (!room.rows[0].is_active) {
    throw Object.assign(new Error("Room has expired"), { code: "GONE" });
  }

  const { count } = (
    await db.query(`SELECT COUNT(*) FROM participants WHERE room_id = $1`, [
      room.rows[0].id,
    ])
  ).rows[0];
  if (count >= room.rows[0].max_participants) {
    throw Object.assign(new Error("Room has reached max participants"), {
      code: "ROOM_FULL",
    });
  }

  // 3. Generate a new token and persist the participant
  const new_token = generateToken();
  const alias = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: " ",
    length: 2,
    style: "capital",
  });
  await db.query(
    `INSERT INTO participants (room_id, session_token, alias) VALUES ($1, $2, $3)`,
    [room.rows[0].id, new_token, alias],
  );

  const participant = { ...room.rows[0], session_token: new_token, alias };
  socket.participant = participant;
  socket.roomCode = room_code;
  socket.sessionToken = new_token;
  return { participant, newToken: new_token };
};

module.exports = { joinRoom };
