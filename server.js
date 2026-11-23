const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const { exec, spawn } = require("child_process");
const { Server } = require("socket.io");
// qrcode se carga lazy solo al generar el QR (arranque más rápido)

const PORT = Number(process.env.PORT) || 3847;
const IS_PKG = typeof process.pkg !== "undefined";
const IS_ELECTRON =
  process.env.EASYITRANSFER_ELECTRON === "1" || !!process.versions.electron;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPEN_BROWSER =
  !IS_ELECTRON &&
  process.env.EASYITRANSFER_NO_BROWSER !== "1" &&
  (IS_PKG ||
    process.env.EASYITRANSFER_OPEN_BROWSER === "1" ||
    process.argv.includes("--open"));

process.title = "Easy iTransfer";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  pingTimeout: 120000,
  pingInterval: 25000,
});

app.use(express.static(PUBLIC_DIR));

/** @type {Map<string, { pin: string, hostId: string|null, members: Map<string, { name: string, device: string }> }>} */
const rooms = new Map();
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function deviceLabel(ua = "") {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "PC";
  return "Dispositivo";
}

function roomMembersPayload(room) {
  return [...room.members.entries()].map(([id, m]) => ({
    id,
    name: m.name,
    device: m.device,
    isHost: id === room.hostId,
  }));
}

function broadcastMembers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit("members", roomMembersPayload(room));
}

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1")
  );
}

function shutdownServer(reason = "manual") {
  console.log(`\n  Cerrando Easy iTransfer (${reason})…\n`);
  try {
    io.close();
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
}

app.get("/api/info", (_req, res) => {
  res.json({
    port: PORT,
    sessionId: SESSION_ID,
    ips: getLocalIPs(),
    urls: getLocalIPs().map((ip) => `http://${ip}:${PORT}`),
  });
});

app.post("/api/shutdown", (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ ok: false, error: "Solo desde esta PC" });
    return;
  }
  res.json({ ok: true });
  setTimeout(() => shutdownServer("web"), 120);
});

app.get("/api/qr.png", async (req, res) => {
  const text = String(req.query.t || "");
  if (!text || text.length > 600) {
    res.status(400).send("bad request");
    return;
  }
  try {
    const QRCode = require("qrcode");
    const png = await QRCode.toBuffer(text, {
      type: "png",
      width: 440,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0f1a", light: "#ffffff" },
    });
    res.setHeader("Cache-Control", "no-store");
    res.type("png").send(png);
  } catch {
    res.status(400).send("qr error");
  }
});

