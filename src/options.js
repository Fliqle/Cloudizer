// Настройки. Обычный скрипт страницы (не модуль). WebDAV-проверка идёт через background.
const DEFAULTS = {
  destination: "cloud",
  email: "",
  appPassword: "",
  folder: "Сохранённые картинки",
  categories: ["Интерьер", "Фото", "Арт", "Интерфейс"],
  enabled: true,
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function showStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.dataset.kind = kind; // ok | err | info
}

async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $(s.destination === "local" ? "destinationLocal" : "destinationCloud").checked = true;
  $("email").value = s.email;
  $("appPassword").value = s.appPassword;
  $("folder").value = s.folder;
  $("categories").value = (s.categories || []).join("\n");
  $("enabled").checked = s.enabled;
  updateDestinationUI();
}

function parseCategories(text) {
  const list = text
    .split("\n")
    .map(normalizeSegment)
    .filter(Boolean);
  return list.length ? list : DEFAULTS.categories;
}

function normalizeSegment(value) {
  const segment = String(value || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return segment === "." || segment === ".." ? "" : segment;
}

function normalizeFolder(value) {
  return String(value || "")
    .split("/")
    .map(normalizeSegment)
    .filter(Boolean)
    .join("/");
}

function currentValues() {
  return {
    destination: $("destinationLocal").checked ? "local" : "cloud",
    email: $("email").value.trim(),
    appPassword: $("appPassword").value,
    folder: normalizeFolder($("folder").value) || DEFAULTS.folder,
    categories: parseCategories($("categories").value),
    enabled: $("enabled").checked,
  };
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = currentValues();
  await chrome.storage.local.set(values);
  $("folder").value = values.folder;
  $("categories").value = values.categories.join("\n");
  showStatus(
    $("destinationLocal").checked
      ? "Сохранено. Изображения будут загружаться на компьютер ✓"
      : "Сохранено. Изображения будут отправляться в Облако Mail ✓",
    "ok"
  );
});

function updateDestinationUI() {
  const local = $("destinationLocal").checked;
  $("cloudSettings").hidden = local;
  $("cloudNote").hidden = local;
  $("test").hidden = local;
  $("localNote").hidden = !local;
  $("folderLabel").textContent = local ? "Папка внутри «Загрузок»" : "Папка в Облаке";
  $("folderHint").innerHTML = local
    ? "Файлы будут сохраняться в <code>Загрузки/название папки/категория</code>."
    : "Папка создастся автоматически, если её ещё нет. Можно вложенную: <code>Картинки/С сайтов</code>.";
  statusEl.hidden = true;
}

$("destinationCloud").addEventListener("change", updateDestinationUI);
$("destinationLocal").addEventListener("change", updateDestinationUI);

$("test").addEventListener("click", async () => {
  const v = currentValues();
  if (!v.email || !v.appPassword) {
    showStatus("Заполните e-mail и пароль приложения.", "err");
    return;
  }
  showStatus("Проверяем подключение…", "info");
  try {
    const r = await chrome.runtime.sendMessage({
      type: "TEST_CONNECTION",
      email: v.email,
      appPassword: v.appPassword,
    });
    if (r?.ok) {
      showStatus("Подключение успешно ✓", "ok");
    } else if (r?.reason === "auth") {
      showStatus("Неверный e-mail или пароль приложения.", "err");
    } else if (r?.reason === "forbidden") {
      showStatus("Доступ по WebDAV запрещён. Скорее всего, нужен платный тариф Облака.", "err");
    } else if (r?.reason === "network") {
      showStatus("Сетевая ошибка. Проверьте интернет.", "err");
    } else {
      showStatus(`Не удалось подключиться (${r?.detail ?? "ошибка"}).`, "err");
    }
  } catch (err) {
    showStatus("Ошибка связи с расширением.", "err");
  }
});

load();
