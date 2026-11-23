(() => {
  const CHUNK_SIZE = 256 * 1024;
  const AUTO_ACCEPT = true;
  const socket = io({ transports: ["websocket", "polling"] });

  const views = {
    home: document.getElementById("view-home"),
    host: document.getElementById("view-host"),
    room: document.getElementById("view-room"),
    closed: document.getElementById("view-closed"),
  };

  const els = {
    btnQuit: document.getElementById("btn-quit"),
    btnCreate: document.getElementById("btn-create"),
    btnShowJoin: document.getElementById("btn-show-join"),
    joinForm: document.getElementById("join-form"),
    joinRoom: document.getElementById("join-room"),
    joinPin: document.getElementById("join-pin"),
    joinName: document.getElementById("join-name"),
    joinError: document.getElementById("join-error"),
    hostRoom: document.getElementById("host-room"),
    hostPin: document.getElementById("host-pin"),
    hostQr: document.getElementById("host-qr"),
    hostUrls: document.getElementById("host-urls"),
    hostMembersList: document.getElementById("host-members-list"),
    qrUrlSelect: document.getElementById("qr-url-select"),
    qrUrlPickWrap: document.getElementById("qr-url-pick-wrap"),
    btnEnterRoom: document.getElementById("btn-enter-room"),
    roomCode: document.getElementById("room-code"),
    roomPin: document.getElementById("room-pin"),
    roomPinWrap: document.getElementById("room-pin-wrap"),
    btnLeave: document.getElementById("btn-leave"),
    membersList: document.getElementById("members-list"),
    dropZone: document.getElementById("drop-zone"),
    fileInput: document.getElementById("file-input"),
    btnPick: document.getElementById("btn-pick"),
    targetSelect: document.getElementById("target-select"),
    transfersList: document.getElementById("transfers-list"),
    transfersEmpty: document.getElementById("transfers-empty"),
  };

  const state = {
    roomCode: null,
    pin: null,
    isHost: false,
    members: [],
    selectedPeerId: null,
    pendingFiles: null,
    transfers: new Map(),
    incoming: new Map(),
  };

  const isDesktop =
    Boolean(window.easyApp?.isDesktop) ||
    new URLSearchParams(location.search).get("app") === "1";

  if (isDesktop) {
    document.body.classList.add("is-desktop");
    els.btnQuit?.classList.add("hidden");
  }
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !isDesktop) {
    els.btnQuit?.classList.add("hidden");
  }

  function show(view) {
    Object.values(views).forEach((v) => v?.classList.add("hidden"));
    views[view]?.classList.remove("hidden");
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function formatBytes(n) {
    if (!n || n < 0) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let x = n;
    while (x >= 1024 && i < u.length - 1) {
      x /= 1024;
      i++;
    }
    return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initial(name) {
    const t = String(name || "?").trim();
    return (t[0] || "?").toUpperCase();
  }

  function renderAvatars(container, { sendable }) {
    if (!container) return;
    container.innerHTML = "";
    const list = state.members || [];
    if (!list.length) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="avatar-name" style="width:auto">Esperando…</div>`;
      container.appendChild(li);
      return;
    }

    list.forEach((m) => {
      const isMe = m.id === socket.id;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-btn";
      btn.innerHTML = `
        <div class="avatar-bubble ${isMe ? "me" : ""}">
          ${escapeHtml(initial(m.name))}
          <span class="live" aria-hidden="true"></span>
        </div>
        <div class="avatar-name">${escapeHtml(m.name)}${isMe ? " (tú)" : ""}</div>
        <div class="avatar-device">${escapeHtml(m.device)}</div>`;

      if (sendable && !isMe) {
        btn.onclick = () => onPeerTap(m.id, m.name);
      }
      li.appendChild(btn);
      container.appendChild(li);
    });
  }

  function syncTargetSelect() {
    const others = state.members.filter((m) => m.id !== socket.id);
    const prev = state.selectedPeerId || els.targetSelect.value;
    els.targetSelect.innerHTML = "";
    if (!others.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Esperando…";
      els.targetSelect.appendChild(opt);
      state.selectedPeerId = null;
      return;
    }
    others.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      els.targetSelect.appendChild(opt);
    });
    if (others.some((m) => m.id === prev)) {
      els.targetSelect.value = prev;
      state.selectedPeerId = prev;
    } else {
      state.selectedPeerId = others[0].id;
      els.targetSelect.value = others[0].id;
    }
  }

  function setMembers(members) {
    const prevCount = state.members.filter((m) => m.id !== socket.id).length;
    state.members = members || [];
    const others = state.members.filter((m) => m.id !== socket.id).length;

    renderAvatars(els.hostMembersList, { sendable: false });
    renderAvatars(els.membersList, { sendable: true });
    syncTargetSelect();

    // Si estás en la pantalla del QR y entra alguien → pasa a enviar
    if (
      state.isHost &&
      others > prevCount &&
      others > 0 &&
      !views.host.classList.contains("hidden")
    ) {
      enterRoomView();
    }
  }

  function onPeerTap(peerId, name) {
    state.selectedPeerId = peerId;
    els.targetSelect.value = peerId;
    if (state.pendingFiles?.length) {
      const files = state.pendingFiles;
      state.pendingFiles = null;
      sendFiles(files, peerId);
      return;
    }
    // Guarda el destino y abre el selector
    els.fileInput.dataset.to = peerId;
    els.fileInput.click();
  }

  function ensureTransferRow(transferId) {
    els.transfersEmpty?.classList.add("hidden");
    let row = document.getElementById(`t-${transferId}`);
    if (row) return row;
    row = document.createElement("li");
    row.className = "transfer-item";
    row.id = `t-${transferId}`;
    row.innerHTML = `
      <div class="row">
        <span class="fname"></span>
        <span class="status"></span>
      </div>
      <div class="bar"><span></span></div>
      <div class="actions-row"></div>`;
    els.transfersList.prepend(row);
    return row;
  }

  function renderTransfer(transferId) {
    const t = state.transfers.get(transferId);
    if (!t) return;
    const row = ensureTransferRow(transferId);
    row.querySelector(".fname").textContent = t.fileName;
    const pct = t.fileSize
      ? Math.min(100, Math.round((t.progress / t.fileSize) * 100))
      : t.status === "done"
        ? 100
        : 0;
    row.querySelector(".bar > span").style.width = `${pct}%`;

    let statusText = "";
    if (t.status === "offering") statusText = "Conectando…";
    else if (t.status === "sending")
      statusText = `${pct}% · ${formatBytes(t.progress)}`;
    else if (t.status === "receiving")
      statusText = `${pct}% · ${formatBytes(t.progress)}`;
    else if (t.status === "pending") statusText = formatBytes(t.fileSize);
    else if (t.status === "done") statusText = t.direction === "out" ? "Enviado" : "Recibido";
    else if (t.status === "rejected") statusText = "Rechazado";
    else if (t.status === "cancelled") statusText = "Cancelado";
    else if (t.status === "error") statusText = t.error || "Error";
    row.querySelector(".status").textContent = statusText;

    const actions = row.querySelector(".actions-row");
    actions.innerHTML = "";

    if (t.status === "pending" && !AUTO_ACCEPT) {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "btn btn-accept";
      accept.textContent = "Aceptar";
      accept.onclick = () => acceptTransfer(transferId);
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "btn btn-reject";
      reject.textContent = "No";
      reject.onclick = () => rejectTransfer(transferId);
      actions.append(accept, reject);
    }

    if (t.status === "done" && t.blobUrl) {
      const a = document.createElement("a");
      a.className = "btn btn-dl";
      a.href = t.blobUrl;
      a.download = t.fileName;
      a.textContent = "Guardar";
      actions.appendChild(a);
    }
  }

  async function sendFiles(fileList, toOverride) {
    const files = [...fileList];
    if (!files.length) return;
    const to = toOverride || state.selectedPeerId || els.targetSelect.value;
    if (!to) {
      state.pendingFiles = files;
      alert("Toca el avatar del dispositivo al que quieres enviar.");
      return;
    }
    for (const file of files) {
      await sendOneFile(file, to);
    }
  }

  function sendOneFile(file, to) {
    return new Promise((resolve) => {
      const transferId = uid();
      state.transfers.set(transferId, {
        direction: "out",
        fileName: file.name,
        fileSize: file.size,
        status: "offering",
        progress: 0,
        peerId: to,
        resolve,
        file,
      });
      renderTransfer(transferId);
      socket.emit("transfer-offer", {
        to,
        transferId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });
    });
  }

  async function streamFile(transferId) {
    const t = state.transfers.get(transferId);
    if (!t || !t.file) return;
    t.status = "sending";
    renderTransfer(transferId);

    const file = t.file;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let offset = 0;
    let index = 0;

    try {
      while (offset < file.size || (file.size === 0 && index === 0)) {
        if (t.status === "cancelled") break;
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const buffer = await file.slice(offset, end).arrayBuffer();

        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout de red")), 60000);
          socket.emit(
            "transfer-chunk",
            { to: t.peerId, transferId, index, total: totalChunks, data: buffer },
            (res) => {
              clearTimeout(timer);
              if (res && res.ok === false) reject(new Error("Error de envío"));
              else resolve();
            }
          );
        });

        offset = end;
        index += 1;
        t.progress = offset;
        if (index % 2 === 0 || offset >= file.size) renderTransfer(transferId);
        if (file.size === 0) break;
      }

      if (t.status === "cancelled") {
        t.resolve?.();
        return;
      }
      socket.emit("transfer-done", { to: t.peerId, transferId });
      t.status = "done";
      t.progress = t.fileSize;
      renderTransfer(transferId);
      t.resolve?.();
    } catch (err) {
      t.status = "error";
      t.error = err.message || "Error al enviar";
      renderTransfer(transferId);
      socket.emit("transfer-cancel", { to: t.peerId, transferId });
      t.resolve?.();
    }
  }

  function acceptTransfer(transferId) {
    const t = state.transfers.get(transferId);
    if (!t) return;
    state.incoming.set(transferId, {
      parts: [],
      received: 0,
      total: t.fileSize,
      fileName: t.fileName,
      mimeType: t.mimeType || "application/octet-stream",
      from: t.peerId,
    });
    t.status = "receiving";
    t.progress = 0;
    renderTransfer(transferId);
    socket.emit("transfer-accept", { to: t.peerId, transferId });
  }

  function rejectTransfer(transferId) {
    const t = state.transfers.get(transferId);
    if (!t) return;
    t.status = "rejected";
    renderTransfer(transferId);
    socket.emit("transfer-reject", { to: t.peerId, transferId });
  }

  function joinUrlFor(baseUrl, roomCode, pin) {
    const u = new URL(baseUrl);
    u.searchParams.set("room", roomCode);
    u.searchParams.set("pin", pin);
    return u.toString();
  }

  function renderHostQr(baseUrl) {
    if (!state.roomCode || !state.pin || !baseUrl) return;
    const link = joinUrlFor(baseUrl, state.roomCode, state.pin);
    els.hostQr.src = `/api/qr.png?t=${encodeURIComponent(link)}`;
    els.hostQr.title = link;
  }

  function setupHostInvite(urls) {
    const list = urls?.length
      ? urls
      : [`http://${location.hostname || "localhost"}:${location.port || 3847}`];

    els.hostUrls.innerHTML = "";
    list.forEach((url) => {
      const deep = joinUrlFor(url, state.roomCode, state.pin);
      const li = document.createElement("li");
      li.textContent = url;
      li.title = "Copiar enlace del grupo";
      li.onclick = async () => {
        try {
          await navigator.clipboard.writeText(deep);
          li.textContent = "Copiado ✓";
          setTimeout(() => (li.textContent = url), 1200);
        } catch {
          /* ignore */
        }
      };
      els.hostUrls.appendChild(li);
    });

    els.qrUrlSelect.innerHTML = "";
    list.forEach((url) => {
      const opt = document.createElement("option");
      opt.value = url;
      opt.textContent = url;
      els.qrUrlSelect.appendChild(opt);
    });
    if (list.length > 1) els.qrUrlPickWrap.classList.remove("hidden");
    else els.qrUrlPickWrap.classList.add("hidden");
    renderHostQr(list[0]);
  }

  function joinRoom({ roomCode, pin, name }, { fromQr = false } = {}) {
    return new Promise((resolve) => {
      els.joinError.classList.add("hidden");
      socket.emit("join-room", { roomCode, pin, name }, (res) => {
        if (!res?.ok) {
          if (fromQr) {
            show("home");
            els.joinForm.classList.remove("hidden");
            els.joinRoom.value = roomCode || "";
            els.joinPin.value = pin || "";
          }
          els.joinError.textContent = res?.error || "No se pudo entrar";
          els.joinError.classList.remove("hidden");
          resolve(false);
          return;
        }
        state.roomCode = res.roomCode;
        state.pin = null;
        state.isHost = false;
        setMembers(res.members);
        if (fromQr && history.replaceState) {
          const q = isDesktop ? "/?app=1" : "/";
          history.replaceState({}, "", q);
        }
        enterRoomView();
        resolve(true);
      });
    });
  }

  function enterRoomView() {
    els.roomCode.textContent = state.roomCode || "----";
    if (state.pin) {
      els.roomPin.textContent = state.pin;
      els.roomPinWrap.classList.remove("hidden");
    } else {
      els.roomPinWrap.classList.add("hidden");
    }
    show("room");
  }

  async function quitApp() {
    if (window.easyApp?.quit) {
      await window.easyApp.quit();
      return;
    }
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      /* ignore */
    }
    show("closed");
  }

  els.btnQuit?.addEventListener("click", quitApp);

  els.btnCreate.addEventListener("click", () => {
    socket.emit("create-room", { name: "PC" }, (res) => {
      if (!res?.ok) {
        alert(res?.error || "No se pudo crear el grupo");
        return;
      }
      state.roomCode = res.roomCode;
      state.pin = res.pin;
      state.isHost = true;
      setMembers(res.members);
      els.hostRoom.textContent = res.roomCode;
      els.hostPin.textContent = res.pin;
      setupHostInvite(res.urls || []);
      show("host");
    });
  });

  els.qrUrlSelect.addEventListener("change", () => {
    renderHostQr(els.qrUrlSelect.value);
  });

  els.btnShowJoin.addEventListener("click", () => {
    els.joinForm.classList.toggle("hidden");
    els.joinRoom.focus();
  });

  els.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    joinRoom({
      roomCode: els.joinRoom.value.trim(),
      pin: els.joinPin.value.trim(),
      name: els.joinName.value.trim(),
    });
  });

  els.btnEnterRoom.addEventListener("click", () => enterRoomView());
  els.btnLeave.addEventListener("click", () => location.reload());

  els.btnPick.addEventListener("click", (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });
  els.dropZone.addEventListener("click", (e) => {
    if (e.target.closest("button, select, label, input")) return;
    els.fileInput.click();
  });

  els.fileInput.addEventListener("change", () => {
    if (!els.fileInput.files?.length) return;
    const to = els.fileInput.dataset.to || state.selectedPeerId;
    delete els.fileInput.dataset.to;
    sendFiles(els.fileInput.files, to || undefined);
    els.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  });
  els.dropZone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) sendFiles(e.dataTransfer.files);
  });

  socket.on("members", setMembers);

  socket.on("transfer-offer", (payload) => {
    const { from, fromName, transferId, fileName, fileSize, mimeType } = payload;
    state.transfers.set(transferId, {
      direction: "in",
      fileName,
      fileSize,
      mimeType,
      status: "pending",
      progress: 0,
      peerId: from,
      fromName,
    });
    renderTransfer(transferId);
    if (AUTO_ACCEPT) acceptTransfer(transferId);
  });

  socket.on("transfer-accept", ({ transferId }) => {
    const t = state.transfers.get(transferId);
    if (!t || t.direction !== "out") return;
    streamFile(transferId);
  });

  socket.on("transfer-reject", ({ transferId }) => {
    const t = state.transfers.get(transferId);
    if (!t) return;
    t.status = "rejected";
    renderTransfer(transferId);
    t.resolve?.();
  });

  socket.on("transfer-chunk", ({ transferId, data }) => {
    const inc = state.incoming.get(transferId);
    const t = state.transfers.get(transferId);
    if (!inc || !t) return;
    const chunk = data instanceof ArrayBuffer ? data : data?.buffer || data;
    inc.parts.push(chunk);
    inc.received += chunk.byteLength || chunk.length || 0;
    t.progress = inc.received;
    t.status = "receiving";
    renderTransfer(transferId);
    socket.emit("transfer-progress", {
      to: inc.from,
      transferId,
      received: inc.received,
      total: inc.total,
    });
  });

  socket.on("transfer-progress", ({ transferId, received }) => {
    const t = state.transfers.get(transferId);
    if (!t || t.direction !== "out") return;
    t.progress = received;
    renderTransfer(transferId);
  });

  socket.on("transfer-done", ({ transferId }) => {
    const inc = state.incoming.get(transferId);
    const t = state.transfers.get(transferId);
    if (!inc || !t) return;
    const blob = new Blob(inc.parts, { type: inc.mimeType });
    const url = URL.createObjectURL(blob);
    t.blobUrl = url;
    t.status = "done";
    t.progress = t.fileSize || inc.received;
    renderTransfer(transferId);
    state.incoming.delete(transferId);
    const a = document.createElement("a");
    a.href = url;
    a.download = t.fileName;
    a.click();
  });

  socket.on("transfer-cancel", ({ transferId }) => {
    const t = state.transfers.get(transferId);
    if (t) {
      t.status = "cancelled";
      renderTransfer(transferId);
    }
    state.incoming.delete(transferId);
  });

  [els.joinRoom, els.joinPin].forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "");
    });
  });

  function tryAutoJoinFromQuery() {
    const params = new URLSearchParams(location.search);
    const room = (params.get("room") || "").trim();
    const pin = (params.get("pin") || "").trim();
    if (!room || !pin) return;

    show("home");
    els.joinForm.classList.remove("hidden");
    els.joinRoom.value = room;
    els.joinPin.value = pin;
    els.joinError.textContent = "Entrando al grupo…";
    els.joinError.classList.remove("hidden");
    els.joinError.style.color = "var(--muted)";

    const go = () => {
      joinRoom(
        { roomCode: room, pin, name: els.joinName.value.trim() || "iPhone" },
        { fromQr: true }
      ).then((ok) => {
        if (ok) els.joinError.style.color = "";
      });
    };
    if (socket.connected) go();
    else socket.once("connect", go);
  }

  tryAutoJoinFromQuery();
})();
