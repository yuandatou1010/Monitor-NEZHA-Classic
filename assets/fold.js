(() => {
  const style = document.createElement("style");
  style.id = "cf-fold-style";

  style.textContent = `
    /* 将原来 <style> 里面的全部 CSS 放在这里 */
      .card.cf-fold-hidden {
    display: none !important;
  }

  /*
    折叠入口成为时间行的第三列，
    不再放进模板会实时重写的 .text-value。
  */
  .card .text-row.cf-fold-time-row {
    grid-template-columns: 46px minmax(0, 1fr) auto;
    padding-right: var(--cf-fold-extra-right, 7px);
  }

  .cf-fold-trigger {
    display: inline-block;
    margin: 0;
    padding: 0 0 0 5px;
    border: 0;
    background: transparent;
    color: #168fe0;
    font: inherit;
    font-size: 12px;
    line-height: 20px;
    white-space: nowrap;
    cursor: pointer;
  }

  .cf-fold-trigger:hover {
    color: #0875bd;
    text-decoration: underline;
  }

  .cf-fold-trigger:focus-visible {
    outline: 2px solid #168fe0;
    outline-offset: 3px;
    border-radius: 2px;
  }

  /* 背景：50% 遮罩 + 6px 模糊 */
  #cf-fold-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    overflow: auto;
    overscroll-behavior: contain;
    background: rgba(0, 0, 0, 0.5);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }

  #cf-fold-overlay[hidden] {
    display: none !important;
  }

  /*
    内容少时上下居中；
    内容过多时允许整体滚动。
  */
  .cf-fold-stage {
    display: flex;
    min-height: 100%;
    padding: 28px 20px;
  }

  /* 新增：与原模板风格接近的白色细边框容器 */
  .cf-fold-panel {
    flex: 0 0 auto;
    margin: auto;
    padding: 22px;
    border: 1px solid #dcdcdc;
    border-radius: 5px;
  }
  `;

  document.head.appendChild(style);
})();