io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("create-room", ({ name }, cb) => {
    const roomCode = generateRoomCode();
    const pin = generatePin();
    const device = deviceLabel(socket.handshake.headers["user-agent"]);
    const displayName = (name || "").trim() || device;

    rooms.set(roomCode, {
      pin,
      hostId: socket.id,
      members: new Map([[socket.id, { name: displayName, device }]]),
    });

    currentRoom = roomCode;
    socket.join(roomCode);

    const ips = getLocalIPs();
    cb?.({
      ok: true,
      roomCode,
      pin,
      urls: ips.map((ip) => `http://${ip}:${PORT}`),
      members: roomMembersPayload(rooms.get(roomCode)),
    });
  });

  socket.on("join-room", ({ roomCode, pin, name }, cb) => {
    const code = String(roomCode || "").trim();
    const room = rooms.get(code);

    if (!room) {
      cb?.({ ok: false, error: "Sala no encontrada" });
      return;
    }
    if (String(pin || "").trim() !== room.pin) {
      cb?.({ ok: false, error: "Contraseña incorrecta" });
      return;
    }

    const device = deviceLabel(socket.handshake.headers["user-agent"]);
    const displayName = (name || "").trim() || device;

    room.members.set(socket.id, { name: displayName, device });
    currentRoom = code;
    socket.join(code);

    cb?.({
      ok: true,
      roomCode: code,
      members: roomMembersPayload(room),
    });

    broadcastMembers(code);
    socket.to(code).emit("peer-joined", {
      id: socket.id,
      name: displayName,
      device,
    });
  });

  socket.on("transfer-offer", (payload) => {
    const { to, transferId, fileName, fileSize, mimeType } = payload || {};
    if (!currentRoom || !to || !transferId || !fileName) return;
    const room = rooms.get(currentRoom);
    if (!room || !room.members.has(to)) return;

    const from = room.members.get(socket.id);
    io.to(to).emit("transfer-offer", {
      from: socket.id,
      fromName: from?.name || "Alguien",
      transferId,
      fileName,
      fileSize: Number(fileSize) || 0,
      mimeType: mimeType || "application/octet-stream",
    });
  });

  socket.on("transfer-accept", ({ to, transferId }) => {
    if (!currentRoom || !to || !transferId) return;
    io.to(to).emit("transfer-accept", { from: socket.id, transferId });
  });

  socket.on("transfer-reject", ({ to, transferId, reason }) => {
    if (!currentRoom || !to || !transferId) return;
    io.to(to).emit("transfer-reject", {
      from: socket.id,
      transferId,
      reason: reason || "Rechazado",
    });
  });

  socket.on("transfer-chunk", ({ to, transferId, index, data, total }, ack) => {
    if (!currentRoom || !to || !transferId || data == null) {
      if (typeof ack === "function") ack({ ok: false });
      return;
    }
    io.to(to).emit("transfer-chunk", {
      from: socket.id,
      transferId,
      index,
      data,
      total,
    });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("transfer-done", ({ to, transferId }) => {
    if (!currentRoom || !to || !transferId) return;
    io.to(to).emit("transfer-done", { from: socket.id, transferId });
  });

  socket.on("transfer-progress", ({ to, transferId, received, total }) => {
    if (!currentRoom || !to || !transferId) return;
    io.to(to).emit("transfer-progress", {
      from: socket.id,
      transferId,
      received,
      total,
    });
  });

  socket.on("transfer-cancel", ({ to, transferId }) => {
    if (!currentRoom || !to || !transferId) return;
    io.to(to).emit("transfer-cancel", { from: socket.id, transferId });
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.members.delete(socket.id);
    socket.to(currentRoom).emit("peer-left", { id: socket.id });

    if (room.members.size === 0) {
      rooms.delete(currentRoom);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = [...room.members.keys()][0];
      }
      broadcastMembers(currentRoom);
    }
    currentRoom = null;
  });
});

function openExternalBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    }
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    exec(
      process.platform === "win32"
        ? `cmd /c start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`,
      () => {}
    );
  }
}

function requestLocalShutdown() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/shutdown",
        method: "POST",
        timeout: 1500,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function listenOnce() {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(PORT, "0.0.0.0");
  });
}

async function startServer(options = {}) {
  const shouldOpenBrowser = options.openBrowser ?? OPEN_BROWSER;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await listenOnce();
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE") {
        console.error("\n  Error al iniciar:", err.message, "\n");
        throw err;
      }
      if (attempt === 3) {
        const msg = `El puerto ${PORT} sigue ocupado. Cierra Easy iTransfer e inténtalo de nuevo.`;
        console.error(`\n  ${msg}\n`);
        throw new Error(msg);
      }
      console.log("  Había una sesión anterior. Cerrándola para empezar limpio…");
      await requestLocalShutdown();
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  const ips = getLocalIPs();
  const localUrl = `http://127.0.0.1:${PORT}`;
  console.log("\n  Easy iTransfer — sesión nueva");
  console.log(`  Local: ${localUrl}`);
  if (ips.length) {
    console.log("  iPhone (misma Wi‑Fi):");
    ips.forEach((ip) => console.log(`         http://${ip}:${PORT}`));
  }
  console.log("");

  if (shouldOpenBrowser) {
    setTimeout(() => openExternalBrowser(localUrl), 400);
  }

  return { port: PORT, url: localUrl, ips, sessionId: SESSION_ID };
}

process.on("SIGINT", () => shutdownServer("signal"));
process.on("SIGTERM", () => shutdownServer("signal"));

module.exports = {
  startServer,
  shutdownServer,
  PORT,
  SESSION_ID,
};

if (require.main === module) {
  startServer().catch(() => process.exit(1));
}
