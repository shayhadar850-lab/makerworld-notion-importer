const statusEl = document.getElementById("status");
const productCardEl = document.getElementById("product-card");
const productTitleEl = document.getElementById("product-title");
const productMetaEl = document.getElementById("product-meta");
const productProfileEl = document.getElementById("product-profile");
const productLicenseEl = document.getElementById("product-license");
const productDuplicateEl = document.getElementById("product-duplicate");
const importButton = document.getElementById("import");
const queueButton = document.getElementById("queue");
const importQueueButton = document.getElementById("import-queue");
const refreshButton = document.getElementById("refresh");
const openOptionsButton = document.getElementById("open-options");
const enforceLicenseCheckbox = document.getElementById("enforce-license");
const enforceMaxPrintTimeCheckbox = document.getElementById("enforce-max-print-time");
const queueListEl = document.getElementById("queue-list");
const queueCountEl = document.getElementById("queue-count");

const MAX_PRINT_TIME_SECONDS = 8 * 3600;
const DEFAULT_SETTINGS = {
  notionToken: "",
  notionDatabaseId: "",
  enforceCommercialLicense: false,
  enforceMaxPrintTime: false
};

const DEFAULT_LOCAL_STATE = {
  queuedProducts: [],
  importedProductKeys: []
};

let currentProduct = null;
let currentSettings = null;
let currentDuplicate = null;
let queuedProducts = [];

function normalizeSourceUrl(url) {
  return String(url || "")
    .replace(/#.*$/, "")
    .replace(/\?.*$/, "")
    .trim();
}

function buildProductKey(product) {
  return normalizeSourceUrl(product?.sourceUrl || "");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#8c2f1a" : "#1f1b16";
}

function exceedsMaxPrintTime(product) {
  const durationSeconds = Number(product?.selectedProfile?.durationSeconds || 0);
  return Number.isFinite(durationSeconds) && durationSeconds > MAX_PRINT_TIME_SECONDS;
}

function isQueued(product) {
  const key = buildProductKey(product);
  return queuedProducts.some((item) => buildProductKey(item) === key);
}

function removeQueuedProductByKey(productKey) {
  queuedProducts = queuedProducts.filter((item) => buildProductKey(item) !== productKey);
}

function renderCurrentActions() {
  const hasSettings = Boolean(currentSettings?.token && currentSettings?.databaseId);
  const hasProduct = Boolean(currentProduct);
  const duplicateFound = Boolean(currentDuplicate?.exists);
  const blockedByPrintTime =
    Boolean(currentSettings?.enforceMaxPrintTime) && exceedsMaxPrintTime(currentProduct);

  importButton.disabled = !hasSettings || !hasProduct || duplicateFound || blockedByPrintTime;
  queueButton.disabled = !hasProduct || duplicateFound || isQueued(currentProduct) || blockedByPrintTime;
  importQueueButton.disabled = !hasSettings || !queuedProducts.length;
}

function renderQueue() {
  queueCountEl.textContent = `${queuedProducts.length} item${queuedProducts.length === 1 ? "" : "s"}`;

  if (!queuedProducts.length) {
    queueListEl.innerHTML = '<p class="muted">No queued products yet.</p>';
    renderCurrentActions();
    return;
  }

  queueListEl.innerHTML = queuedProducts
    .map((item, index) => {
      const duration = item.selectedProfile?.durationHuman || "Unknown time";
      return `
        <div class="queue-item">
          <div>
            <strong>${item.sourceTitle || "Untitled model"}</strong>
            <span>${duration} | Likes ${item.likeCount || 0}</span>
          </div>
          <button class="ghost remove-queue-item" data-index="${index}">Remove</button>
        </div>
      `;
    })
    .join("");

  for (const button of queueListEl.querySelectorAll(".remove-queue-item")) {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      if (Number.isNaN(index)) {
        return;
      }

      queuedProducts.splice(index, 1);
      await saveQueue();
      renderQueue();
      renderProduct(currentProduct);
      setStatus("Removed from queue.");
    });
  }

  renderCurrentActions();
}

