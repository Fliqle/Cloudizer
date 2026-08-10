// Настройки. Обычный скрипт страницы (не модуль). WebDAV-проверка идёт через background.
const DEFAULTS = {
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
  $("email").value = s.email;
  $("appPassword").value = s.appPassword;
  $("folder").value = s.folder;
  $("categories").value = (s.categories || []).join("\n");
  $("enabled").checked = s.enabled;
}

function parseCategories(text) {
  const list = text
    .split("\n")
    .map((c) => c.trim().replace(/\//g, " "))
    .filter(Boolean);
  return list.length ? list : DEFAULTS.categories;
}

function currentValues() {
  return {
    email: $("email").value.trim(),
    appPassword: $("appPassword").value,
    folder: $("folder").value.trim() || DEFAULTS.folder,
    categories: parseCategories($("categories").value),
    enabled: $("enabled").checked,
  };
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await chrome.storage.local.set(currentValues());
  showStatus("Сохранено ✓", "ok");
});

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
