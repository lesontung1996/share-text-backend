const db = require("../db");
const { joinRoom } = require("./dbFunctions");

function initSocket(io) {
  // ── Auth middleware — runs before every connection ───────
  io.use(async (socket, next) => {
    // const { sessionToken, roomCode } = socket.handshake.auth;

    // 
    // if (!roomCode) {
    //   return next(new Error("UNAUTHORIZED"));
    // }

    // try {
    //   const { newToken } = await joinRoom(socket, roomCode, sessionToken);
    //   // Store so the connection handler can emit it once the socket is live
    //   if (newToken) socket.newToken = newToken;
    //   next();
    // } catch (err) {
    //   next(new Error(err.code ?? "UNAUTHORIZED"));
    // }
    next();
  });

  // ── Connection handler ───────────────────────────────────
  io.on("connection", async (socket) => {
    socket.on("authenticate", async (data) => {
      const { sessionToken, roomCode } = data;

      if (!roomCode) {
        return socket.emit("error", { message: "Room code is required" });
      }

      try {
        const { newToken } = await joinRoom(socket, roomCode, sessionToken);
        // Store so the connection handler can emit it once the socket is live
        if (newToken) {
          socket.newToken = newToken;
          return socket.emit("authenticate", { sessionToken: newToken });
        }
      } catch (err) {
        socket.emit("error", { message: err.code ?? "UNAUTHORIZED" });
      }
    });

    socket.on("room:joined", async (data) => {
      const { room_code } = data;
      socket.join(room_code);
      const result = await db.query(
        "SELECT m.*, r.room_code, r.expires_at, r.max_participants, (SELECT alias FROM participants WHERE session_token = m.author_token) AS alias FROM messages m JOIN rooms r ON m.room_id = r.id WHERE r.room_code = $1",
        [room_code],
      );
      socket.emit("room:joined", result.rows);
    });

    socket.on("message:new", async (data) => {
      const { room_code, content } = data;
      console.log("Received message:new", { room_code, content, sessionToken: socket.sessionToken }); 
      const result = await db.query(
        "INSERT INTO messages (room_id, content, author_token, author_alias) VALUES ((SELECT id FROM rooms WHERE room_code = $1), $2, $3, (SELECT alias FROM participants WHERE session_token = $3::varchar)) RETURNING *",
        [room_code, content, socket.sessionToken],
      );
      console.log("Message inserted", result.rows[0]);
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
  //     //   for (const { room_code } of expired) {
  //     io.to(room_code).emit("room.expired", { message: "Room has expired" });
  //   }
  // }, 60_000);
}

module.exports = { initSocket };