function renderProduct(product) {
  currentProduct = product;
  productCardEl.classList.remove("hidden");
  productTitleEl.textContent = product?.sourceTitle || "Untitled model";
  productMetaEl.textContent = `Likes ${product?.likeCount || 0} | Downloads ${product?.downloadCount || 0} | Comments ${product?.commentCount || 0}`;
  productProfileEl.textContent = product?.selectedProfile
    ? `Profile: ${product.selectedProfile.title || "Default"} | Time: ${
        product.selectedProfile.durationHuman || "Unknown"
      } | Weight: ${product.selectedProfile.weightGrams || "Unknown"}g | Colors: ${
        (product.selectedProfile.colorNames || []).join(", ") || "Unknown"
      }`
    : "No print profile was detected.";
  productLicenseEl.textContent = `License: ${product?.licenseStatus || "unknown"}`;

  if (currentDuplicate?.exists) {
    productDuplicateEl.textContent = "Already exists in Notion. This product will not be imported again.";
  } else if (currentSettings?.enforceMaxPrintTime && exceedsMaxPrintTime(product)) {
    productDuplicateEl.textContent = "Blocked by 8-hour print-time limit.";
  } else if (isQueued(product)) {
    productDuplicateEl.textContent = "Already in queue.";
  } else {
    productDuplicateEl.textContent = "";
  }

  renderCurrentActions();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (_error) {
    // Ignore injection errors and let the follow-up request fail naturally.
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  currentSettings = {
    token: settings.notionToken,
    databaseId: settings.notionDatabaseId,
    enforceCommercialLicense: Boolean(settings.enforceCommercialLicense),
    enforceMaxPrintTime: Boolean(settings.enforceMaxPrintTime)
  };
  enforceLicenseCheckbox.checked = currentSettings.enforceCommercialLicense;
  enforceMaxPrintTimeCheckbox.checked = currentSettings.enforceMaxPrintTime;
}

async function loadLocalState() {
  const local = await chrome.storage.local.get(DEFAULT_LOCAL_STATE);
  queuedProducts = Array.isArray(local.queuedProducts) ? local.queuedProducts : [];
}

async function saveQueue() {
  await chrome.storage.local.set({
    queuedProducts
  });
}

async function rememberImportedProduct(product) {
  const local = await chrome.storage.local.get(DEFAULT_LOCAL_STATE);
  const importedKeys = new Set(local.importedProductKeys || []);
  importedKeys.add(buildProductKey(product));
  await chrome.storage.local.set({
    importedProductKeys: [...importedKeys]
  });
}

async function checkDuplicate(product) {
  if (!currentSettings?.token || !currentSettings?.databaseId || !product?.sourceTitle) {
    currentDuplicate = null;
    return null;
  }

  const response = await chrome.runtime.sendMessage({
    type: "CHECK_DUPLICATE",
    payload: {
      token: currentSettings.token,
      databaseId: currentSettings.databaseId,
      product
    }
  });

  currentDuplicate = response?.ok ? response : null;
  return currentDuplicate;
}

async function extractCurrentProduct() {
  setStatus("Reading this MakerWorld page...");
  productCardEl.classList.add("hidden");
  currentDuplicate = null;
  renderCurrentActions();

  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.includes("makerworld.com")) {
    setStatus("Open a MakerWorld product page first.", true);
    return;
  }

  let response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PRODUCT" }).catch(() => null);
  if (!response?.ok) {
    await ensureContentScript(tab.id);
    response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PRODUCT" }).catch(() => null);
  }

  if (!response?.ok) {
    setStatus(
      response?.error ||
        "Could not extract product data from this page. Try reloading the MakerWorld tab once and open the extension again.",
      true
    );
    return;
  }

  await checkDuplicate(response.product);
  renderProduct(response.product);
  setStatus("Product is ready.");
}

