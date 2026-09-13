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
    if (!t) return "00:00:00";
    const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
    const days = Math.floor(seconds / 86400);
    const h = Math.floor(seconds % 86400 / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = seconds % 60;
    if (days > 0) return `${days} 天`;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    const os = String(server.os || '').toLowerCase().trim();
    const map = [
      ['almalinux', 'os-alma.svg'], ['alma', 'os-alma.svg'],
      ['alpine', 'os-alpine.webp'],
      ['centos', 'os-centos.svg'], ['cent os', 'os-centos.svg'],
      ['debian', 'os-debian.svg'], ['debian gnu/linux', 'os-debian.svg'], ['deb', 'os-debian.svg'],
      ['ubuntu', 'os-ubuntu.svg'], ['elementary', 'os-ubuntu.svg'],
      ['macos', 'os-macos.svg'], ['mac os', 'os-macos.svg'], ['darwin', 'os-macos.svg'], ['os x', 'os-macos.svg'],
      ['windows', 'os-windows.svg'], ['win32', 'os-windows.svg'], ['win64', 'os-windows.svg'], ['win10', 'os-windows.svg'], ['win11', 'os-windows.svg'], ['win server', 'os-windows.svg'], ['microsoft', 'os-windows.svg'],
      ['arch', 'os-arch.svg'], ['archlinux', 'os-arch.svg'], ['arch linux', 'os-arch.svg'],
      ['kali', 'os-kail.svg'], ['kail', 'os-kail.svg'],
      ['istoreos', 'os-istore.png'], ['istore', 'os-istore.png'],
      ['openwrt', 'os-openwrt.svg'], ['open wrt', 'os-openwrt.svg'], ['open-wrt', 'os-openwrt.svg'], ['qwrt', 'os-openwrt.svg'], ['kwrt', 'os-openwrt.svg'],
      ['immortalwrt', 'os-openwrt.svg'], ['immortal', 'os-openwrt.svg'],
      ['nixos', 'os-nix.svg'], ['nix os', 'os-nix.svg'],
      ['rocky', 'os-rocky.svg'], ['fedora', 'os-fedora.svg'],
      ['opensuse', 'os-openSUSE.svg'], ['open suse', 'os-openSUSE.svg'], ['suse', 'os-openSUSE.svg'],
      ['gentoo', 'os-gentoo.svg'], ['redhat', 'os-redhat.svg'], ['rhel', 'os-redhat.svg'], ['red hat', 'os-redhat.svg'],
      ['mint', 'os-mint.svg'], ['linux mint', 'os-mint.svg'],
      ['manjaro', 'os-manjaro-.svg'], ['armbian', 'os-armbian.png'], ['armbox', 'os-armbian.png'],
      ['synology', 'os-synology.ico'], ['dsm', 'os-synology.ico'],
      ['proxmox', 'os-proxmox.ico'], ['pve', 'os-proxmox.ico'],
      ['alibaba', 'os-alibaba.svg'], ['aliyun', 'os-alibaba.svg'], ['alinux', 'os-alibaba.svg'], ['anolis', 'os-alibaba.svg'], ['openanolis', 'os-alibaba.svg'], ['阿里', 'os-alibaba.svg'], ['龙蜥', 'os-alibaba.svg'],
      ['opencloud', 'os-opencloud.svg'], ['opencloudos', 'os-opencloud.svg'],
      ['oracle', 'os-oracle.svg'], ['oracle linux', 'os-oracle.svg']
    ];
    const hit = map.find(([keyword]) => os.includes(keyword));
    const image = hit ? hit[1] : 'os-unknown.svg';
    return `<img src="/os-icons/${image}" alt="" title="${esc(server.os || 'Unknown')}" onerror="this.src='/os-icons/os-unknown.svg'">`;
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
          <span class="name" title=ㅤㅤ"${esc(server.name)}">${esc(server.name || "Unnamed")}${offline ? "[已离线]" : ""}</span>
          <button class="info" type="button" data-info="${esc(server.id)}" aria-label="服务器信息">${osIcon(server)}</button>
        </header>

        <div class="metrics">
          ${progress("CPU", server.cpu, offline)}
          ${progress("内存", ramPct, offline)}
          ${progress("交换", swapPct, offline)}
          ${progress("硬盘", diskPct, offline)}

          <div class="text-row">
            <span class="text-label">网速</span>
            <span class="text-value">
              <span class="icon-down">⤵</span>${speed(server.net_in_speed)}
              <span class="icon-up">⤴</span>${speed(server.net_out_speed)}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">流量</span>
            <span class="text-value">
              <span class="icon-down">⇊</span>${bytes(server.net_rx)}  
              <span class="icon-up">ㅤ⇈</span>${bytes(server.net_tx)}  
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">信息</span>
            <span class="text-value">
              <span class="icon-cpu">❆</span>${num(server.cpu_cores)}Core
              <span class="icon-ram">▥</span>${capacity(server.ram_total)}
              <span class="icon-disk">▤</span>${capacity(server.disk_total)}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">负载</span>
            <span class="text-value">
              <span class="icon-load">𓂃</span>${esc(fmtLoad(server.load_avg))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">在线</span>
            <span class="text-value">
              <span class="status-dot ${offline ? "offline" : ""}"></span>${uptime(server.boot_time, server.last_updated, online(server))}
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
        <div class="ws-status" id="ws-status">
          <span></span>
        </div>
        <a class="admin-link" href="/admin#/admin" aria-label="登录">☘︎</a>
        <div class="server-grid">${servers.map(card).join("")}</div>
      </section>
    `).join("");

    bindEvents();
  }

  function bindEvents() {
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
      ["流量", `⇊ ${bytes(s.net_rx)} ⇈ ${bytes(s.net_tx)}`],
      ["负载", fmtLoad(s.load_avg)],
      ["进程数", num(s.processes)],
      ["连接数", `TCP ${num(s.tcp_conn)} / UDP ${num(s.udp_conn)}`],
      ["启动", formatStartTime(s.boot_time)],
      ["活动", formatLastReport(s.last_updated)],
      ["版本", s.agent_version || "未知"],
    ].map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join("");
    const btn = document.querySelector(`[data-info="${CSS.escape(String(s.id))}"]`);
    if (btn) {
      const r = btn.getBoundingClientRect();
      const mw = 328;
      let left = r.right - mw;
      let top = r.bottom + 7;
      left = Math.max(10, Math.min(left, window.innerWidth - mw - 10));
      if (top + 330 > window.innerHeight) top = Math.max(10, r.top - 338);
      modal.querySelector(".modal").style.left = `${left}px`;
      modal.querySelector(".modal").style.top = `${top}px`;
    }
    modal.classList.add("show");
  }

  function mergeServer(id, data) {
    const current = state.serverMap.get(id);
    if (!current || !data) return;
    state.serverMap.set(id, Object.assign({}, current, data, { id }));
  }

  function formatLastReport(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return "未知";
    const d = new Date(ts);

    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} `
         + `${String(d.getHours()).padStart(2, "0")}:`
         + `${String(d.getMinutes()).padStart(2, "0")}:`
         + `${String(d.getSeconds()).padStart(2, "0")}`;
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

  function updateVisibleCards() {
    for (const s of state.servers) {
      const el = document.querySelector(`.card[data-id="${CSS.escape(String(s.id))}"]`);
      if (!el) continue;
      const offline = !online(s);
      const ramPct = percent(s.ram_used, s.ram_total);
      const swapPct = percent(s.swap_used, s.swap_total);
      const diskPct = percent(s.disk_used, s.disk_total);
      const values = [s.cpu, ramPct, swapPct, diskPct];
      el.querySelectorAll('.bar-fill').forEach((bar,i) => {
        bar.style.width = `${clamp(num(values[i]),0,100)}%`;
        bar.classList.toggle('offline', offline);
      });
      el.querySelectorAll('.bar-value').forEach((v,i) => v.textContent = fmtPct(values[i]));
      const rows = el.querySelectorAll('.text-row');
      if (rows[0]) rows[0].querySelector('.text-value').innerHTML = `<span class="icon-down">⤵</span>${speed(s.net_in_speed)} <span class="icon-up">⤴</span>${speed(s.net_out_speed)}`;
      if (rows[1]) rows[1].querySelector('.text-value').innerHTML = `<span class="icon-down">⇊</span>${bytes(s.net_rx)}  <span class="icon-up">⇈</span>${bytes(s.net_tx)}`;
      if (rows[2]) rows[2].querySelector('.text-value').innerHTML = `<span class="icon-cpu">❆</span>${num(s.cpu_cores)}Core <span class="icon-ram">▥</span>${capacity(s.ram_total)}  <span class="icon-disk">▤</span>${capacity(s.disk_total)} `;
      if (rows[3]) rows[3].querySelector('.text-value').innerHTML = `<span class="icon-load">𓂃</span>${esc(fmtLoad(s.load_avg))}`;
      if (rows[4]) rows[4].querySelector('.text-value').innerHTML = `<span class="status-dot ${offline ? 'offline' : ''}"></span>${uptime(s.boot_time, s.last_updated, !offline)}`;
      const name = el.querySelector('.name');
      if (name) { name.textContent = `${s.name || 'Unnamed'}${offline ? '[已离线]' : ''}`; name.title = s.name || ''; }
      const info = el.querySelector('.info');
      if (info) info.innerHTML = osIcon(s);
    }
  }

function connectWS() {
  if (state.ws) {
    try { state.ws.close(); } catch (_) {}
  }

  // 后台设置：
  // frontend_ws_timeout_minutes
  // 0 = 不限制
  // >0 = WSS 建立后持续指定分钟，然后主动关闭
  const timeoutMinutes = Number(
    state.config?.frontend_ws_timeout_minutes ?? 0
  );

  const wsLifetimeMs =
    Number.isFinite(timeoutMinutes) &&
    timeoutMinutes > 0
      ? timeoutMinutes * 60 * 1000
      : 0;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${location.host}/api/ws`);
  url.searchParams.set("subscribe", "all");

  const token = localStorage.getItem("jwt_token");
  if (
    token &&
    state.config.is_public !== true &&
    state.config.is_public !== "true"
  ) {
    url.searchParams.set("token", token);
  }

  const ws = new WebSocket(url.toString());
  state.ws = ws;

  // 当前这条连接自己的生命周期计时器
  let lifetimeTimer = null;

  ws.onopen = () => {
    const wsStatus = document.getElementById("ws-status");
    if (wsStatus) {
      wsStatus.classList.remove("disconnected");
      wsStatus.classList.add("connected");
    }
    const ids = state.servers.map(s => s.id).filter(Boolean);

    try {
      ws.send(JSON.stringify({
        type: "subscribe",
        scope: "all",
        ids
      }));
    } catch (_) {}

    // 清理旧计时器
    if (lifetimeTimer) {
      clearTimeout(lifetimeTimer);
      lifetimeTimer = null;
    }

    // 后台设置 > 0 才启动生命周期限制
    if (wsLifetimeMs > 0) {
      lifetimeTimer = setTimeout(() => {
        // 到达后台设定时间：
        // 只关闭当前 WSS，不刷新页面，不重新连接
        try {
          ws.close(1000, "frontend websocket timeout");
        } catch (_) {}

        state.ws = null;
      }, wsLifetimeMs);
    }
  };

  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg.type !== "batchUpdate") return;

      for (const u of msg.updates || []) {
        if (!u || !u.serverId) continue;

        for (const sample of u.samples || []) {
          if (!sample || typeof sample !== "object") continue;

          const data =
            sample.data ||
            sample.payload ||
            sample.metrics;

          if (data) {
            mergeServer(u.serverId, data);
          }
        }
      }

      state.servers = state.servers.map(
        s => state.serverMap.get(s.id) || s
      );

      updateVisibleCards();

    } catch (err) {
      console.warn("WS message error", err);
    }
  };

  ws.onclose = () => {
    const wsStatus = document.getElementById("ws-status");
    if (wsStatus) {
      wsStatus.classList.remove("connected");
      wsStatus.classList.add("disconnected");
    }
    if (lifetimeTimer) {
      clearTimeout(lifetimeTimer);
      lifetimeTimer = null;
    }

    // 不自动重连。
    // WSS 是否持续、持续多久，完全由后台 frontend_ws_timeout_minutes 控制。
    state.ws = null;
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch (_) {}
  };
}
  load();
})();