// 下面接原来 <script> 里面的全部 JavaScript。
(() => {
  "use strict";

  /* ================= 配置区 ================= */

  const CONFIG = {
    keywords: [
      "阿里",
      // "日本-甲骨文",
    ],

    // 弹层最多多少列，同时不会超过原页面网格列数。
    popupMaxColumns: 5,

    // 折叠入口距离卡片右边约多少 px。
    triggerRightPx: 20,
  };

  /*
    不再设置 refreshSeconds。
    每次进入或刷新页面，只额外请求一次 /api/servers。
  */

  /* =============== 配置区结束 =============== */

  if (window.__CF_CARD_FOLD_INSTALLED__) return;
  window.__CF_CARD_FOLD_INSTALLED__ = true;

  const keywords = [...new Set(
    CONFIG.keywords
      .map(value => String(value).trim())
      .filter(Boolean)
  )];

  const records = new Map();

  // 本次页面访问中选定的代表机器，不随实时更新切换。
  const selectedIds = new Map();

  let groups = new Map();
  let active = null;
  let overlay;
  let panel;
  let popupGrid;
  let dataReady = false;
  let syncing = false;
  let syncQueued = false;
  let previousFocus = null;
  let savedOverflow = "";

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function allCards() {
    const home = Array.from(
      document.querySelectorAll("#app .card[data-id]")
    );

    const popup = popupGrid
      ? Array.from(popupGrid.querySelectorAll(".card[data-id]"))
      : [];

    return home.concat(popup);
  }

  function machineName(card) {
    const record = records.get(String(card.dataset.id));

    if (record && record.name != null) {
      return String(record.name);
    }

    return (card.querySelector(".name")?.textContent || "")
      .replace(/\[已离线\]$/, "")
      .trim();
  }

  function isOnline(record) {
    if (typeof record.is_online === "boolean") {
      return record.is_online;
    }

    const timestamp = number(record.last_updated);
    return timestamp > 0 && Date.now() - timestamp <= 300000;
  }

  function selectRepresentative(keyword, cards) {
    const savedId = selectedIds.get(keyword);

    if (savedId !== undefined) {
      const savedCard = cards.find(
        card => String(card.dataset.id) === savedId
      );

      if (savedCard) return savedCard;
    }

    const ranked = cards.map((card, index) => {
      const record = records.get(String(card.dataset.id)) || {};
      const boot = number(record.boot_time);

      return {
        card,
        index,
        online: isOnline(record),
        boot: boot > 0 ? boot : Infinity,
        last: number(record.last_updated),
      };
    });

    ranked.sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1;
      }

      // 在线机器：启动时间最早的优先。
      if (a.online && a.boot !== b.boot) {
        return a.boot < b.boot ? -1 : 1;
      }

      // 全离线或启动时间相同：最后活动最近的优先。
      if (a.last !== b.last) {
        return b.last - a.last;
      }

      return a.index - b.index;
    });

    const chosen = ranked[0]?.card || null;

    if (chosen) {
      selectedIds.set(keyword, String(chosen.dataset.id));
    }

    return chosen;
  }

  function timeRow(card) {
    return Array.from(
      card.querySelectorAll(".text-row")
    ).find(row => {
      const label = row.querySelector(".text-label")
        ?.textContent.trim();

      return label === "在线" || label === "时间";
    });
  }

  function removeTrigger(card) {
    card.querySelectorAll(".cf-fold-trigger").forEach(
      button => button.remove()
    );

    const row = card.querySelector(".cf-fold-time-row");

    if (row) {
      row.classList.remove("cf-fold-time-row");
      row.style.removeProperty("--cf-fold-extra-right");
    }
  }

  function setTrigger(card, keyword, count) {
    const row = timeRow(card);
    if (!row) return;

    row.classList.add("cf-fold-time-row");

    let button = row.querySelector(".cf-fold-trigger");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "cf-fold-trigger";

      // 关键修复：追加到整行，而不是 .text-value 内。
      row.appendChild(button);
    }

    const paddingRight = parseFloat(
      getComputedStyle(card).paddingRight
    ) || 0;

    row.style.setProperty(
      "--cf-fold-extra-right",
      `${Math.max(
        0,
        CONFIG.triggerRightPx - paddingRight - 1
      )}px`
    );

    button.dataset.cfFoldKey = keyword;

    const text = `${count}台已折叠»>`;

    // 内容没变化就不重写。
    if (button.textContent !== text) {
      button.textContent = text;
    }

    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute(
      "aria-label",
      `展开${keyword}全部机器，另有${count}台已折叠`
    );
  }

  function buildGroups(cards) {
    const result = new Map();

    for (const card of cards) {
      const name = machineName(card);
      const keyword = keywords.find(
        item => name.includes(item)
      );

      if (!keyword) continue;

      if (!result.has(keyword)) {
        result.set(keyword, []);
      }

      result.get(keyword).push(card);
    }

    return result;
  }

  function layoutPopup() {
    if (!active) return;

    const sample = active.items[0]?.card;
    if (!sample) return;

    const style = getComputedStyle(sample);
    const width = parseFloat(style.width) || 278;
    const height = parseFloat(style.height) || 333;

    const homeGrid = active.items[0].anchor.parentElement;
    const homeStyle = homeGrid
      ? getComputedStyle(homeGrid)
      : null;

    const columnGap = parseFloat(homeStyle?.columnGap) || 27;
    const rowGap = parseFloat(homeStyle?.rowGap) || 23;

    const tracks = homeStyle?.gridTemplateColumns
      ?.match(/[\d.]+px/g);

    const originalColumns = tracks?.length
      || CONFIG.popupMaxColumns;

    const stageStyle = getComputedStyle(
      overlay.querySelector(".cf-fold-stage")
    );

    const panelStyle = getComputedStyle(panel);

    const horizontalSpace = [
      stageStyle.paddingLeft,
      stageStyle.paddingRight,
      panelStyle.paddingLeft,
      panelStyle.paddingRight,
      panelStyle.borderLeftWidth,
      panelStyle.borderRightWidth,
    ].reduce((sum, value) => {
      return sum + (parseFloat(value) || 0);
    }, 0);

    const availableWidth = Math.max(
      0,
      overlay.clientWidth - horizontalSpace
    );

    const fits = Math.max(
      1,
      Math.floor(
        (availableWidth + columnGap) / (width + columnGap)
      )
    );

    const columns = Math.max(1, Math.min(
      active.items.length,
      CONFIG.popupMaxColumns,
      originalColumns,
      fits
    ));

    popupGrid.style.setProperty(
      "--cf-fold-columns", columns
    );

    popupGrid.style.setProperty(
      "--cf-fold-card-width", `${width}px`
    );

    popupGrid.style.setProperty(
      "--cf-fold-card-height", `${height}px`
    );

    popupGrid.style.setProperty(
      "--cf-fold-column-gap", `${columnGap}px`
    );

    popupGrid.style.setProperty(
      "--cf-fold-row-gap", `${rowGap}px`
    );
  }

  function closePopup(restoreFocus = true) {
    if (!active) return;

    const closing = active;
    active = null;

    for (const { card, anchor } of closing.items) {
      if (anchor.isConnected) {
        anchor.replaceWith(card);
      } else {
        card.remove();
      }
    }

    popupGrid.replaceChildren();
    overlay.hidden = true;
    document.body.style.overflow = savedOverflow;

    document.querySelector(".modal-mask.show")
      ?.classList.remove("show");

    sync();

    if (restoreFocus && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function openPopup(keyword, sourceButton) {
    if (active) closePopup(false);

    sync();

    const cards = groups.get(keyword);
    if (!cards || cards.length < 2) return;

    /*
      关闭后原按钮会重新创建，
      因此记录代表卡片，而不是即将移除的按钮。
    */
    previousFocus = sourceButton.closest(".card");
    savedOverflow = document.body.style.overflow;

    const items = cards.map(card => {
      const anchor = document.createComment("cf-fold-home");
      card.before(anchor);

      removeTrigger(card);
      card.classList.remove("cf-fold-hidden");

      return { card, anchor };
    });

    active = { keyword, items };

    panel.setAttribute(
      "aria-label",
      `${keyword}全部机器`
    );

    popupGrid.replaceChildren(
      ...items.map(item => item.card)
    );

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    layoutPopup();
    panel.focus({ preventScroll: true });
  }

  function sync() {
    if (syncing || !dataReady) return;
    syncing = true;

    try {
      if (
        active &&
        active.items.some(item => !item.anchor.isConnected)
      ) {
        closePopup(false);
      }

      const cards = allCards();
      groups = buildGroups(cards);

      const groupedCards = new Set();

      for (const [keyword, members] of groups) {
        members.forEach(card => groupedCards.add(card));

        if (members.length < 2) {
          for (const card of members) {
            card.classList.remove("cf-fold-hidden");
            removeTrigger(card);
          }
          continue;
        }

        if (active?.keyword === keyword) {
          for (const card of members) {
            card.classList.remove("cf-fold-hidden");
            removeTrigger(card);
          }
          continue;
        }

        const representative = selectRepresentative(
          keyword,
          members
        );

        for (const card of members) {
          const hidden = card !== representative;
          card.classList.toggle("cf-fold-hidden", hidden);

          if (hidden) {
            removeTrigger(card);
          } else {
            setTrigger(card, keyword, members.length - 1);
          }
        }
      }

      for (const card of cards) {
        if (!groupedCards.has(card)) {
          card.classList.remove("cf-fold-hidden");
          removeTrigger(card);
        }
      }
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;

    requestAnimationFrame(() => {
      syncQueued = false;
      sync();
    });
  }

  async function loadSelectionOnce() {
    try {
      // 本脚本唯一一次接口请求；失败后不自动重试。
      const response = await fetch("/api/servers", {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data.servers)) {
        throw new Error("接口中没有 servers 数组");
      }

      for (const server of data.servers) {
        records.set(String(server.id), server);
      }

      dataReady = true;
      sync();
    } catch (error) {
      // 缺少选择数据时保留原页面，不随意隐藏机器。
      console.warn(
        "[CF 卡片折叠] 初始数据读取失败，本次不启用折叠：",
        error
      );
    }
  }

  function init() {
    if (!keywords.length) return;

    overlay = document.createElement("div");
    overlay.id = "cf-fold-overlay";
    overlay.hidden = true;

    overlay.innerHTML = `
      <div class="cf-fold-stage">
        <div
          class="cf-fold-panel"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
        >
          <div class="cf-fold-grid"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    panel = overlay.querySelector(".cf-fold-panel");
    popupGrid = overlay.querySelector(".cf-fold-grid");

    document.addEventListener("click", event => {
      if (!(event.target instanceof Element)) return;

      const button = event.target.closest(
        ".cf-fold-trigger"
      );

      if (!button) return;

      event.preventDefault();

      openPopup(
        button.dataset.cfFoldKey,
        button
      );
    });

    overlay.addEventListener("click", event => {
      if (!(event.target instanceof Element)) return;

      // 卡片外，包括边框留白和卡片间隙，点击关闭。
      if (!event.target.closest(".card")) {
        const focusCard = previousFocus;
        closePopup(false);

        focusCard?.querySelector(".cf-fold-trigger")
          ?.focus({ preventScroll: true });
      }
    });

    document.addEventListener("keydown", event => {
      if (!active) return;

      if (event.key === "Escape") {
        const info = document.querySelector(
          ".modal-mask.show"
        );

        if (info) {
          info.classList.remove("show");
        } else {
          const focusCard = previousFocus;
          closePopup(false);

          focusCard?.querySelector(".cf-fold-trigger")
            ?.focus({ preventScroll: true });
        }

        event.preventDefault();
        return;
      }

      if (
        event.key === "Tab" &&
        !document.querySelector(".modal-mask.show")
      ) {
        const controls = Array.from(
          panel.querySelectorAll(
            'button, a[href], input, select, textarea, [tabindex="0"]'
          )
        ).filter(node => node.getClientRects().length);

        if (!controls.length) {
          event.preventDefault();
          panel.focus();
          return;
        }

        const current = controls.indexOf(
          document.activeElement
        );

        let next = current + (event.shiftKey ? -1 : 1);

        if (current < 0) {
          next = event.shiftKey
            ? controls.length - 1
            : 0;
        }

        next = (next + controls.length) % controls.length;

        event.preventDefault();
        controls[next].focus();
      }
    });

    window.addEventListener("resize", layoutPopup);

    /*
      只监听整张卡片的增加、移除或页面重新渲染。
      CPU、时间、网速等内部文本更新不会触发折叠处理。
      此监听不会发起网络请求。
    */
    const observer = new MutationObserver(mutations => {
      const cardChanged = mutations.some(mutation => {
        const changedNodes = [
          ...mutation.addedNodes,
          ...mutation.removedNodes,
        ];

        return changedNodes.some(node => {
          return node instanceof Element && (
            node.matches(".card[data-id]") ||
            node.querySelector(".card[data-id]")
          );
        });
      });

      if (cardChanged) scheduleSync();
    });

    observer.observe(
      document.querySelector("#app") || document.body,
      {
        childList: true,
        subtree: true,
      }
    );

    loadSelectionOnce();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
