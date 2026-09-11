(() => {
  "use strict";

  const state = {
    config: {},
    servers: [],
    serverMap: new Map(),
    ws: null,
    reconnectTimer: null,
    demo: new URLSearchParams(location.search).get("demo") === "1"
  };

  // /api/servers 返回 servers[].region（通常为 ISO 两字母区域代码）。
  // 不维护英文地区名称，直接把 API 的区域代码转换成 Unicode 国旗。
  function regionFlag(region) {
  const code = String(region || "").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return "";
  return `<img class="server-flag" src="/flags/${code}.svg" alt="" onerror="this.replaceWith(document.createTextNode(flagFallback('${code}')))" />`;
}

function flagFallback(code) {
  return code.length === 2
    ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0)))
    : "";
}

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function bytes(v) {
    let n = Math.max(0, num(v));
    const units = ["B", "K", "M", "G", "T", "P"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    if (i === 0) return `${Math.round(n)}B`;
    if (n >= 100) return `${n.toFixed(0)}${units[i]}`;
    if (n >= 10) return `${n.toFixed(2)}${units[i]}`;
    return `${n.toFixed(2)}${units[i]}`;
  }

  function speed(v) {
    return `${bytes(v)}/s`;
  }

  function capacity(mb) {
    const n = Math.max(0, num(mb));
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}TB`;
    if (n >= 1024) return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)}GB`;
    return `${Math.round(n)}MB`;
  }

  function percent(used, total) {
    const t = num(total);
    return t > 0 ? clamp(num(used) / t * 100, 0, 100) : 0;
  }

  function fmtPct(v) {
    const n = num(v);
    return `${n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "")}%`;
  }

  function fmtLoad(v) {
    if (Array.isArray(v)) return v.slice(0, 3).map(x => num(x).toFixed(2)).join(" | ");
    const s = String(v ?? "0 0 0").trim().replace(/\s+/g, " ");
    if (!s) return "0.00 | 0.00 | 0.00";
    return s.split(/[ ,|]+/).slice(0, 3).map(x => {
      const n = Number(x);
      return Number.isFinite(n) ? n.toFixed(2) : x;
    }).join(" | ");
  }

  function uptime(boot) {
    const t = num(boot);
    if (!t) return "0:00:00";
    const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
    const days = Math.floor(seconds / 86400);
    const h = Math.floor(seconds % 86400 / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = seconds % 60;
    if (days > 0) return `${days} 天`;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function online(server) {
    if (typeof server.is_online === "boolean") return server.is_online;
    const ts = num(server.last_updated);
    return ts > 0 && Date.now() - ts <= 300000;
  }

  function regionCode(server) {
    return String(server.region || server.country || server.server_group || "UN").toUpperCase().slice(0, 2);
  }

  function flag(server) {
    return regionFlag(server.region);
  }

  function osIcon(server) {
    const os = String(server.os || "").toLowerCase();
    if (os.includes("windows")) return "▣";
    if (os.includes("ubuntu") || os.includes("debian") || os.includes("linux") ||
        os.includes("alpine") || os.includes("centos") || os.includes("openwrt")) return "◉";
    if (os.includes("mac") || os.includes("darwin")) return "◌";
    return "◉";
  }

  function groupName(server) {
    const g = String(server.server_group || "").trim();
    return g || "other";
  }

  function progress(label, value, offline) {
    const p = clamp(num(value), 0, 100);
    return `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <div class="bar">
          <div class="bar-fill ${offline ? "offline" : ""}" style="width:${p}%"></div>
          <span class="bar-value">${fmtPct(p)}</span>
        </div>
      </div>`;
  }

  function card(server) {
    const offline = !online(server);
    const ramPct = percent(server.ram_used, server.ram_total);
    const swapPct = percent(server.swap_used, server.swap_total);
    const diskPct = percent(server.disk_used, server.disk_total);

    return `
      <article class="card" data-id="${esc(server.id)}">
        <header class="card-head">
          <span class="flag">${flag(server)}</span>
          <span class="os">${osIcon(server)}</span>
          <span class="name" title="${esc(server.name)}">${esc(server.name || "Unnamed")}${offline ? "[已离线]" : ""}</span>
          <button class="info" type="button" data-info="${esc(server.id)}" aria-label="服务器信息">i</button>
        </header>

        <div class="metrics">
          ${progress("CPU", server.cpu, offline)}
          ${progress("内存", ramPct, offline)}
          ${progress("交换", swapPct, offline)}
          ${progress("硬盘", diskPct, offline)}

          <div class="text-row">
            <span class="text-label">网速</span>
            <span class="text-value">
              <span class="icon-down">⭡</span>${speed(server.net_in_speed)}
              <span class="icon-up">⭣</span>${speed(server.net_out_speed)}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">流量</span>
            <span class="text-value">
              <span class="icon-down">⟲</span>${bytes(server.net_rx)}
              <span class="icon-up">↺</span>${bytes(server.net_tx)}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">信息</span>
            <span class="text-value">
              <span class="icon-cpu">⚙</span>${num(server.cpu_cores)} Cores
              <span class="icon-ram">▤</span>${capacity(server.ram_total)}
              <span class="icon-disk">▱</span>${capacity(server.disk_total)}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">负载</span>
            <span class="text-value">
              <span class="icon-load">෴</span>${esc(fmtLoad(server.load_avg))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">在线</span>
            <span class="text-value">
              <span class="status-dot ${offline ? "offline" : ""}"></span>${uptime(server.boot_time)}
            </span>
          </div>
        </div>
      </article>`;
  }

  function groupedServers() {
    const groups = new Map();
    for (const s of state.servers) {
      const g = groupName(s);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    return groups;
  }

  function render() {
    const app = document.querySelector("#app");
    if (!state.servers.length) {
      app.innerHTML = `<div class="error">暂无可显示的服务器</div>`;
      return;
    }

    const groups = groupedServers();
    app.innerHTML = Array.from(groups.entries()).map(([name, servers]) => `
      <section class="group" data-group="${esc(name)}">
        <h2 class="group-title" data-collapse="${esc(name)}">
          <span class="group-arrow">▼</span>
          <span>${esc(name)}</span>
        </h2>
        <div class="server-grid">${servers.map(card).join("")}</div>
      </section>
    `).join("");

    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll("[data-collapse]").forEach(el => {
      el.addEventListener("click", () => el.closest(".group").classList.toggle("collapsed"));
    });

    document.querySelectorAll("[data-info]").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = state.serverMap.get(btn.dataset.info);
        if (s) showInfo(s);
      });
    });
  }

  function formatStartTime(ts) {
    const n = num(ts);
    if (!n) return "—";
    const d = new Date(n);
    const pad = x => String(x).padStart(2, "0");
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function showInfo(s) {
    let modal = document.querySelector(".modal-mask");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal-mask";
      modal.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-title"></div>
          <div class="modal-grid"></div>
          <button class="modal-close" type="button">×</button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", e => {
        if (e.target === modal || e.target.classList.contains("modal-close")) modal.classList.remove("show");
      });
    }

    const title = modal.querySelector(".modal-title");
    const grid = modal.querySelector(".modal-grid");
    title.textContent = `${s.name || "Server"} 信息`;
    const swapTotal = num(s.swap_total);
    const swapText = swapTotal > 0 ? `${capacity(s.swap_used)}/${capacity(swapTotal)}` : "OFF";
    grid.innerHTML = [
      ["系统", `${s.os || "—"} [${s.arch || "—"}]`],
      ["CPU", s.cpu_info ? s.cpu_info : `${num(s.cpu_cores)} Core`],
      ["硬盘", `${capacity(s.disk_used)}/${capacity(s.disk_total)}`],
      ["内存", `${capacity(s.ram_used)}/${capacity(s.ram_total)}`],
      ["交换", swapText],
      ["流量", `⇡ ${bytes(s.net_rx)} ⇣ ${bytes(s.net_tx)}`],
      ["负载", fmtLoad(s.load_avg)],
      ["进程数", num(s.processes)],
      ["连接数", `TCP ${num(s.tcp_conn)} / UDP ${num(s.udp_conn)}`],
      ["启动", formatStartTime(s.boot_time)],
    ].map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join("");
    const btn = document.querySelector(`[data-info="${CSS.escape(String(s.id))}"]`);
    if (btn) {
      const r = btn.getBoundingClientRect();
      const mw = 330;
      let left = r.right - mw;
      let top = r.bottom + 7;
      left = Math.max(10, Math.min(left, window.innerWidth - mw - 10));
      if (top + 330 > window.innerHeight) top = Math.max(10, r.top - 340);
      modal.querySelector(".modal").style.left = `${left}px`;
      modal.querySelector(".modal").style.top = `${top}px`;
    }
    modal.classList.add("show");
  }

  function mergeServer(id, data) {
    const current = state.serverMap.get(id);
    if (!current) return;
    state.serverMap.set(id, Object.assign({}, current, data, { id }));
  }

  async function load() {
    if (state.demo) {
      state.config = { site_title: "NEZHA Classic", is_public: true };
      state.servers = demoData();
      state.servers.forEach(s => state.serverMap.set(s.id, s));
      render();
      return;
    }

    try {
      const cfgRes = await fetch("/api/config", { credentials: "same-origin" });
      if (cfgRes.ok) state.config = await cfgRes.json();

      const res = await fetch("/api/servers", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`API /api/servers ${res.status}`);
      const data = await res.json();

      state.servers = Array.isArray(data.servers) ? data.servers : [];
      state.serverMap = new Map(state.servers.map(s => [s.id, s]));
      render();
      connectWS();
    } catch (err) {
      console.error(err);
      document.querySelector("#app").innerHTML =
        `<div class="error">无法读取服务器数据：${esc(err.message)}<br><small>如果启用了 Turnstile，请使用项目内置的验证流程；如果站点为私有站点，请先登录。</small></div>`;
    }
  }

  function connectWS() {
    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${location.host}/api/ws`);
    url.searchParams.set("subscribe", "all");

    const token = localStorage.getItem("jwt_token");
    if (token && state.config.is_public !== true && state.config.is_public !== "true") {
      url.searchParams.set("token", token);
    }

    const ws = new WebSocket(url.toString());
    state.ws = ws;

    ws.onopen = () => {
      const ids = state.servers.map(s => s.id).filter(Boolean);
      try {
        ws.send(JSON.stringify({ type: "subscribe", scope: "all", ids }));
      } catch (_) {}
    };

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "batchUpdate") return;

        for (const u of msg.updates || []) {
          for (const sample of u.samples || []) {
            if (sample && sample.data) mergeServer(u.serverId, sample.data);
          }
        }

        state.servers = state.servers.map(s => state.serverMap.get(s.id) || s);
        render();
      } catch (err) {
        console.warn("WS message error", err);
      }
    };

    ws.onclose = () => {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connectWS, 5000);
    };

    ws.onerror = () => {
      try { ws.close(); } catch (_) {}
    };
  }

  function demoData() {
    const now = Date.now();
    const mk = (id, name, region, cpu, ram, disk, days) => ({
      id, name, region, server_group: "other",
      cpu, ram_total: 1024, ram_used: 1024 * ram / 100,
      swap_total: 0, swap_used: 0,
      disk_total: 40960, disk_used: 40960 * disk / 100,
      net_in_speed: 3580, net_out_speed: 3670,
      net_rx: 440.51 * 1024 ** 2, net_tx: 432.88 * 1024 ** 2,
      cpu_cores: 2, load_avg: "0.03 0.01 0.00",
      boot_time: now - days * 86400000, last_updated: now
    });
    return [
      mk("1", "香港-0", "HK", 0, 14, 17, 0.27),
      mk("2", "香港-1", "HK", 0, 0, 0, 0.1),
      mk("3", "香港-2", "HK", 0, 0, 0, 0.1),
      mk("4", "香港-3", "HK", 1, 14, 16, 10),
      mk("5", "美国", "US", 7, 67, 16, 312),
      mk("6", "香港-A", "HK", 2, 29, 47, 55),
      mk("7", "香港-B", "HK", 0, 26, 40, 55),
      mk("8", "台湾-A", "TW", 3, 21, 29, 404),
      mk("9", "台湾-B", "TW", 0, 23, 29, 18),
      mk("10", "新加坡", "SG", 3, 78, 58, 118)
    ];
  }

  load();
})();
