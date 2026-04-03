const express = require("express");
const router = express.Router();
const db = require("../db");
const { customAlphabet } = require("nanoid");
const { generateToken } = require("../utils/token");
const requireCreator = require("../middlewares/requireCreator");
const requireSession = require("../middlewares/requireSession");

/* GET rooms listing. */
router.get("/", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM rooms");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});

/**
 * @route   POST /api/rooms
 * @desc    Create a new room
 * @access  Public
 *
 * @body    {string}  initial_text        - The text to seed the room with (required)
 * @body    {number}  [ttl_minutes=60]    - How long the room lives, in minutes
 * @body    {number}  [max_participants=50] - Max allowed participants
 *
 * @returns {201} { id, room_code, url, creator_token, expires_at, max_participants }
 * @returns {400} { error: "VALIDATION_ERROR", message: "initial_text is required" }
 * @returns {422} { error: "UNPROCESSABLE",    message: "ttl_minutes must be between 5 and 1440" }
 *
 * @note    creator_token is returned ONCE — client must persist in localStorage
 */

const createRoom = async (req, res) => {
  try {
    const { initial_text, ttl_minutes = 60, max_participants = 50 } = req.body;
    if (!initial_text) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "initial_text is required",
      });
    }

    if (ttl_minutes < 5 || ttl_minutes > 1440) {
      return res.status(422).json({
        error: "UNPROCESSABLE",
        message: "ttl_minutes must be between 5 and 1440",
      });
    }

    const room_code = customAlphabet(
      "0123456789abcdefghijklmnopqrstuvwxyz",
      6,
    )();
    const expires_at = new Date(Date.now() + ttl_minutes * 60000);
    const creator_token = generateToken();

    const result = await db.query(
      "INSERT INTO rooms (room_code, initial_text, expires_at, max_participants, creator_token) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [room_code, initial_text, expires_at, max_participants, creator_token],
    );
    await db.query(
      "INSERT INTO messages (room_id, author_token, content) VALUES ($1, $2, $3)",
      [result.rows[0].id, creator_token, initial_text],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      // if the room code already exists, try again
      return createRoom(req, res);
    }
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Error creating room",
    });
  }
};

router.post("/", createRoom);

/**
 * @route   GET /api/rooms/:room_code
 * @desc    Get room metadata
 * @access  Public
 *
 * @param   {string} room_code - Short room identifier from the URL
 *
 * @returns {200} { id, room_code, initial_text, expires_at, is_active, participant_count, max_participants }
 * @returns {404} { error: "NOT_FOUND",  message: "Room does not exist" }
 * @returns {410} { error: "GONE",       message: "Room has expired" }
 */
router.get("/:room_code", async (req, res) => {
  try {
    const { room_code } = req.params;
    const result = await db.query("SELECT * FROM rooms WHERE room_code = $1", [
      room_code,
    ]);
    if (!result.rows.length) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Room does not exist",
      });
    }
    if (result.rows[0].expires_at < new Date()) {
      return res.status(410).json({
        error: "GONE",
        message: "Room has expired",
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Error getting room",
    });
  }
});

/**
 * @route   DELETE /api/rooms/:room_code
 * @desc    Close a room early (creator only)
 * @access  Private — requires X-Creator-Token header
 *
 * @header  {string} X-Creator-Token - Token issued at room creation
 * @param   {string} room_code
 *
 * @returns {204} No content
 * @returns {401} { error: "UNAUTHORIZED", message: "X-Creator-Token header is missing" }
 * @returns {403} { error: "FORBIDDEN",    message: "Invalid creator token" }
 * @returns {404} { error: "NOT_FOUND",    message: "Room does not exist" }
 */
router.delete("/:room_code", requireCreator, async (req, res) => {
  try {
    const { room_code } = req.params;
    const result = await db.query("DELETE FROM rooms WHERE room_code = $1", [
      room_code,
    ]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Error closing room",
    });
  }
});

/**
 * @route   PATCH /api/rooms/:room_code
 * @desc    Extend a room's expiry (creator only)
 * @access  Private — requires X-Creator-Token header
 *
 * @header  {string} X-Creator-Token
 * @param   {string} room_code
 * @body    {number} extend_minutes - Minutes to add (max 1440)
 *
 * @returns {200} { expires_at: "2026-03-27T16:00:00Z" }
 * @returns {400} { error: "VALIDATION_ERROR", message: "extend_minutes is required" }
 * @returns {401} { error: "UNAUTHORIZED",     message: "X-Creator-Token header is missing" }
 * @returns {403} { error: "FORBIDDEN",        message: "Invalid creator token" }
 * @returns {410} { error: "GONE",             message: "Cannot extend an expired room" }
 */
router.patch("/:room_code", requireCreator, async (req, res) => {
  try {
    const { extend_minutes = 60 } = req.body;
    const { room_code } = req.params;
    const result = await db.query(
      "UPDATE rooms SET expires_at = $1 WHERE room_code = $2",
      [new Date(Date.now() + extend_minutes * 60000), room_code],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Error extending room",
    });
  }
});

/**
 * @route   POST /api/rooms/:room_code/join
 * @desc    Join a room and get a session token
 * @access  Public
 *
 * @param   {string}  room_code
 * @body    {string}  [alias] - Optional display name (max 64 chars)
 *
 * @returns {200} { session_token, alias, room: { room_code, expires_at, initial_text } }
 * @returns {404} { error: "NOT_FOUND",    message: "Room does not exist" }
 * @returns {409} { error: "ROOM_FULL",    message: "Room has reached max participants" }
 * @returns {410} { error: "GONE",         message: "Room has expired" }
 *
 * @note    If X-Session-Token header is present and valid for this room,
 *          the server refreshes last_seen_at and returns the existing token
 *          instead of creating a new participant row.
 */
