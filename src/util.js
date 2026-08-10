// Общие хелперы (ES-модуль, используется service worker'ом).

export const DEFAULTS = {
  email: "",
  appPassword: "",
  folder: "Сохранённые картинки",
  categories: ["Интерьер", "Фото", "Арт", "Интерфейс"],
  enabled: true,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

// Соответствие Content-Type → расширение файла.
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/tiff": "tiff",
  "image/heic": "heic",
};

export function extFromContentType(ct) {
  if (!ct) return "";
  const type = ct.split(";")[0].trim().toLowerCase();
  return MIME_EXT[type] || "";
}

// Убрать символы, недопустимые в именах файлов.
export function sanitizeName(name) {
  return name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

// Сформировать имя файла из URL картинки (+ дополнить расширением по Content-Type).
export function filenameFromUrl(url, contentType) {
  let base = "image";
  let ext = "";

  try {
    if (url.startsWith("data:")) {
      base = "image";
    } else {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (last) {
        const dot = last.lastIndexOf(".");
        if (dot > 0) {
          base = last.slice(0, dot);
          ext = last.slice(dot + 1).toLowerCase();
        } else {
          base = last;
        }
      }
    }
  } catch {
    /* оставим дефолты */
  }

  // расширение из URL может быть мусором (?, длинное) — доверяем Content-Type
  const ctExt = extFromContentType(contentType);
  if (ctExt) ext = ctExt;
  if (!ext) ext = "jpg";
  if (!base) base = "image";

  base = sanitizeName(base);
  return `${base}.${ext}`;
}

// Разбить имя на основу и расширение (для добавления суффикса при коллизии).
export function splitName(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}
