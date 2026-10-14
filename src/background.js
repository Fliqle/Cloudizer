// Service worker: приём запросов и сохранение картинки в Облако или на компьютер.
import { getSettings, setSettings, DEFAULTS, filenameFromUrl, sanitizeName } from "./util.js";
import { authHeader, ensureFolder, uploadUniqueFile, testConnection } from "./webdav.js";

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
    title: "Сохранить изображение",
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
      sendResponse({
        configured: s.destination === "local" || !!(s.email && s.appPassword),
        destination: s.destination,
        enabled: s.enabled,
        folder: s.folder,
      })
    );
    return true;
  }
  return false;
});

async function handleSave(url, category) {
  const s = await getSettings();
  const destination = s.destination === "local" ? "local" : "cloud";

  if (destination === "cloud" && (!s.email || !s.appPassword)) {
    notify("Нужна настройка", "Укажите e-mail и пароль приложения в настройках плагина.");
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "no-credentials" };
  }

  // Итоговая папка = основная + (опционально) подпапка-категория.
  const baseFolder = safeFolderPath(s.folder) || DEFAULTS.folder;
  const sub = category ? safeFolderSegment(category) : "";
  const targetFolder = sub ? `${baseFolder}/${sub}` : baseFolder;

  try {
    if (destination === "local") return await saveLocally(url, targetFolder);

    // 1. Скачать картинку (в SW CORS снят благодаря host_permissions).
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Не удалось скачать (${res.status})`);
    const blob = await res.blob();
    const contentType = res.headers.get("content-type") || blob.type;

    if (!blob.size) throw new Error("Пустой файл");
    if (contentType && !contentType.toLowerCase().startsWith("image/"))
      throw new Error(`Ссылка вернула не изображение (${contentType})`);

    // 2. Имя файла.
    const filename = filenameFromUrl(url, contentType);

    // 3. Авторизация и папка (создаётся вместе с подпапкой).
    const auth = authHeader(s.email, s.appPassword);
    await ensureFolder(targetFolder, auth);

    // 4. Уникальное имя и атомарная загрузка без перезаписи существующего файла.
    const finalName = await uploadUniqueFile(targetFolder, filename, blob, contentType, auth);

    notify("Сохранено в Облако", `${finalName} → ${targetFolder}`);
    return { ok: true, name: finalName, folder: targetFolder };
  } catch (e) {
    const error = mapError(e);
    notify("Не удалось сохранить", error);
    return { ok: false, error };
  }
}

async function saveLocally(url, targetFolder) {
  const filename = filenameFromUrl(url, "");
  const relativePath = `${targetFolder}/${filename}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename: relativePath,
    conflictAction: "uniquify",
    saveAs: false,
  });
  if (downloadId == null) throw new Error("Chrome не начал загрузку");

  const [download] = await chrome.downloads.search({ id: downloadId });
  const finalName = download?.filename
    ? download.filename.split(/[\\/]/).pop() || filename
    : filename;
  const visibleFolder = `Загрузки/${targetFolder}`;
  notify("Загрузка началась", `${finalName} → ${visibleFolder}`);
  return { ok: true, name: finalName, folder: visibleFolder, pending: true, downloadId };
}

function safeFolderPath(folder) {
  return String(folder || "")
    .split("/")
    .map(safeFolderSegment)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function safeFolderSegment(segment) {
  const value = sanitizeName(String(segment || ""));
  return value === "." || value === ".." ? "" : value;
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
