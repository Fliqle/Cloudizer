// Service worker: приём запросов на сохранение, скачивание картинки, загрузка в Облако.
import { getSettings, setSettings, DEFAULTS, filenameFromUrl, sanitizeName } from "./util.js";
import { authHeader, ensureFolder, resolveName, uploadFile, testConnection } from "./webdav.js";

// Папки, созданные за текущую жизнь воркера (чтобы не дёргать MKCOL каждый раз).
const ensuredFolders = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  // Заполнить значения по умолчанию, не затирая уже сохранённые.
  const cur = await chrome.storage.local.get(DEFAULTS);
  await setSettings({ ...DEFAULTS, ...cur });
  rebuildMenus();
});

// Пересобрать меню при запуске браузера (service worker мог быть выгружен).
chrome.runtime.onStartup.addListener(rebuildMenus);

// Пересобрать пункты меню при изменении списка категорий в настройках.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.categories) rebuildMenus();
});

// ── Контекстное меню (правый клик по картинке) ──────────────────
const MENU_PARENT = "cloudize-parent";
const MENU_PREFIX = "cloudize-cat::";

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const { categories } = await getSettings();
  chrome.contextMenus.create({
    id: MENU_PARENT,
    title: "Сохранить в Облако",
    contexts: ["image"],
  });
  categories.forEach((c, i) => {
    chrome.contextMenus.create({
      id: MENU_PREFIX + i,
      parentId: MENU_PARENT,
      title: c,
      contexts: ["image"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (typeof info.menuItemId !== "string" || !info.menuItemId.startsWith(MENU_PREFIX)) return;
  const idx = Number(info.menuItemId.slice(MENU_PREFIX.length));
  const { categories } = await getSettings();
  const category = categories[idx];
  const url = info.srcUrl;
  if (url) handleSave(url, category);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SAVE_IMAGE") {
    handleSave(msg.url, msg.category).then(sendResponse);
    return true; // ответ придёт асинхронно
  }
  if (msg?.type === "TEST_CONNECTION") {
    testConnection(msg.email, msg.appPassword).then(sendResponse);
    return true;
  }
  if (msg?.type === "GET_STATUS") {
    getSettings().then((s) =>
      sendResponse({ configured: !!(s.email && s.appPassword), enabled: s.enabled, folder: s.folder })
    );
    return true;
  }
  return false;
});

async function handleSave(url, category) {
  const s = await getSettings();

  if (!s.email || !s.appPassword) {
    notify("Нужна настройка", "Укажите e-mail и пароль приложения в настройках плагина.");
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "no-credentials" };
  }

  // Итоговая папка = основная + (опционально) подпапка-категория.
  const sub = category ? sanitizeName(category).replace(/\//g, " ") : "";
  const targetFolder = sub ? `${s.folder}/${sub}` : s.folder;

  try {
    // 1. Скачать картинку (в SW CORS снят благодаря host_permissions).
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Не удалось скачать (${res.status})`);
    const blob = await res.blob();
    const contentType = res.headers.get("content-type") || blob.type;

    if (!blob.size) throw new Error("Пустой файл");

    // 2. Имя файла.
    const filename = filenameFromUrl(url, contentType);

    // 3. Авторизация и папка (создаётся вместе с подпапкой).
    const auth = authHeader(s.email, s.appPassword);
    if (!ensuredFolders.has(targetFolder)) {
      await ensureFolder(targetFolder, auth);
      ensuredFolders.add(targetFolder);
    }

    // 4. Уникальное имя и загрузка.
    const finalName = await resolveName(targetFolder, filename, auth);
    await uploadFile(targetFolder, finalName, blob, contentType, auth);

    notify("Сохранено в Облако", `${finalName} → ${targetFolder}`);
    return { ok: true, name: finalName, folder: targetFolder };
  } catch (e) {
    const error = mapError(e);
    notify("Не удалось сохранить", error);
    return { ok: false, error };
  }
}

function mapError(e) {
  const m = String(e?.message || e);
  if (m === "AUTH") return "Неверный e-mail или пароль приложения.";
  if (m === "FORBIDDEN")
    return "Нет доступа по WebDAV. Возможно, нужен платный тариф Облака.";
  if (m.startsWith("Failed to fetch") || m.includes("NetworkError"))
    return "Сетевая ошибка при загрузке.";
  return m;
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}
