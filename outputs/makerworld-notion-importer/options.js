const tokenInput = document.getElementById("token");
const databaseIdInput = document.getElementById("database-id");
const enforceLicenseCheckbox = document.getElementById("enforce-license");
const enforceMaxPrintTimeCheckbox = document.getElementById("enforce-max-print-time");
const saveButton = document.getElementById("save");
const messageEl = document.getElementById("message");

const DEFAULT_SETTINGS = {
  notionToken: "",
  notionDatabaseId: "",
  enforceCommercialLicense: false,
  enforceMaxPrintTime: false
};

async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  tokenInput.value = data.notionToken;
  databaseIdInput.value = data.notionDatabaseId;
  enforceLicenseCheckbox.checked = Boolean(data.enforceCommercialLicense);
  enforceMaxPrintTimeCheckbox.checked = Boolean(data.enforceMaxPrintTime);
}

async function saveSettings() {
  await chrome.storage.sync.set({
    notionToken: tokenInput.value.trim(),
    notionDatabaseId: databaseIdInput.value.trim(),
    enforceCommercialLicense: enforceLicenseCheckbox.checked,
    enforceMaxPrintTime: enforceMaxPrintTimeCheckbox.checked
  });

  messageEl.textContent = "Saved.";
  setTimeout(() => {
    messageEl.textContent = "";
  }, 1500);
}

saveButton.addEventListener("click", saveSettings);
loadSettings();