async function importSingleProduct(product) {
  if (!product) {
    setStatus("No product is loaded yet.", true);
    return { ok: false };
  }

  if (!currentSettings?.token || !currentSettings?.databaseId) {
    setStatus("Set your Notion token and database ID in Settings first.", true);
    return { ok: false };
  }

  const response = await chrome.runtime.sendMessage({
    type: "IMPORT_TO_NOTION",
    payload: {
      token: currentSettings.token,
      databaseId: currentSettings.databaseId,
      enforceCommercialLicense: enforceLicenseCheckbox.checked,
      enforceMaxPrintTime: enforceMaxPrintTimeCheckbox.checked,
      product
    }
  });

  if (!response?.ok) {
    return response || { ok: false };
  }

  await rememberImportedProduct(product);
  removeQueuedProductByKey(buildProductKey(product));
  await saveQueue();
  return response;
}

async function addCurrentToQueue() {
  if (!currentProduct) {
    setStatus("No product is loaded yet.", true);
    return;
  }

  if (currentDuplicate?.exists) {
    setStatus("This product is already in Notion.", true);
    return;
  }

  if (currentSettings?.enforceMaxPrintTime && exceedsMaxPrintTime(currentProduct)) {
    setStatus("This product is blocked because it takes more than 8 hours to print.", true);
    return;
  }

  if (isQueued(currentProduct)) {
    setStatus("This product is already in the queue.", true);
    return;
  }

  queuedProducts.push(currentProduct);
  await saveQueue();
  renderQueue();
  renderProduct(currentProduct);
  setStatus("Product added to queue.");
}

async function importCurrentProduct() {
  importButton.disabled = true;
  setStatus("Sending product to Notion...");

  const response = await importSingleProduct(currentProduct);
  if (!response?.ok) {
    setStatus(response?.error || "Import failed.", true);
    renderQueue();
    renderCurrentActions();
    return;
  }

  currentDuplicate = {
    ok: true,
    exists: true,
    source: "recent-import"
  };
  renderQueue();
  renderProduct(currentProduct);
  setStatus("Imported successfully. Page created in Notion.");
}

async function importQueuedProducts() {
  if (!queuedProducts.length) {
    setStatus("Queue is empty.", true);
    return;
  }

  importQueueButton.disabled = true;
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const snapshot = [...queuedProducts];

  for (const product of snapshot) {
    setStatus(`Importing ${product.sourceTitle}...`);
    const duplicateCheck = await chrome.runtime.sendMessage({
      type: "CHECK_DUPLICATE",
      payload: {
        token: currentSettings.token,
        databaseId: currentSettings.databaseId,
        product
      }
    });

    if (duplicateCheck?.ok && duplicateCheck.exists) {
      removeQueuedProductByKey(buildProductKey(product));
      skippedCount += 1;
      continue;
    }

    const response = await importSingleProduct(product);
    if (!response?.ok) {
      failedCount += 1;
      continue;
    }

    importedCount += 1;
  }

  await saveQueue();
  renderQueue();

  if (currentProduct) {
    await checkDuplicate(currentProduct);
    renderProduct(currentProduct);
  } else {
    renderCurrentActions();
  }

  setStatus(
    `Queue finished. Imported ${importedCount}, skipped ${skippedCount}, failed ${failedCount}.`,
    failedCount > 0
  );
}

enforceLicenseCheckbox.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    enforceCommercialLicense: enforceLicenseCheckbox.checked
  });
  if (currentSettings) {
    currentSettings.enforceCommercialLicense = enforceLicenseCheckbox.checked;
  }
  renderProduct(currentProduct);
});

enforceMaxPrintTimeCheckbox.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    enforceMaxPrintTime: enforceMaxPrintTimeCheckbox.checked
  });
  if (currentSettings) {
    currentSettings.enforceMaxPrintTime = enforceMaxPrintTimeCheckbox.checked;
  }
  renderProduct(currentProduct);
});

refreshButton.addEventListener("click", extractCurrentProduct);
openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
queueButton.addEventListener("click", addCurrentToQueue);
importButton.addEventListener("click", importCurrentProduct);
importQueueButton.addEventListener("click", importQueuedProducts);

(async function init() {
  await loadSettings();
  await loadLocalState();
  renderQueue();
  await extractCurrentProduct();
})();
