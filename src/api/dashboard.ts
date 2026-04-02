export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Max Command Center</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0d1117;
      --panel: #161b22;
      --panel-2: #11161d;
      --border: #30363d;
      --text: #c9d1d9;
      --muted: #8b949e;
      --accent: #2f81f7;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    button, input, textarea {
      font: inherit;
    }
    button {
      border: 1px solid var(--border);
      background: #21262d;
      color: var(--text);
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 8px;
      padding: 10px 12px;
    }
    textarea {
      min-height: 84px;
      resize: vertical;
    }
    .page {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(320px, 420px);
      min-height: 100vh;
    }
    .main {
      display: grid;
      grid-template-rows: auto 1fr auto;
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    .topbar {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      background: rgba(22, 27, 34, 0.95);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .badge {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 10px;
      color: var(--muted);
      background: var(--panel);
      white-space: nowrap;
    }
    .badge.ok { color: var(--green); }
    .badge.warn { color: var(--yellow); }
    .badge.fail { color: var(--red); }
    .messages {
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }
    .message {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 12px;
      padding: 12px 14px;
      max-width: 90%;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: #152238;
    }
    .message.sys {
      align-self: center;
      max-width: 100%;
      color: var(--muted);
      background: transparent;
      border-style: dashed;
    }
    .message .meta {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .composer {
      border-top: 1px solid var(--border);
      padding: 16px 20px;
      background: rgba(22, 27, 34, 0.95);
      display: grid;
      gap: 10px;
    }
    .composer-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
    }
    .sidebar {
      display: grid;
      grid-auto-rows: min-content;
      gap: 14px;
      padding: 20px;
      overflow-y: auto;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--panel);
      padding: 14px;
      display: grid;
      gap: 10px;
    }
    .card h2 {
      margin: 0;
      font-size: 15px;
    }
    .card p {
      margin: 0;
      color: var(--muted);
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .row > * {
      flex: 1 1 auto;
    }
    .list {
      display: grid;
      gap: 8px;
    }
    .list-item {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      background: var(--panel-2);
    }
    .list-item strong {
      display: block;
      margin-bottom: 4px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .muted {
      color: var(--muted);
    }
    .login {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(1, 4, 9, 0.84);
      padding: 20px;
      z-index: 50;
    }
    .login.show {
      display: flex;
    }
    .login-panel {
      width: min(520px, 100%);
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel);
      padding: 20px;
      display: grid;
      gap: 12px;
    }
    .login-panel h1 {
      margin: 0;
      font-size: 20px;
    }
    .footer-note {
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 1100px) {
      .page {
        grid-template-columns: 1fr;
      }
      .main {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
    }
  </style>
</head>
<body>
  <div id="login" class="login show">
    <form id="login-form" class="login-panel">
      <h1>Max Command Center</h1>
      <p>Paste the Max API token from <span class="mono">max config show-token</span> or <span class="mono">~/.max/api-token</span>.</p>
      <input id="token-input" type="password" autocomplete="off" placeholder="Bearer token" />
      <label class="row" style="justify-content:flex-start; gap:6px;">
        <input id="remember-token" type="checkbox" style="width:auto; flex:0 0 auto;" />
        <span>Remember on this browser</span>
      </label>
      <div class="row">
        <button class="primary" type="submit">Connect</button>
        <button id="clear-token" type="button">Clear saved token</button>
      </div>
      <p id="login-error" class="footer-note"></p>
      <p class="footer-note">For VPS access, keep Max bound to 127.0.0.1 and use an SSH tunnel or HTTPS reverse proxy.</p>
    </form>
  </div>

  <div class="page">
    <section class="main">
      <div class="topbar">
        <div>
          <strong style="font-size:16px;">Max Command Center</strong>
          <div class="muted">Browser control surface for the Max daemon</div>
        </div>
        <div class="badges">
          <span id="badge-daemon" class="badge warn">daemon: unknown</span>
          <span id="badge-model" class="badge">model: --</span>
          <span id="badge-version" class="badge">version: --</span>
          <span id="badge-autostart" class="badge">autostart: --</span>
        </div>
      </div>
      <div id="messages" class="messages"></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Ask Max to code, inspect sessions, or run admin checks..."></textarea>
        <div class="composer-actions">
          <div class="row" style="flex:1 1 auto; max-width:420px;">
            <input id="model-input" type="text" placeholder="Override model id (optional)" />
            <button id="set-model" type="button">Set model</button>
          </div>
          <div class="row" style="flex:0 0 auto;">
            <button id="toggle-auto" type="button">Toggle auto-routing</button>
            <button id="cancel" type="button" disabled>Cancel</button>
            <button id="send" class="primary" type="button">Send</button>
          </div>
        </div>
      </div>
    </section>

    <aside class="sidebar">
      <section class="card">
        <h2>Status</h2>
        <div id="status-summary" class="muted">Waiting for daemon info...</div>
        <div class="row">
          <button id="refresh-all" type="button">Refresh</button>
          <button id="restart" type="button">Restart daemon</button>
        </div>
      </section>

      <section class="card">
        <h2>Doctor</h2>
        <div id="doctor-summary" class="muted">No report loaded yet.</div>
        <div id="doctor-list" class="list"></div>
      </section>

      <section class="card">
        <h2>Sessions</h2>
        <div id="sessions-list" class="list"><div class="muted">No sessions loaded.</div></div>
      </section>

      <section class="card">
        <h2>Skills</h2>
        <div id="skills-list" class="list"><div class="muted">No skills loaded.</div></div>
      </section>

      <section class="card">
        <h2>Access</h2>
        <p class="footer-note">Max still listens on <span class="mono">127.0.0.1</span> by default. For VPS use, prefer an SSH tunnel or an HTTPS reverse proxy in front of this route.</p>
      </section>
    </aside>
  </div>

  <script>
    (function () {
      const state = {
        token: sessionStorage.getItem("maxApiToken") || localStorage.getItem("maxApiToken") || "",
        connectionId: null,
        busy: false,
        connected: false,
        booted: false,
        streamAbort: null,
        currentAssistantNode: null,
        intervals: [],
        routerEnabled: false,
        lightRefreshPromise: null,
        doctorRefreshPromise: null
      };

      const login = document.getElementById("login");
      const loginForm = document.getElementById("login-form");
      const tokenInput = document.getElementById("token-input");
      const rememberInput = document.getElementById("remember-token");
      const loginError = document.getElementById("login-error");
      const messages = document.getElementById("messages");
      const prompt = document.getElementById("prompt");
      const sendButton = document.getElementById("send");
      const cancelButton = document.getElementById("cancel");
      const setModelButton = document.getElementById("set-model");
      const modelInput = document.getElementById("model-input");
      const toggleAutoButton = document.getElementById("toggle-auto");
      const refreshButton = document.getElementById("refresh-all");
      const restartButton = document.getElementById("restart");
      const clearTokenButton = document.getElementById("clear-token");

      function authHeaders() {
        return state.token ? { Authorization: "Bearer " + state.token } : {};
      }

      function appendMessage(role, content, meta) {
        const wrapper = document.createElement("div");
        wrapper.className = "message " + role;
        const metaNode = document.createElement("div");
        metaNode.className = "meta";
        metaNode.textContent = meta;
        const body = document.createElement("div");
        body.textContent = content;
        wrapper.appendChild(metaNode);
        wrapper.appendChild(body);
        messages.appendChild(wrapper);
        messages.scrollTop = messages.scrollHeight;
        return body;
      }

      function setBusy(nextBusy) {
        state.busy = nextBusy;
        sendButton.disabled = nextBusy || !state.connectionId;
        cancelButton.disabled = !nextBusy;
      }

      function setBadge(id, label, tone) {
        const node = document.getElementById(id);
        node.textContent = label;
        node.className = "badge" + (tone ? " " + tone : "");
      }

      function stopIntervals() {
        state.intervals.forEach(clearInterval);
        state.intervals = [];
      }

      function showLogin(message) {
        stopIntervals();
        login.classList.add("show");
        loginError.textContent = message || "";
        tokenInput.focus();
      }

      function hideLogin() {
        login.classList.remove("show");
        loginError.textContent = "";
      }

      async function api(path, options) {
        const init = Object.assign({ headers: authHeaders() }, options || {});
        if (init.body && !init.headers["Content-Type"]) {
          init.headers["Content-Type"] = "application/json";
        }
        const response = await fetch(path, init);
        if (response.status === 401) {
          showLogin("Authentication failed. Check your Max API token.");
          throw new Error("Unauthorized");
        }
        return response;
      }

      async function refreshInfo() {
        const response = await api("/info");
        const info = await response.json();
        document.getElementById("status-summary").textContent =
          "PID " + info.pid + " · API " + info.apiPort + " · Telegram " + (info.telegramEnabled ? "enabled" : "disabled");
        setBadge("badge-model", "model: " + info.model, "");
        setBadge("badge-version", "version: " + info.version, "");
      }

      async function refreshAutostart() {
        const response = await api("/autostart");
        const status = await response.json();
        setBadge(
          "badge-autostart",
          "autostart: " + (status.enabled ? "enabled" : "disabled"),
          status.enabled ? "ok" : "warn"
        );
      }

      async function refreshRouter() {
        const response = await api("/auto");
        const data = await response.json();
        state.routerEnabled = !!data.enabled;
        toggleAutoButton.textContent = state.routerEnabled ? "Disable auto-routing" : "Enable auto-routing";
      }

      async function refreshSessions() {
        const response = await api("/sessions");
        const sessions = await response.json();
        const container = document.getElementById("sessions-list");
        container.innerHTML = "";
        if (!sessions.length) {
          const empty = document.createElement("div");
          empty.className = "muted";
          empty.textContent = "No active sessions.";
          container.appendChild(empty);
          return;
        }

        sessions.forEach(function (session) {
          const item = document.createElement("div");
          item.className = "list-item";
          const title = document.createElement("strong");
          title.textContent = session.name + " · " + session.status;
          const cwd = document.createElement("div");
          cwd.className = "muted mono";
          cwd.textContent = session.workingDir;
          item.appendChild(title);
          item.appendChild(cwd);
          if (session.lastOutput) {
            const output = document.createElement("div");
            output.className = "muted";
            output.style.marginTop = "6px";
            output.textContent = session.lastOutput;
            item.appendChild(output);
          }
          container.appendChild(item);
        });
      }

      async function refreshSkills() {
        const response = await api("/skills");
        const skills = await response.json();
        const container = document.getElementById("skills-list");
        container.innerHTML = "";
        if (!skills.length) {
          const empty = document.createElement("div");
          empty.className = "muted";
          empty.textContent = "No skills installed.";
          container.appendChild(empty);
          return;
        }

        skills.forEach(function (skill) {
          const item = document.createElement("div");
          item.className = "list-item";
          const title = document.createElement("strong");
          title.textContent = skill.name + " · " + skill.source;
          const desc = document.createElement("div");
          desc.className = "muted";
          desc.textContent = skill.description;
          item.appendChild(title);
          item.appendChild(desc);
          container.appendChild(item);
        });
      }

      async function refreshDoctor() {
        if (state.doctorRefreshPromise) {
          return state.doctorRefreshPromise;
        }

        state.doctorRefreshPromise = (async function () {
          try {
            const response = await api("/doctor");
            const report = await response.json();
            document.getElementById("doctor-summary").textContent =
              report.summary.ok + " ok · " + report.summary.warn + " warn · " + report.summary.fail + " fail";
            const list = document.getElementById("doctor-list");
            list.innerHTML = "";
            report.checks.forEach(function (check) {
              if (check.level === "ok") return;
              const item = document.createElement("div");
              item.className = "list-item";
              const title = document.createElement("strong");
              title.textContent = check.label + " · " + check.level;
              const detail = document.createElement("div");
              detail.className = "muted";
              detail.textContent = check.detail;
              item.appendChild(title);
              item.appendChild(detail);
              list.appendChild(item);
            });
            if (!list.childNodes.length) {
              const empty = document.createElement("div");
              empty.className = "muted";
              empty.textContent = "No doctor warnings right now.";
              list.appendChild(empty);
            }
          } catch (error) {
            if (error.message === "Unauthorized") {
              return;
            }
            document.getElementById("doctor-summary").textContent = "Doctor refresh unavailable.";
            const list = document.getElementById("doctor-list");
            list.innerHTML = "";
            const item = document.createElement("div");
            item.className = "muted";
            item.textContent = "Last doctor refresh failed: " + error.message;
            list.appendChild(item);
          }
        }());

        try {
          await state.doctorRefreshPromise;
        } finally {
          state.doctorRefreshPromise = null;
        }
      }

      async function refreshLight() {
        if (state.lightRefreshPromise) {
          return state.lightRefreshPromise;
        }

        state.lightRefreshPromise = (async function () {
          try {
            await Promise.all([
              refreshInfo(),
              refreshAutostart(),
              refreshRouter(),
              refreshSessions(),
              refreshSkills()
            ]);
            state.connected = true;
            setBadge("badge-daemon", state.connectionId ? "daemon: connected" : "daemon: waiting for stream", state.connectionId ? "ok" : "warn");
          } catch (error) {
            if (error.message !== "Unauthorized") {
              setBadge("badge-daemon", "daemon: unavailable", "fail");
            }
          }
        }());

        try {
          await state.lightRefreshPromise;
        } finally {
          state.lightRefreshPromise = null;
        }
      }

      async function refreshAll() {
        await refreshLight();
        await refreshDoctor();
      }

      async function connectStream() {
        if (!state.token) return;

        if (state.streamAbort) {
          state.streamAbort.abort();
        }
        state.streamAbort = new AbortController();

        try {
          const response = await fetch("/stream", {
            headers: authHeaders(),
            signal: state.streamAbort.signal,
            cache: "no-store"
          });
          if (response.status === 401) {
            showLogin("Authentication failed. Check your Max API token.");
            return;
          }
          if (!response.body) {
            throw new Error("Streaming response body unavailable.");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const result = await reader.read();
            if (result.done) {
              throw new Error("Stream ended");
            }
            buffer += decoder.decode(result.value, { stream: true });
            let boundary = buffer.indexOf("\\n\\n");
            while (boundary !== -1) {
              const chunk = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              handleSseChunk(chunk);
              boundary = buffer.indexOf("\\n\\n");
            }
          }
        } catch (error) {
          if (error.name !== "AbortError") {
            state.connectionId = null;
            state.currentAssistantNode = null;
            setBusy(false);
            appendMessage("sys", "Stream disconnected. Reconnecting...", "system");
            setBadge("badge-daemon", "daemon: reconnecting", "warn");
            setTimeout(connectStream, 2000);
          }
        }
      }

      function handleSseChunk(chunk) {
        const lines = chunk.split("\\n");
        const dataLines = [];
        lines.forEach(function (line) {
          if (line.startsWith("data: ")) dataLines.push(line.slice(6));
        });
        if (!dataLines.length) return;

        let event;
        try {
          event = JSON.parse(dataLines.join("\\n"));
        } catch (_error) {
          return;
        }

        if (event.type === "connected") {
          state.connectionId = event.connectionId;
          sendButton.disabled = false;
          setBadge("badge-daemon", "daemon: connected", "ok");
          return;
        }

        if (event.type === "delta") {
          if (!state.currentAssistantNode) {
            state.currentAssistantNode = appendMessage("max", "", "max · streaming");
          }
          state.currentAssistantNode.textContent += event.content;
          messages.scrollTop = messages.scrollHeight;
          return;
        }

        if (event.type === "message") {
          const meta = event.route && event.route.routerMode === "auto"
            ? "max · " + event.route.model + (event.route.overrideName ? " · " + event.route.overrideName : "")
            : "max";
          if (state.currentAssistantNode) {
            state.currentAssistantNode.textContent = event.content;
            state.currentAssistantNode.parentNode.querySelector(".meta").textContent = meta;
          } else {
            appendMessage("max", event.content, meta);
          }
          state.currentAssistantNode = null;
          setBusy(false);
          return;
        }

        if (event.type === "cancelled") {
          appendMessage("sys", "Current response cancelled.", "system");
          state.currentAssistantNode = null;
          setBusy(false);
        }
      }

      async function sendPrompt() {
        const value = prompt.value.trim();
        if (!value || !state.connectionId || state.busy) return;
        appendMessage("user", value, "you");
        prompt.value = "";
        state.currentAssistantNode = null;
        setBusy(true);

        try {
          const response = await api("/message", {
            method: "POST",
            body: JSON.stringify({ prompt: value, connectionId: state.connectionId })
          });
          if (!response.ok) {
            const payload = await response.json().catch(function () { return { error: "Unknown error" }; });
            appendMessage("sys", payload.error || "Failed to send prompt.", "system");
            setBusy(false);
          }
        } catch (error) {
          if (error.message !== "Unauthorized") {
            appendMessage("sys", "Failed to send prompt: " + error.message, "system");
            setBusy(false);
          }
        }
      }

      async function cancelPrompt() {
        try {
          await api("/cancel", { method: "POST" });
        } catch (_error) {
          // login flow already handled
        }
      }

      async function restartDaemon() {
        if (!confirm("Restart the Max daemon?")) return;
        await api("/restart", { method: "POST" });
        appendMessage("sys", "Restart requested. Waiting for Max to come back...", "system");
        setBadge("badge-daemon", "daemon: restarting", "warn");
        state.connectionId = null;
        setBusy(false);
        setTimeout(connectStream, 1500);
      }

      async function toggleAuto() {
        const response = await api("/auto");
        const data = await response.json();
        await api("/auto", {
          method: "POST",
          body: JSON.stringify({ enabled: !data.enabled })
        });
        await refreshRouter();
      }

      async function updateModel() {
        const value = modelInput.value.trim();
        if (!value) return;
        const response = await api("/model", {
          method: "POST",
          body: JSON.stringify({ model: value })
        });
        const data = await response.json();
        if (data.error) {
          appendMessage("sys", data.error, "system");
          return;
        }
        modelInput.value = "";
        await refreshInfo();
      }

      function saveToken(token, remember) {
        state.token = token.trim();
        sessionStorage.setItem("maxApiToken", state.token);
        if (remember) localStorage.setItem("maxApiToken", state.token);
        else localStorage.removeItem("maxApiToken");
      }

      function clearStoredToken() {
        state.token = "";
        state.connectionId = null;
        if (state.streamAbort) {
          state.streamAbort.abort();
          state.streamAbort = null;
        }
        stopIntervals();
        sessionStorage.removeItem("maxApiToken");
        localStorage.removeItem("maxApiToken");
      }

      function startIntervals() {
        stopIntervals();
        state.intervals = [
          setInterval(refreshLight, 15000),
          setInterval(refreshDoctor, 60000),
          setInterval(refreshSessions, 5000)
        ];
      }

      async function boot() {
        if (!state.token) {
          showLogin("");
          return;
        }
        hideLogin();
        if (!state.booted) {
          appendMessage("sys", "Connected to the Max command center.", "system");
        }
        state.booted = true;
        await refreshAll();
        startIntervals();
        void connectStream();
      }

      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const token = tokenInput.value.trim();
        if (!token) {
          showLogin("Enter your Max API token to continue.");
          return;
        }
        saveToken(token, rememberInput.checked);
        boot();
      });

      clearTokenButton.addEventListener("click", function () {
        clearStoredToken();
        tokenInput.value = "";
        showLogin("Saved token cleared.");
      });

      sendButton.addEventListener("click", sendPrompt);
      cancelButton.addEventListener("click", cancelPrompt);
      restartButton.addEventListener("click", restartDaemon);
      refreshButton.addEventListener("click", refreshAll);
      toggleAutoButton.addEventListener("click", toggleAuto);
      setModelButton.addEventListener("click", updateModel);
      prompt.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          sendPrompt();
        }
      });

      if (state.token) {
        tokenInput.value = state.token;
        boot();
      } else {
        showLogin("");
      }
    }());
  </script>
</body>
</html>`;
}
