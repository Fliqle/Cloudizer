// Popup: тумблер включения, статус настроек, переход в настройки.
const enabledEl = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const openEl = document.getElementById("open");

async function init() {
  const s = await chrome.storage.local.get({
    destination: "cloud",
    enabled: true,
    email: "",
    appPassword: "",
    folder: "",
  });
  enabledEl.checked = s.enabled;

  if (s.destination === "local") {
    statusEl.className = "status ok";
    statusEl.textContent = `На компьютер: Загрузки/${s.folder || "Сохранённые картинки"}`;
  } else if (s.email && s.appPassword) {
    statusEl.className = "status ok";
    statusEl.textContent = `Облако Mail: ${s.folder || "Сохранённые картинки"}`;
  } else {
    statusEl.className = "status warn";
    statusEl.textContent = "Не настроено: укажите e-mail и пароль приложения.";
  }
}

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

openEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
