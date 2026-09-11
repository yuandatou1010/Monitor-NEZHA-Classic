/* app.js */

(() => {
  "use strict";

  const state = {
    servers: [],
    ws: null,
    reconnectTimer: null,

    /*
     * 地址栏增加 ?demo=1 可以显示演示数据：
     * https://your-domain.com/?demo=1
     */
    demo: new URLSearchParams(location.search).get("demo") === "1",
  };

  const $ = (selector, root = document) => {
    return root.querySelector(selector);
  };

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const toNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const clamp = (value, min = 0, max = 100) => {
    return Math.max(min, Math.min(max, toNumber(value)));
  };

  const formatPercent = (value) => {
    return `${clamp(value).toFixed(0)}%`;
  };

  const formatBytes = (value) => {
    let number = toNumber(value);
    const units = ["B", "KB", "MB", "GB", "TB"];

    let unitIndex = 0;

    while (
      Math.abs(number) >= 1024 &&
      unitIndex < units.length - 1
    ) {
      number /= 1024;
      unitIndex += 1;
    }

    return `${number.toFixed(unitIndex ? 2 : 0)} ${units[unitIndex]}`;
  };

  const formatSpeed = (value) => {
    return `${formatBytes(value)}/s`;
  };

  const formatCapacity = (value) => {
    /*
     * 当前兼容 ram_total / disk_total 以 MB 为单位的数据结构。
     */
    return formatBytes(toNumber(value) * 1024 * 1024);
  };

  const formatLoad = (value) => {
    if (Array.isArray(value)) {
      return value
        .slice(0, 3)
        .map((item) => toNumber(item).toFixed(2))
        .join(" ");
    }

    if (value === null || value === undefined || value === "") {
      return "0.00 0.00 0.00";
    }

    return String(value);
  };

  const formatDate = (value) => {
    if (!value) {
      return "-";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getUptime = (bootTime) => {
    if (!bootTime) {
      return "-";
    }

    const start = new Date(bootTime).getTime();

    if (!Number.isFinite(start)) {
      return "-";
    }

    const difference = Math.max(0, Date.now() - start);
    const totalHours = Math.floor(difference / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (days > 0) {
      return `${days}天 ${hours}小时`;
    }

    return `${hours}小时`;
  };

  const getFlagHtml = (region) => {
    const code = String(region || "").trim().toLowerCase();

    if (!/^[a-z]{2}$/.test(code)) {
      return "";
    }

    const safeCode = escapeHtml(code);

    return `
      <img
        class="server-flag"
        src="/flags/${safeCode}.svg"
        alt=""
        onerror="this.style.display='none'"
      >
    `;
  };

  const getMemoryPercent = (server) => {
    const total = toNumber(server.ram_total);

    if (total <= 0) {
      return 0;
    }

    return toNumber(server.ram_used) / total * 100;
  };

  const getSwapPercent = (server) => {
    const total = toNumber(server.swap_total);

    if (total <= 0) {
      return 0;
    }

    return toNumber(server.swap_used) / total * 100;
  };

  const getDiskPercent = (server) => {
    const total = toNumber(server.disk_total);

    if (total <= 0) {
      return 0;
    }

    return toNumber(server.disk_used) / total * 100;
  };

  const isOffline = (server) => {
    return (
      server.online === false ||
      server.status === "offline" ||
      server.status === 0
    );
  };

  const progress = (
    label,
    value,
    type = "",
    offline = false
  ) => {
    const percent = clamp(value);

    return `
      <div class="metric">
        <span class="metric-label">${label}</span>

        <div class="bar">
          <div
            class="bar-fill ${type} ${offline ? "offline" : ""}"
            style="width: ${percent}%"
          ></div>

          <span class="bar-value">
            ${formatPercent(percent)}
          </span>
        </div>
      </div>
    `;
  };

  const getServerName = (server) => {
    return (
      server.name ||
      server.hostname ||
      server.server_name ||
      server.id ||
      "未命名服务器"
    );
  };

  const serverCard = (server) => {
    const offline = isOffline(server);
    const serverName = getServerName(server);

    const memoryPercent = getMemoryPercent(server);
    const swapPercent = getSwapPercent(server);
    const diskPercent = getDiskPercent(server);

    return `
      <article class="server-card">
        <div class="server-head">
          <span class="status-dot ${offline ? "offline" : ""}"></span>

          ${getFlagHtml(server.region)}

          <span
            class="server-name"
            title="${escapeHtml(serverName)}"
          >
            ${escapeHtml(serverName)}
          </span>
        </div>

        ${progress("CPU", server.cpu, "cpu", offline)}

        ${progress(
          "内存",
          memoryPercent,
          "memory",
          offline
        )}

        ${progress(
          "交换",
          swapPercent,
          "swap",
          offline
        )}

        ${progress(
          "硬盘",
          diskPercent,
          "disk",
          offline
        )}

        <div class="text-row">
          <span class="text-label">网速</span>

          <span class="text-value">
            <span class="icon-down">⬇</span>
            ${escapeHtml(formatSpeed(server.net_in_speed))}

            <span class="icon-up">⬆</span>
            ${escapeHtml(formatSpeed(server.net_out_speed))}
          </span>
        </div>

        <div class="text-row">
          <span class="text-label">流量</span>

          <span class="text-value">
            <span class="icon-down">⬇</span>
            ${escapeHtml(formatBytes(server.net_rx))}

            <span class="icon-up">⬆</span>
            ${escapeHtml(formatBytes(server.net_tx))}
          </span>
        </div>

        <div class="text-row">
          <span class="text-label">信息</span>

          <span class="text-value">
            <span class="icon-cpu">⚙</span>
            ${escapeHtml(String(toNumber(server.cpu_cores)))} Cores

            <span class="sep">|</span>

            <span class="icon-ram">▤</span>
            ${escapeHtml(formatCapacity(server.ram_total))}

            <span class="sep">|</span>

            <span class="icon-disk">▱</span>
            ${escapeHtml(formatCapacity(server.disk_total))}
          </span>
        </div>

        <div class="text-row">
          <span class="text-label">负载</span>

          <span class="text-value">
            <span class="icon-load">〽</span>
            ${escapeHtml(formatLoad(server.load_avg))}
          </span>
        </div>
      </article>
    `;
  };

  const normalizeServers = (data) => {
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.servers)) {
      return data.servers;
    }

    if (data && Array.isArray(data.data)) {
      return data.data;
    }

    return [];
  };

  const render = (servers = state.servers) => {
    const app = $("#app");

    if (!app) {
      return;
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      app.innerHTML = `
        <div class="loading">
          暂无服务器数据
        </div>
      `;

      return;
    }

    const groups = new Map();

    servers.forEach((server) => {
      const groupName =
        server.server_group ||
        server.group ||
        server.group_name ||
        "其他";

      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }

      groups.get(groupName).push(server);
    });

    const groupHtml = [...groups.entries()]
      .map(([groupName, groupServers]) => {
        return `
          <section class="group">
            <h2 class="group-title">
              ${escapeHtml(groupName)}
              <small>(${groupServers.length})</small>
            </h2>

            <div class="server-grid">
              ${groupServers.map(serverCard).join("")}
            </div>
          </section>
        `;
      })
      .join("");

    app.innerHTML = `
      <main class="dashboard">
        ${groupHtml}
      </main>
    `;

    document.querySelectorAll(".group-title").forEach((title) => {
      title.addEventListener("click", () => {
        const group = title.closest(".group");

        if (group) {
          group.classList.toggle("collapsed");
        }
      });
    });
  };

  const demoData = () => {
    const now = Date.now();

    const makeServer = (
      id,
      name,
      region,
      cpu,
      ram,
      disk,
      days
    ) => {
      return {
        id,
        name,
        region,
        server_group: "其他",

        online: true,

        cpu,

        ram_total: 1024,
        ram_used: 1024 * ram / 100,

        swap_total: 1024,
        swap_used: 0,

        disk_total: 40960,
        disk_used: 40960 * disk / 100,

        net_in_speed: 3580,
        net_out_speed: 3670,

        net_rx: 440.51 * 1024 ** 2,
        net_tx: 432.88 * 1024 ** 2,

        cpu_cores: 2,
        load_avg: "0.03 0.01 0.00",

        boot_time: now - days * 86400000,
        last_updated: now,
      };
    };

    return [
      makeServer("1", "香港-0", "HK", 0, 14, 17, 0.27),
      makeServer("2", "香港-1", "HK", 0, 0, 0, 0.1),
      makeServer("3", "香港-2", "HK", 0, 0, 0, 0.1),
      makeServer("4", "香港-3", "HK", 1, 14, 16, 10),
      makeServer("5", "美国", "US", 7, 67, 16, 312),
      makeServer("6", "香港-A", "HK", 2, 29, 47, 55),
      makeServer("7", "香港-B", "HK", 0, 26, 40, 55),
    ];
  };

  const loadServers = async () => {
    if (state.demo) {
      state.servers = demoData();
      render();
      return;
    }

    const app = $("#app");

    if (app) {
      app.innerHTML = `
        <div class="loading">
          正在加载服务器数据……
        </div>
      `;
    }

    try {
      const response = await fetch("/api/servers", {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      state.servers = normalizeServers(data);
      render();
    } catch (error) {
      console.error("服务器数据加载失败：", error);

      if (app) {
        app.innerHTML = `
          <div class="error">
            服务器数据加载失败：
            ${escapeHtml(error.message)}
          </div>
        `;
      }
    }
  };

  const connectWebSocket = () => {
    if (state.demo || !window.WebSocket) {
      return;
    }

    const protocol =
      location.protocol === "https:" ? "wss:" : "ws:";

    const wsUrl = `${protocol}//${location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      state.ws = ws;

      ws.onopen = () => {
        console.log("WebSocket 已连接");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const servers = normalizeServers(data);

          if (Array.isArray(servers) && servers.length > 0) {
            state.servers = servers;
            render();
          }
        } catch (error) {
          console.warn("WebSocket 数据解析失败：", error);
        }
      };

      ws.onerror = (error) => {
        console.warn("WebSocket 连接错误：", error);

        try {
          ws.close();
        } catch (_) {
          // 忽略关闭错误
        }
      };

      ws.onclose = () => {
        console.warn("WebSocket 已断开，5 秒后重连");

        clearTimeout(state.reconnectTimer);

        state.reconnectTimer = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      };
    } catch (error) {
      console.warn("WebSocket 初始化失败：", error);

      clearTimeout(state.reconnectTimer);

      state.reconnectTimer = setTimeout(() => {
        connectWebSocket();
      }, 5000);
    }
  };

  const init = async () => {
    await loadServers();
    connectWebSocket();
  };

  init();
})();
