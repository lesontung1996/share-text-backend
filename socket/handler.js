const db = require("../db");

function initSocket(io) {
  // ── Auth middleware — runs before every connection ───────
  // Replaces the manual token check inside the connection handler
  io.use(async (socket, next) => {
    // const token = socket.handshake.auth.token;
    // const roomCode = socket.handshake.auth.roomCode;

    // if (!token || !roomCode) {
    //   return next(new Error("UNAUTHORIZED"));
    // }

    // const participant = await db.query(
    //   `SELECT p.*, r.is_active, r.expires_at
    //    FROM participants p
    //    JOIN rooms r ON r.id = p.room_id
    //    WHERE p.session_token = $1 AND r.room_code = $2`,
    //   [token, roomCode],
    // );

    // if (!participant) return next(new Error("FORBIDDEN"));
    // // if (!participant.is_active) return next(new Error("GONE"));

    // // Attach to socket so event handlers can read it
    // socket.participant = participant;
    // socket.roomCode = roomCode;
    next();
  });

  // ── Connection handler ───────────────────────────────────
  io.on("connection", async (socket) => {
    const { participant, roomCode } = socket;
    socket.emit("message", `Hello, world! fasdf ${participant} in room ${roomCode}`);

    socket.on("room:joined", async (data) => {
      const { room_code } = data;
      socket.join(room_code);
      const result = await db.query(
          "SELECT m.*, r.room_code, r.expires_at, r.max_participants FROM messages m JOIN rooms r ON m.room_id = r.id WHERE r.room_code = $1",
          [room_code],
        );
      socket.emit("room:joined", result.rows);
    });

    socket.on("message:new", async (data) => {
      const { room_code, content } = data;
      const result = await db.query(
          "INSERT INTO messages (room_id, content) VALUES ((SELECT id FROM rooms WHERE room_code = $1), $2) RETURNING *",
          [room_code, content],
        );
      io.to(room_code).emit("message:new", result.rows[0]);
    });

    // ── 1. Join the socket.io room ───────────────────────────
    // This is all roomManager.joinRoom() did — one line replaces it
    // socket.join(roomCode);

    // await db.query(
    //   `UPDATE participants SET last_seen_at = now() WHERE session_token = $1`,
    //   [participant.session_token],
    // );

    // // ── 2. Get live count using socket.io's built-in method ─
    // // Replaces manager.getCount() entirely
    // const getCount = async () => (await io.in(roomCode).fetchSockets()).length;

    // // ── 3. Notify others in the room ────────────────────────
    // // socket.to(room) = everyone in room EXCEPT this socket
    // socket.to(roomCode).emit("participant.joined", {
    //   alias: participant.alias,
    //   participant_count: await getCount(),
    // });

    // // ── 4. Welcome only this socket ─────────────────────────
    // // socket.emit() = only this connection
    // socket.emit("room.welcome", {
    //   participant_count: await getCount(),
    // });

    // // ── 5. Receive and broadcast messages ───────────────────
    // socket.on("message.send", async (content) => {
    //   content = (content ?? "").trim();
    //   if (!content || content.length > 50000) return;

    //   const saved = await db.query(
    //     `INSERT INTO messages (room_id, content, author_token, author_alias)
    //      VALUES ($1, $2, $3, $4) RETURNING *`,
    //     [
    //       participant.room_id,
    //       content,
    //       participant.session_token,
    //       participant.alias,
    //     ],
    //   );

    //   // io.to(room) = everyone including sender
    //   io.to(roomCode).emit("message.new", {
    //     id: saved.id,
    //     content: saved.content,
    //     author_alias: saved.author_alias,
    //     created_at: saved.created_at,
    //   });
    // });

    // // ── 6. Disconnect ────────────────────────────────────────
    // socket.on("disconnect", async () => {
    //   // socket.io auto-removes socket from the room on disconnect
    //   socket.to(roomCode).emit("participant.left", {
    //     alias: participant.alias,
    //     participant_count: await getCount(),
    //   });
    // });
  });

  // ── Room expiry — push to all clients in the room ────────
  // setInterval(async () => {
  //   const expired = await db.query(
  //     `UPDATE rooms SET is_active = FALSE
  //      WHERE expires_at < now() AND is_active = TRUE
  //      RETURNING room_code`,
  //   );
  //   console.log("expired", expired);
  //   for (const { room_code } of expired) {
  //     io.to(room_code).emit("room.expired", { message: "Room has expired" });
  //   }
  // }, 60_000);
}

module.exports = { initSocket };