router.post("/:room_code/join", async (req, res) => {
  const { room_code } = req.params;
  const { alias } = req.body;

  // 1. If client already has a token for this room, re-use it
  const existingToken = req.headers["x-session-token"];
  if (existingToken) {
    const existing = await db.query(
      `SELECT p.*, r.is_active, r.expires_at, r.initial_text
       FROM participants p
       JOIN rooms r ON r.id = p.room_id
       WHERE p.session_token = $1 AND r.room_code = $2`,
      [existingToken, room_code],
    );
    if (existing.rows[0]) {
      await db.query(
        `UPDATE participants SET last_seen_at = now() WHERE session_token = $1`,
        [existingToken],
      );
      return res.json({
        session_token: existingToken,
        alias: existing.rows[0].alias,
        room: existing.rows[0],
      });
    }
  }

  // 2. Look up room, check capacity and expiry
  const room = await db.query(`SELECT * FROM rooms WHERE room_code = $1`, [
    room_code,
  ]);
  if (!room.rows[0])
    return res
      .status(404)
      .json({ error: "NOT_FOUND", message: "Room does not exist" });
  if (!room.rows[0].is_active)
    return res.status(410).json({ error: "GONE", message: "Room has expired" });

  const { count } = await db.query(
    `SELECT COUNT(*) FROM participants WHERE room_id = $1`,
    [room.rows[0].id],
  );
  if (count >= room.rows[0].max_participants)
    return res.status(409).json({
      error: "ROOM_FULL",
      message: "Room has reached max participants",
    });

  // 3. Generate token server-side and persist it
  const session_token = generateToken();

  await db.query(
    `INSERT INTO participants (room_id, session_token, alias)
     VALUES ($1, $2, $3)`,
    [room.rows[0].id, session_token, alias ?? null],
  );

  // 4. Return token to client — only time it's ever sent in plain text
  return res.status(200).json({
    session_token,
    alias: alias ?? null,
    room: {
      room_code: room.rows[0].room_code,
      expires_at: room.rows[0].expires_at,
      initial_text: room.rows[0].initial_text,
    },
  });
});

/**
 * @route   GET /api/rooms/:room_code/participants
 * @desc    List participants active in the last 30 seconds
 * @access  Private — requires X-Session-Token header
 *
 * @header  {string} X-Session-Token
 * @param   {string} room_code
 *
 * @returns {200} { count: 3, participants: [{ alias, last_seen_at }] }
 * @returns {401} { error: "UNAUTHORIZED", message: "X-Session-Token header is missing" }
 * @returns {403} { error: "FORBIDDEN",    message: "Session token is not valid for this room" }
 * @returns {404} { error: "NOT_FOUND",    message: "Room does not exist" }
 */
router.get("/:room_code/participants", requireSession, async (req, res) => {
  try {
    const { room_code } = req.params;
    const result = await db.query(
      "SELECT p.* FROM participants p JOIN rooms r ON p.room_id = r.id WHERE room_code = $1",
      [room_code],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Error retrieving participants",
    });
  }
});

/**
 * @route   GET /api/rooms/:room_code/messages
 * @desc    Fetch message history (cursor-paginated, oldest first)
 * @access  Private — requires X-Session-Token header
 *
 * @header  {string} X-Session-Token
 * @param   {string} room_code
 * @query   {number} [limit=50]    - Max messages to return (max 100)
 * @query   {string} [before]      - ISO timestamp cursor for pagination
 *
 * @returns {200} {
 *            messages: [{ id, content, author_alias, created_at }],
 *            has_more: boolean
 *          }
 * @returns {401} { error: "UNAUTHORIZED", message: "X-Session-Token header is missing" }
 * @returns {403} { error: "FORBIDDEN",    message: "Session token is not valid for this room" }
 * @returns {404} { error: "NOT_FOUND",    message: "Room does not exist" }
 */
router.get("/:room_code/messages", requireSession, async (req, res) => {
  try {
    const { room_code } = req.params;
    const result = await db.query(
      "SELECT m.*, r.room_code, r.expires_at, r.max_participants FROM messages m JOIN rooms r ON m.room_id = r.id WHERE r.room_code = $1",
      [room_code],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Error retrieving messages",
    });
  }
});

/**
 * @route   POST /api/rooms/:room_code/messages
 * @desc    Post a new message to the room
 * @access  Private — requires X-Session-Token header
 *
 * @header  {string} X-Session-Token
 * @param   {string} room_code
 * @body    {string} content - Message text (max 50,000 chars)
 *
 * @returns {201} { id, content, author_alias, created_at }
 * @returns {400} { error: "VALIDATION_ERROR", message: "content must not be empty" }
 * @returns {401} { error: "UNAUTHORIZED",     message: "X-Session-Token header is missing" }
 * @returns {403} { error: "FORBIDDEN",        message: "Session token is not valid for this room" }
 * @returns {410} { error: "GONE",             message: "Room has expired" }
 * @returns {413} { error: "PAYLOAD_TOO_LARGE",message: "content exceeds 50,000 characters" }
 *
 * @note    On success, the server broadcasts a `message.new` WebSocket event
 *          to all connected clients in this room.
 */
router.post("/:room_code/messages", requireSession, async (req, res) => {
  try {
    const { content } = req.body;
    const result = await db.query(
      "INSERT INTO messages (room_id, content, author_token) VALUES ($1, $2, $3) RETURNING *",
      [req.participant.room_id, content, req.participant.session_token],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({
      error: "INTERNAL_ERROR",
      message: "Error sending message",
    });
  }
});

module.exports = router;
