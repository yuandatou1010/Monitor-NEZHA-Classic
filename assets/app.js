(() => {
  "use strict";

  /*
   * =====================================================
   * 默认布局配置
   *
   * 后台 /api/config 返回 layout 后，
   * 会自动覆盖这里的默认值。
   * =====================================================
   */
  const DEFAULT_LAYOUT = {
    columns: 6,
    cardWidth: 278,
    cardHeight: 333,
    gapX: 54,
    gapY: 46,
    groupPaddingX: 20,
    groupPaddingY: 20
  };

  const state = {
    config: {},
    servers: [],
    serverMap: new Map(),
    ws: null,
    reconnectTimer: null,

    demo: new URLSearchParams(location.search).get("demo") === "1"
  };

  /*
   * =====================================================
   * 通用函数
   * =====================================================
   */

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function regionFlag(region) {
    const code = String(region || "").trim().toLowerCase();

    if (!/^[a-z]{2}$/.test(code)) {
      return "";
    }

    return `
      <img
        class="server-flag"
        src="/flags/${esc(code)}.svg"
        alt=""
        onerror="this.replaceWith(document.createTextNode(flagFallback('${esc(code)}')))"
      />
    `;
  }

  function flagFallback(code) {
    return code.length === 2
      ? String.fromCodePoint(
          ...[...code].map(char => 127397 + char.charCodeAt(0))
        )
      : "";
  }

  function bytes(value) {
    let n = Math.max(0, num(value));

    const units = ["B", "K", "M", "G", "T", "P"];
    let index = 0;

    while (n >= 1024 && index < units.length - 1) {
      n /= 1024;
      index++;
    }

    if (index === 0) {
      return `${Math.round(n)}B`;
    }

    if (n >= 100) {
      return `${n.toFixed(0)}${units[index]}`;
    }

    return `${n.toFixed(2)}${units[index]}`;
  }

  function speed(value) {
    return `${bytes(value)}/s`;
  }

  function capacity(value) {
    const n = Math.max(0, num(value));

    if (n >= 1024 * 1024) {
      return `${(n / 1024 / 1024).toFixed(1)}TB`;
    }

    if (n >= 1024) {
      return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)}GB`;
    }

    return `${Math.round(n)}MB`;
  }

  function percent(used, total) {
    const totalValue = num(total);

    if (totalValue <= 0) {
      return 0;
    }

    return clamp((num(used) / totalValue) * 100, 0, 100);
  }

  function fmtPct(value) {
    const n = num(value);

    return `${n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "")}%`;
  }

  function fmtLoad(value) {
    if (Array.isArray(value)) {
      return value
        .slice(0, 3)
        .map(item => num(item).toFixed(2))
        .join(" | ");
    }

    const source = String(value ?? "0 0 0")
      .trim()
      .replace(/\s+/g, " ");

    if (!source) {
      return "0.00 | 0.00 | 0.00";
    }

    return source
      .split(/[ ,|]+/)
      .slice(0, 3)
      .map(item => {
        const n = Number(item);
        return Number.isFinite(n) ? n.toFixed(2) : item;
      })
      .join(" | ");
  }

  function uptime(boot) {
    const bootTime = num(boot);

    if (!bootTime) {
      return "0:00:00";
    }

    const seconds = Math.max(
      0,
      Math.floor((Date.now() - bootTime) / 1000)
    );

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0) {
      return `${days} 天`;
    }

    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function online(server) {
    if (typeof server.is_online === "boolean") {
      return server.is_online;
    }

    const lastUpdated = num(server.last_updated);

    return (
      lastUpdated > 0 &&
      Date.now() - lastUpdated <= 300000
    );
  }

  function regionCode(server) {
    return String(
      server.region ||
      server.country ||
      server.server_group ||
      "UN"
    )
      .toUpperCase()
      .slice(0, 2);
  }

  function flag(server) {
    return regionFlag(server.region || regionCode(server));
  }

  function osIcon(server) {
    const os = String(server.os || "").toLowerCase();

    if (os.includes("windows")) {
      return "▣";
    }

    if (
      os.includes("ubuntu") ||
      os.includes("debian") ||
      os.includes("linux") ||
      os.includes("alpine") ||
      os.includes("centos") ||
      os.includes("openwrt")
    ) {
      return "◉";
    }

    if (os.includes("mac") || os.includes("darwin")) {
      return "◌";
    }

    return "◉";
  }

  function groupName(server) {
    const group = String(server.server_group || "").trim();

    return group || "other";
  }

  /*
   * =====================================================
   * 布局配置
   *
   * 支持后台返回：
   *
   * {
   *   "layout": {
   *     "columns": 6,
   *     "cardWidth": 278,
   *     "cardHeight": 333,
   *     "gapX": 54,
   *     "gapY": 46,
   *     "groupPaddingX": 20,
   *     "groupPaddingY": 20
   *   }
   * }
   * =====================================================
   */

  function applyLayoutConfig(config = {}) {
    const layout = {
      ...DEFAULT_LAYOUT,
      ...(config.layout || {})
    };

    const columns = clamp(
      parseInt(layout.columns, 10) || DEFAULT_LAYOUT.columns,
      1,
      12
    );

    const cardWidth = Math.max(
      180,
      parseInt(layout.cardWidth, 10) || DEFAULT_LAYOUT.cardWidth
    );

    const cardHeight = Math.max(
      180,
      parseInt(layout.cardHeight, 10) || DEFAULT_LAYOUT.cardHeight
    );

    const gapX = Math.max(
      0,
      parseInt(layout.gapX, 10) || DEFAULT_LAYOUT.gapX
    );

    const gapY = Math.max(
      0,
      parseInt(layout.gapY, 10) || DEFAULT_LAYOUT.gapY
    );

    const groupPaddingX = Math.max(
      0,
      parseInt(layout.groupPaddingX, 10) ||
        DEFAULT_LAYOUT.groupPaddingX
    );

    const groupPaddingY = Math.max(
      0,
      parseInt(layout.groupPaddingY, 10) ||
        DEFAULT_LAYOUT.groupPaddingY
    );

    const root = document.documentElement;

    root.style.setProperty("--layout-columns", String(columns));
    root.style.setProperty("--card-width", `${cardWidth}px`);
    root.style.setProperty("--card-height", `${cardHeight}px`);
    root.style.setProperty("--card-gap-x", `${gapX}px`);
    root.style.setProperty("--card-gap-y", `${gapY}px`);
    root.style.setProperty("--group-padding-x", `${groupPaddingX}px`);
    root.style.setProperty("--group-padding-y", `${groupPaddingY}px`);
  }

  /*
   * =====================================================
   * 卡片内容
   * =====================================================
   */

  function progress(label, value, offline) {
    const percentage = clamp(num(value), 0, 100);

    return `
      <div class="metric">
        <span class="metric-label">${esc(label)}</span>

        <div class="bar">
          <div
            class="bar-fill ${offline ? "offline" : ""}"
            style="width:${percentage}%"
          ></div>

          <span class="bar-value">
            ${fmtPct(percentage)}
          </span>
        </div>
      </div>
    `;
  }

  function card(server) {
    const isOffline = !online(server);

    const ramPct = percent(
      server.ram_used,
      server.ram_total
    );

    const swapPct = percent(
      server.swap_used,
      server.swap_total
    );

    const diskPct = percent(
      server.disk_used,
      server.disk_total
    );

    return `
      <article
        class="card"
        data-id="${esc(server.id)}"
      >
        <header class="card-head">
          <span class="flag">
            ${flag(server)}
          </span>

          <span class="os">
            ${esc(osIcon(server))}
          </span>

          <span
            class="name"
            title="${esc(server.name || "Unnamed")}"
          >
            ${esc(server.name || "Unnamed")}
            ${isOffline ? "[已离线]" : ""}
          </span>

          <button
            class="info"
            type="button"
            data-info="${esc(server.id)}"
            aria-label="服务器信息"
          >
            i
          </button>
        </header>

        <div class="metrics">
          ${progress("CPU", server.cpu, isOffline)}

          ${progress("内存", ramPct, isOffline)}

          ${progress("交换", swapPct, isOffline)}

          ${progress("硬盘", diskPct, isOffline)}

          <div class="text-row">
            <span class="text-label">网速</span>

            <span class="text-value">
              <span class="icon-down">⬇</span>
              ${esc(speed(server.net_in_speed))}

              <span class="icon-up">⬆</span>
              ${esc(speed(server.net_out_speed))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">流量</span>

            <span class="text-value">
              <span class="icon-down">⬇</span>
              ${esc(bytes(server.net_rx))}

              <span class="icon-up">⬆</span>
              ${esc(bytes(server.net_tx))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">信息</span>

            <span class="text-value">
              <span class="icon-cpu">⚙</span>
              ${esc(num(server.cpu_cores))} Cores

              <span class="icon-ram">▤</span>
              ${esc(capacity(server.ram_total))}

              <span class="icon-disk">▱</span>
              ${esc(capacity(server.disk_total))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">负载</span>

            <span class="text-value">
              <span class="icon-load">〽</span>
              ${esc(fmtLoad(server.load_avg))}
            </span>
          </div>

          <div class="text-row">
            <span class="text-label">在线</span>

            <span class="text-value">
              <span class="status-dot ${isOffline ? "offline" : ""}"></span>
              ${esc(uptime(server.boot_time))}
            </span>
          </div>
        </div>
      </article>
    `;
  }

  function groupedServers() {
    const groups = new Map();

    for (const server of state.servers) {
      const group = groupName(server);

      if (!groups.has(group)) {
        groups.set(group, []);
      }

      groups.get(group).push(server);
    }

    return groups;
  }

  /*
   * =====================================================
   * 页面渲染
   * =====================================================
   */

  function render() {
    const app = document.querySelector("#app");

    if (!app) {
      return;
    }

    if (!state.servers.length) {
      app.innerHTML = `
        <div class="error">
          暂无可显示的服务器
        </div>
      `;

      return;
    }

    const groups = groupedServers();

    app.innerHTML = Array.from(groups.entries())
      .map(([name, servers]) => {
        return `
          <section
            class="group"
            data-group="${esc(name)}"
          >
            <h2
              class="group-title"
              data-collapse="${esc(name)}"
            >
              <span class="group-arrow">▼</span>
              <span>${esc(name)}</span>
            </h2>

            <div class="server-grid">
              ${servers.map(card).join("")}
            </div>
          </section>
        `;
      })
      .join("");

    bindEvents();
  }

  function bindEvents() {
    document
      .querySelectorAll("[data-collapse]")
      .forEach(element => {
        element.addEventListener("click", () => {
          const group = element.closest(".group");

          if (group) {
            group.classList.toggle("collapsed");
          }
        });
      });

    document
      .querySelectorAll("[data-info]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const server = state.serverMap.get(button.dataset.info);

          if (server) {
            showInfo(server, button);
          }
        });
      });
  }

  /*
   * =====================================================
   * 信息弹窗
   * =====================================================
   */

  function formatStartTime(timestamp) {
    const value = num(timestamp);

    if (!value) {
      return "—";
    }

    const date = new Date(value);

    const pad = number => String(number).padStart(2, "0");

    return [
      `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    ].join(" ");
  }

  function showInfo(server, sourceButton) {
    let modalMask = document.querySelector(".modal-mask");

    if (!modalMask) {
      modalMask = document.createElement("div");

      modalMask.className = "modal-mask";

      modalMask.innerHTML = `
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
        >
          <div class="modal-title"></div>
          <div class="modal-grid"></div>

          <button
            class="modal-close"
            type="button"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      `;

      document.body.appendChild(modalMask);

      modalMask.addEventListener("click", event => {
        if (
          event.target === modalMask ||
          event.target.classList.contains("modal-close")
        ) {
          modalMask.classList.remove("show");
        }
      });
    }

    const title = modalMask.querySelector(".modal-title");
    const grid = modalMask.querySelector(".modal-grid");

    title.textContent = `${server.name || "Server"} 信息`;

    const swapTotal = num(server.swap_total);

    const swapText =
      swapTotal > 0
        ? `${capacity(server.swap_used)}/${capacity(swapTotal)}`
        : "OFF";

    const rows = [
      ["系统", `${server.os || "—"} [${server.arch || "—"}]`],
      [
        "CPU",
        server.cpu_info
          ? server.cpu_info
          : `${num(server.cpu_cores)} Core`
      ],
      [
        "硬盘",
        `${capacity(server.disk_used)}/${capacity(server.disk_total)}`
      ],
      [
        "内存",
        `${capacity(server.ram_used)}/${capacity(server.ram_total)}`
      ],
      ["交换", swapText],
      [
        "流量",
        `⬇ ${bytes(server.net_rx)} ⬆ ${bytes(server.net_tx)}`
      ],
      ["负载", fmtLoad(server.load_avg)],
      ["进程数", num(server.processes)],
      [
        "连接数",
        `TCP ${num(server.tcp_conn)} / UDP ${num(server.udp_conn)}`
      ],
      ["启动", formatStartTime(server.boot_time)]
    ];

    grid.innerHTML = rows
      .map(([label, value]) => {
        return `<span>${esc(label)}: ${esc(value)}</span>`;
      })
      .join("");

    const source =
      sourceButton ||
      document.querySelector(
        `[data-info="${CSS.escape(String(server.id))}"]`
      );

    if (source) {
      const rect = source.getBoundingClientRect();

      const modalWidth = 330;
      const horizontalPadding = 10;

      let left = rect.right - modalWidth;
      let top = rect.bottom + 7;

      left = Math.max(
        horizontalPadding,
        Math.min(
          left,
          window.innerWidth - modalWidth - horizontalPadding
        )
      );

      if (top + 330 > window.innerHeight) {
        top = Math.max(10, rect.top - 340);
      }

      const modal = modalMask.querySelector(".modal");

      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
    }

    modalMask.classList.add("show");
  }

  /*
   * =====================================================
   * WebSocket 数据合并
   * =====================================================
   */

  function mergeServer(id, data) {
    const current = state.serverMap.get(id);

    if (!current) {
      return;
    }

    state.serverMap.set(
      id,
      Object.assign({}, current, data, { id })
    );
  }

  /*
   * =====================================================
   * 加载 API 数据
   * =====================================================
   */

  async function load() {
    if (state.demo) {
      state.config = {
        site_title: "NEZHA Classic",
        is_public: true,

        layout: {
          columns: 6,
          cardWidth: 278,
          cardHeight: 333,
          gapX: 54,
          gapY: 46,
          groupPaddingX: 20,
          groupPaddingY: 20
        }
      };

      applyLayoutConfig(state.config);

      state.servers = demoData();

      state.serverMap = new Map(
        state.servers.map(server => [String(server.id), server])
      );

      render();

      return;
    }

    try {
      const configResponse = await fetch("/api/config", {
        credentials: "same-origin"
      });

      if (configResponse.ok) {
        state.config = await configResponse.json();
      }

      /*
       * 即使后台没有 layout，
       * 也会使用 DEFAULT_LAYOUT。
       */
      applyLayoutConfig(state.config);

      const serverResponse = await fetch("/api/servers", {
        credentials: "same-origin"
      });

      if (!serverResponse.ok) {
        throw new Error(
          `API /api/servers ${serverResponse.status}`
        );
      }

      const data = await serverResponse.json();

      state.servers = Array.isArray(data.servers)
        ? data.servers
        : [];

      state.serverMap = new Map(
        state.servers.map(server => [
          String(server.id),
          server
        ])
      );

      render();
      connectWS();
    } catch (error) {
      console.error(error);

      const app = document.querySelector("#app");

      if (app) {
        app.innerHTML = `
          <div class="error">
            无法读取服务器数据：
            ${esc(error.message)}

            <br>

            <small>
              如果启用了 Turnstile，请使用项目内置的验证流程；
              如果站点为私有站点，请先登录。
            </small>
          </div>
        `;
      }
    }
  }

  /*
   * =====================================================
   * WebSocket
   * =====================================================
   */

  function connectWS() {
    if (state.ws) {
      try {
        state.ws.close();
      } catch (_) {}
    }

    const protocol =
      location.protocol === "https:" ? "wss:" : "ws:";

    const url = new URL(
      `${protocol}//${location.host}/api/ws`
    );

    url.searchParams.set("subscribe", "all");

    const token = localStorage.getItem("jwt_token");

    if (
      token &&
      state.config.is_public !== true &&
      state.config.is_public !== "true"
    ) {
      url.searchParams.set("token", token);
    }

    const websocket = new WebSocket(url.toString());

    state.ws = websocket;

    websocket.onopen = () => {
      const ids = state.servers
        .map(server => server.id)
        .filter(Boolean);

      try {
        websocket.send(
          JSON.stringify({
            type: "subscribe",
            scope: "all",
            ids
          })
        );
      } catch (_) {}
    };

    websocket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);

        if (message.type !== "batchUpdate") {
          return;
        }

        for (const update of message.updates || []) {
          for (const sample of update.samples || []) {
            if (sample && sample.data) {
              mergeServer(update.serverId, sample.data);
            }
          }
        }

        state.servers = state.servers.map(server => {
          return state.serverMap.get(String(server.id)) || server;
        });

        render();
      } catch (error) {
        console.warn("WS message error", error);
      }
    };

    websocket.onclose = () => {
      clearTimeout(state.reconnectTimer);

      state.reconnectTimer = setTimeout(
        connectWS,
        5000
      );
    };

    websocket.onerror = () => {
      try {
        websocket.close();
      } catch (_) {}
    };
  }

  /*
   * =====================================================
   * Demo 数据
   * =====================================================
   */

  function demoData() {
    const now = Date.now();

    function makeServer(
      id,
      name,
      region,
      cpu,
      ram,
      disk,
      days
    ) {
      return {
        id,
        name,
        region,
        server_group: "other",

        cpu,

        ram_total: 1024,
        ram_used: (1024 * ram) / 100,

        swap_total: 0,
        swap_used: 0,

        disk_total: 40960,
        disk_used: (40960 * disk) / 100,

        net_in_speed: 3580,
        net_out_speed: 3670,

        net_rx: 440.51 * 1024 * 2,
        net_tx: 432.88 * 1024 * 2,

        cpu_cores: 2,
        load_avg: "0.03 0.01 0.00",

        boot_time: now - days * 86400000,
        last_updated: now,

        is_online: true
      };
    }

    return [
      makeServer("1", "香港-0", "HK", 0, 14, 17, 0.27),
      makeServer("2", "香港-1", "HK", 0, 0, 0, 0.1),
      makeServer("3", "香港-2", "HK", 0, 0, 0, 0.1),
      makeServer("4", "香港-3", "HK", 1, 14, 16, 10),
      makeServer("5", "美国", "US", 7, 67, 16, 312),
      makeServer("6", "香港-A", "HK", 2, 29, 47, 55),
      makeServer("7", "香港-B", "HK", 0, 26, 40, 55),
      makeServer("8", "台湾-A", "TW", 3, 21, 29, 404),
      makeServer("9", "台湾-B", "TW", 0, 23, 29, 18),
      makeServer("10", "新加坡", "SG", 3, 78, 58, 118)
    ];
  }

  /*
   * 页面启动
   */

  load();
})();
