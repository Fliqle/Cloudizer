// Настройки. Обычный скрипт страницы (не модуль). WebDAV-проверка идёт через background.
const DEFAULTS = {
  destination: "cloud",
  email: "",
  appPassword: "",
  folder: "Сохраненные картинки",
  categories: ["Архитектура", "Дизайн", "Интерфейс"],
  enabled: true,
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
let categoryTags = [...DEFAULTS.categories];

function showStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.dataset.kind = kind; // ok | err | info
}

async function load() {
  const s =
    typeof chrome === "undefined" || !chrome.storage?.local
      ? DEFAULTS
      : await chrome.storage.local.get(DEFAULTS);
  $(s.destination === "local" ? "destinationLocal" : "destinationCloud").checked = true;
  $("email").value = s.email;
  $("appPassword").value = s.appPassword;
  $("folder").value = s.folder;
  const storedCategories = Array.isArray(s.categories) ? s.categories : [];
  categoryTags = uniqueCategories(storedCategories);
  if (!categoryTags.length) categoryTags = [...DEFAULTS.categories];
  renderCategoryTags();
  $("enabled").checked = s.enabled;
  updateDestinationUI();
}

function normalizeSegment(value) {
  const segment = String(value || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return segment === "." || segment === ".." ? "" : segment;
}

function uniqueCategories(values) {
  const seen = new Set();
  return values.map(normalizeSegment).filter((value) => {
    const key = value.toLocaleLowerCase("ru");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasCategory(value, exceptIndex = -1) {
  const key = value.toLocaleLowerCase("ru");
  return categoryTags.some((category, index) =>
    index !== exceptIndex && category.toLocaleLowerCase("ru") === key
  );
}

function renderCategoryTags() {
  const container = $("categoryTags");
  container.replaceChildren();

  categoryTags.forEach((category, index) => {
    const tag = document.createElement("div");
    tag.className = "category-tag";

    const name = document.createElement("button");
    name.type = "button";
    name.className = "category-tag-name";
    name.textContent = category;
    name.title = "Нажмите, чтобы переименовать";
    name.addEventListener("click", () => editCategory(index, tag));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "category-tag-remove";
    remove.setAttribute("aria-label", `Удалить папку «${category}»`);
    remove.title = categoryTags.length === 1 ? "Должна остаться хотя бы одна папка" : "Удалить";
    remove.disabled = categoryTags.length === 1;

    const removeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    removeIcon.setAttribute("width", "16");
    removeIcon.setAttribute("height", "16");
    removeIcon.setAttribute("viewBox", "0 0 16 16");
    removeIcon.setAttribute("fill", "none");
    removeIcon.setAttribute("aria-hidden", "true");

    const removeIconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    removeIconPath.setAttribute("d", "M4 4L12 12M12 4L4 12");
    removeIconPath.setAttribute("stroke", "currentColor");
    removeIconPath.setAttribute("stroke-width", "1.5");
    removeIconPath.setAttribute("stroke-linecap", "round");
    removeIcon.append(removeIconPath);
    remove.append(removeIcon);

    remove.addEventListener("click", () => {
      categoryTags.splice(index, 1);
      renderCategoryTags();
    });

    tag.append(name, remove);
    container.append(tag);
  });
}

function editCategory(index, tag) {
  const name = tag.querySelector(".category-tag-name");
  const input = document.createElement("input");
  input.className = "category-tag-edit";
  input.value = categoryTags[index];
  input.maxLength = 180;
  input.style.width = `${name.getBoundingClientRect().width}px`;
  input.setAttribute("aria-label", "Новое название папки");
  name.replaceWith(input);

  const finish = (save) => {
    if (!input.isConnected) return;
    if (save) {
      const value = normalizeSegment(input.value);
      if (value && !hasCategory(value, index)) categoryTags[index] = value;
    }
    renderCategoryTags();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  input.select();
}

function addCategory() {
  const input = $("categoryInput");
  const value = normalizeSegment(input.value);
  input.setCustomValidity("");
  if (!value) {
    input.focus();
    return;
  }
  if (hasCategory(value)) {
    input.setCustomValidity("Такая папка уже есть.");
    input.reportValidity();
    return;
  }

  categoryTags.push(value);
  input.value = "";
  renderCategoryTags();
  input.focus();
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
    categories: [...categoryTags],
    enabled: $("enabled").checked,
  };
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = currentValues();
  await chrome.storage.local.set(values);
  $("folder").value = values.folder;
  categoryTags = [...values.categories];
  renderCategoryTags();
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
  $("test").hidden = local;
  $("folderLabel").textContent = local ? "Папка внутри «Загрузок»" : "Папка в облаке";
  $("folderHint").innerHTML = local
    ? "Файлы будут сохраняться в <code>Загрузки/название папки/категория</code>."
    : "Папка создастся автоматически, если её ещё нет. Можно вложенную: <code>Картинки/С сайтов</code>.";
  statusEl.hidden = true;
}

$("destinationCloud").addEventListener("change", updateDestinationUI);
$("destinationLocal").addEventListener("change", updateDestinationUI);
$("addCategory").addEventListener("click", addCategory);
$("categoryInput").addEventListener("input", (event) => event.target.setCustomValidity(""));
$("categoryInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCategory();
  }
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
