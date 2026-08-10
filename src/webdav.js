// WebDAV-клиент для Облака Mail (ES-модуль, выполняется в service worker).
// Все запросы идут отсюда: в service worker host_permissions снимают CORS.
import { splitName } from "./util.js";

export const WEBDAV_BASE = "https://webdav.cloud.mail.ru";

// "Basic base64(email:appPassword)". Кодируем через UTF-8 на случай не-ASCII.
export function authHeader(email, appPassword) {
  const bytes = new TextEncoder().encode(`${email}:${appPassword}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

// Путь к ресурсу в облаке: каждый сегмент кодируется отдельно.
function buildUrl(segments) {
  const path = segments
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${WEBDAV_BASE}/${path}`;
}

// Разбить "a/b/c" на сегменты, отбросив пустые.
function folderSegments(folder) {
  return folder.split("/").map((s) => s.trim()).filter(Boolean);
}

// Создать папку (и вложенные уровни). 201 = создано, 405/409-уже-есть → ок.
export async function ensureFolder(folder, auth) {
  const segs = folderSegments(folder);
  if (!segs.length) return; // корень
  for (let i = 1; i <= segs.length; i++) {
    const url = buildUrl(segs.slice(0, i)) + "/";
    const res = await fetch(url, { method: "MKCOL", headers: { Authorization: auth } });
    // 201 Created — новая папка; 405 Method Not Allowed / 409 — уже существует.
    if (![201, 405, 409].includes(res.status)) {
      if (res.status === 401) throw new Error("AUTH");
      if (res.status === 403) throw new Error("FORBIDDEN");
      throw new Error(`MKCOL ${res.status}`);
    }
  }
}

// Существует ли ресурс по пути сегментов.
export async function exists(segments, auth) {
  const res = await fetch(buildUrl(segments), {
    method: "HEAD",
    headers: { Authorization: auth },
  });
  return res.status >= 200 && res.status < 300;
}

// Подобрать свободное имя: file.jpg → "file (1).jpg" → "file (2).jpg" …
export async function resolveName(folder, filename, auth) {
  const segs = folderSegments(folder);
  const { base, ext } = splitName(filename);
  let candidate = filename;
  let n = 1;
  while (await exists([...segs, candidate], auth)) {
    candidate = `${base} (${n})${ext}`;
    n++;
    if (n > 999) break;
  }
  return candidate;
}

// Загрузить Blob в папку под именем filename. Возвращает финальное имя.
export async function uploadFile(folder, filename, blob, contentType, auth) {
  const segs = folderSegments(folder);
  const url = buildUrl([...segs, filename]);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: blob,
  });
  if (res.status === 401) throw new Error("AUTH");
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error(`PUT ${res.status}`);
  }
  return filename;
}

// Проверка подключения: PROPFIND корня. Возвращает {ok, reason}.
export async function testConnection(email, appPassword) {
  if (!email || !appPassword) return { ok: false, reason: "empty" };
  const auth = authHeader(email, appPassword);
  let res;
  try {
    res = await fetch(WEBDAV_BASE + "/", {
      method: "PROPFIND",
      headers: { Authorization: auth, Depth: "0" },
    });
  } catch (e) {
    return { ok: false, reason: "network", detail: String(e) };
  }
  if (res.status === 207 || (res.status >= 200 && res.status < 300))
    return { ok: true };
  if (res.status === 401) return { ok: false, reason: "auth" };
  if (res.status === 403) return { ok: false, reason: "forbidden" };
  return { ok: false, reason: "status", detail: res.status };
}
