// Content-скрипт: при наведении на картинку показывает кнопку «сохранить в Облако».
// Клик по кнопке открывает меню категорий — каждая кладёт картинку в свою подпапку.
// Вся UI изолирована в Shadow DOM, поэтому CSS сайта на неё не влияет.
(() => {
  console.debug("[mailru-saver] content.js v1.5 — иконка следует за картинкой");
  const MIN_SIZE = 100; // не показываем кнопку на картинках меньше этого по ширине или высоте
  const U = (p) => chrome.runtime.getURL(p);

  let enabled = true;
  let categories = ["Интерьер", "Фото", "Арт", "Интерфейс"];

  chrome.storage.local.get({ enabled: true, categories }, (s) => {
    enabled = s.enabled;
    if (Array.isArray(s.categories) && s.categories.length) categories = s.categories;
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) enabled = changes.enabled.newValue;
    if (changes.categories && Array.isArray(changes.categories.newValue))
      categories = changes.categories.newValue;
  });

  // ── Shadow DOM хост (изоляция от стилей страницы) ──────────────
  const host = document.createElement("div");
  host.id = "mailru-saver-host";
  host.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  root.appendChild(styleEl);

  // Иконки (загружаются из файлов icons/*.svg — их можно свободно редактировать).
  const ICONS = { hover: "", success: "", error: "" };

  const btn = document.createElement("button");
  btn.className = "mailru-saver-btn";
  btn.type = "button";
  btn.title = "Сохранить в Облако Mail";
  btn.style.display = "none";

  const menu = document.createElement("div");
  menu.className = "mailru-saver-menu";
  menu.style.display = "none";

  const toastEl = document.createElement("div");
  toastEl.className = "mailru-saver-toast";

  root.append(btn, menu, toastEl);
  (document.documentElement || document.body).appendChild(host);

  // Подгрузка стилей и SVG из файлов расширения.
  Promise.all([
    fetch(U("src/content.css")).then((r) => r.text()),
    fetch(U("icons/hover.svg")).then((r) => r.text()),
    fetch(U("icons/success.svg")).then((r) => r.text()),
    fetch(U("icons/error.svg")).then((r) => r.text()),
  ])
    .then(([css, hover, success, error]) => {
      styleEl.textContent = css;
      ICONS.hover = hover;
      ICONS.success = success;
      ICONS.error = error;
      setState("idle");
    })
    .catch((e) => console.warn("[mailru-saver] не удалось загрузить ресурсы", e));

  // ── состояние ─────────────────────────────────────────────────
  let currentImg = null;
  let targetUrl = null;
  let overImg = false;
  let overBtn = false;
  let busy = false;
  let menuOpen = false;
  let rafId = null; // цикл слежения за положением/размером картинки

  const eligible = (img) => {
    if (!(img instanceof HTMLImageElement)) return false;
    const r = img.getBoundingClientRect();
    const w = r.width || img.naturalWidth || 0;
    const h = r.height || img.naturalHeight || 0;
    return w >= MIN_SIZE && h >= MIN_SIZE;
  };

  const bestSrc = (img) => img.currentSrc || img.src || "";

  function position() {
    if (!currentImg) return;
    // картинку убрали из DOM — прячемся
    if (!currentImg.isConnected) {
      hide();
      return;
    }
    const r = currentImg.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      if (!menuOpen) hide();
      return;
    }
    // картинка схлопнулась (например, пропал :hover-зум) — тоже прячемся
    if (r.width < 4 || r.height < 4) {
      if (!menuOpen) hide();
      return;
    }
    const size = 48, pad = 8;
    const top = Math.max(2, Math.min(r.top + pad, innerHeight - size - 2));
    const left = Math.max(2, Math.min(r.right - size - pad, innerWidth - size - 2));
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    if (menuOpen) positionMenu(top, left, size);
  }

  // Пока иконка показана — каждый кадр подгоняем её под текущий размер/позицию
  // картинки (следим за hover-зумом, анимациями, скроллом внутри контейнеров).
  function startFollow() {
    if (rafId) return;
    const step = () => {
      if (!currentImg) {
        rafId = null;
        return;
      }
      position();
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function stopFollow() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function positionMenu(btnTop, btnLeft, btnSize) {
    const mw = menu.offsetWidth || 170;
    const mh = menu.offsetHeight || 190;
    let left = Math.max(4, Math.min(btnLeft, innerWidth - mw - 4));
    let top = btnTop + btnSize + 6;
    if (top + mh > innerHeight - 4) top = Math.max(4, btnTop - mh - 6);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function show(img) {
    if (menuOpen || busy) return;
    currentImg = img;
    setState("idle");
    btn.style.display = "flex";
    position();
    startFollow();
  }

  function hide() {
    if (busy || menuOpen) return;
    stopFollow();
    btn.style.display = "none";
    currentImg = null;
  }

  function maybeHide() {
    setTimeout(() => {
      if (!overImg && !overBtn && !busy && !menuOpen) hide();
    }, 120);
  }

  function setState(state) {
    btn.dataset.state = state;
    if (state === "loading") btn.innerHTML = `<span class="mailru-saver-spinner"></span>`;
    else if (state === "ok") btn.innerHTML = ICONS.success;
    else if (state === "err") btn.innerHTML = ICONS.error;
    else btn.innerHTML = ICONS.hover;
  }

  // ── меню ──────────────────────────────────────────────────────
  function openMenu() {
    if (!currentImg) return;
    targetUrl = bestSrc(currentImg);
    if (!targetUrl) return;
    menu.innerHTML =
      `<div class="mailru-saver-menu-title">Категория</div>` +
      categories
        .map(
          (c, i) =>
            `<button type="button" class="mailru-saver-item" data-i="${i}">${escapeHtml(c)}</button>`
        )
        .join("");
    menu.style.display = "block";
    menuOpen = true;
    const r = btn.getBoundingClientRect();
    positionMenu(r.top, r.left, r.width);
  }

  function closeMenu() {
    menu.style.display = "none";
    menuOpen = false;
    maybeHide();
  }

  async function save(category) {
    const url = targetUrl;
    closeMenu();
    if (!url) return;
    busy = true;
    setState("loading");
    btn.style.display = "flex";
    try {
      const resp = await chrome.runtime.sendMessage({ type: "SAVE_IMAGE", url, category });
      busy = false;
      if (resp?.ok) {
        setState("ok");
        toast(`Сохранено: ${resp.name} → ${resp.folder}`);
      } else {
        setState("err");
        toast(errorText(resp?.error), true);
      }
    } catch {
      busy = false;
      setState("err");
      toast("Ошибка связи с плагином", true);
    }
    setTimeout(() => {
      setState("idle");
      if (!overImg && !overBtn) hide();
    }, 1600);
  }

  const errorText = (code) =>
    code === "no-credentials" ? "Сначала настройте плагин" : code || "Не удалось сохранить";

  // ── события ───────────────────────────────────────────────────
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!enabled) return;
      const img = e.target;
      if (img instanceof HTMLImageElement && eligible(img)) {
        overImg = true;
        show(img);
      }
    },
    true
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (e.target instanceof HTMLImageElement) {
        overImg = false;
        maybeHide();
      }
    },
    true
  );

  btn.addEventListener("mouseenter", () => (overBtn = true));
  btn.addEventListener("mouseleave", () => {
    overBtn = false;
    maybeHide();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !currentImg) return;
    menuOpen ? closeMenu() : openMenu();
  });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".mailru-saver-item");
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    save(categories[Number(item.dataset.i)]);
  });

  // закрытие меню по клику вне (учитываем Shadow DOM через composedPath) и по Esc
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!menuOpen) return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(menu) || path.includes(btn)) return;
      closeMenu();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuOpen) closeMenu();
  });

  addEventListener("scroll", position, true);
  addEventListener("resize", position);

  // ── тост ──────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, isError) {
    toastEl.textContent = text;
    toastEl.dataset.kind = isError ? "err" : "ok";
    toastEl.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2600);
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
})();
