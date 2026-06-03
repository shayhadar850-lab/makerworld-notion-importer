const NOTION_VERSION = "2022-06-28";
const MAX_PRINT_TIME_SECONDS = 8 * 3600;
const DEFAULT_SETTINGS = {
  notionToken: "",
  notionDatabaseId: "",
  enforceCommercialLicense: false,
  enforceMaxPrintTime: false
};

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeSourceUrl(url) {
  return String(url || "")
    .replace(/#.*$/, "")
    .replace(/\?.*$/, "")
    .trim();
}

function trimText(value, max = 1900) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildRichText(text) {
  const value = trimText(text);
  if (!value) {
    return [];
  }

  return [
    {
      type: "text",
      text: {
        content: value
      }
    }
  ];
}

async function notionFetch(token, path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Notion request failed (${response.status})`);
  }

  return data;
}

async function getDatabase(token, databaseId) {
  return notionFetch(token, `/databases/${databaseId}`, { method: "GET" });
}

function getPropertyNameByType(schema, type, preferredNames = []) {
  const entries = Object.entries(schema || {});

  for (const preferredName of preferredNames) {
    const match = entries.find(([name, definition]) => {
      return normalizeName(name) === normalizeName(preferredName) && definition.type === type;
    });

    if (match) {
      return match[0];
    }
  }

  const fallback = entries.find(([, definition]) => definition.type === type);
  return fallback?.[0] || null;
}

function estimatePrice(product) {
  const weight = Number(product.selectedProfile?.weightGrams || 0);
  const hours = Number(product.selectedProfile?.durationSeconds || 0) / 3600;
  const engagement =
    Number(product.likeCount || 0) * 0.003 +
    Number(product.downloadCount || 0) * 0.0015 +
    Number(product.commentCount || 0) * 0.05;
  const categoryBoost = /decor|house|home/i.test(product.category || "") ? 18 : 8;

  const base = 35 + weight * 0.22 + hours * 12 + engagement + categoryBoost;
  return Math.max(35, Math.round(base / 5) * 5);
}

function estimateMinPrice(product) {
  const weight = Number(product.selectedProfile?.weightGrams || 0);
  const hours = Number(product.selectedProfile?.durationSeconds || 0) / 3600;
  const cost = 10 + weight * 0.08 + hours * 4.5;
  return Math.max(20, Math.round(cost / 5) * 5);
}

function buildSourceDescription(product) {
  const lines = [];

  if (product.description) {
    lines.push(trimText(product.description, 1500));
  }

  if (product.selectedProfile) {
    lines.push(
      `Profile: ${product.selectedProfile.title || "Default"} | Time: ${
        product.selectedProfile.durationHuman || "Unknown"
      } | Weight: ${product.selectedProfile.weightGrams || "Unknown"}g | Colors: ${
        (product.selectedProfile.colorNames || []).join(", ") || "Unknown"
      }`
    );
  }

  if (product.dimensions) {
    const parts = [];
    if (product.dimensions.width) parts.push(`W ${product.dimensions.width}mm`);
    if (product.dimensions.height) parts.push(`H ${product.dimensions.height}mm`);
    if (product.dimensions.depth) parts.push(`D ${product.dimensions.depth}mm`);
    if (parts.length) {
      lines.push(`Dimensions: ${parts.join(" x ")}`);
    }
  }

  return lines.join("\n\n");
}

function buildAutomationLog(product) {
  return [
    "Imported via MakerWorld Chrome Importer",
    `Imported at: ${new Date().toISOString()}`,
    `Source: ${normalizeSourceUrl(product.sourceUrl)}`,
    `Likes: ${product.likeCount}`,
    `Downloads: ${product.downloadCount}`,
    `Comments: ${product.commentCount}`,
    `License status: ${product.licenseStatus}`,
    `Selected profile time: ${product.selectedProfile?.durationHuman || "Unknown"}`,
    `Selected profile weight: ${product.selectedProfile?.weightGrams || "Unknown"}g`
  ].join(" | ");
}

function buildFiles(urls) {
  return (urls || []).slice(0, 50).map((url, index) => ({
    name: `MakerWorld Image ${index + 1}`,
    type: "external",
    external: { url }
  }));
}

function buildProperties(schema, product) {
  const properties = {};
  const entries = Object.entries(schema || {});
  const estimatedPrice = estimatePrice(product);
  const minPrice = estimateMinPrice(product);
  const images = buildFiles(product.imageUrls);
  const now = new Date().toISOString();
  const normalizedSourceUrl = normalizeSourceUrl(product.sourceUrl);

  for (const [name, definition] of entries) {
    const normalized = normalizeName(name);

    if (definition.type === "title") {
      properties[name] = {
        title: buildRichText(product.sourceTitle)
      };
      continue;
    }

    if (definition.type === "rich_text") {
      if (normalized.includes("description") || normalized.includes("\u05ea\u05d9\u05d0\u05d5\u05e8")) {
        properties[name] = { rich_text: buildRichText(buildSourceDescription(product)) };
      } else if (normalized.includes("headline")) {
        properties[name] = { rich_text: buildRichText(product.sourceTitle) };
      } else if (normalized.includes("automation log")) {
        properties[name] = { rich_text: buildRichText(buildAutomationLog(product)) };
      } else if (normalized.includes("last agent")) {
        properties[name] = { rich_text: buildRichText("MakerWorld Chrome Importer") };
      } else if (normalized.includes("social copy")) {
        properties[name] = { rich_text: [] };
      }
      continue;
    }

    if (definition.type === "url") {
      if (normalized.includes("source")) {
        properties[name] = { url: normalizedSourceUrl };
      }
      continue;
    }

    if (definition.type === "number") {
      if (normalized === "likes") {
        properties[name] = { number: product.likeCount };
      } else if (normalized === "price") {
        properties[name] = { number: estimatedPrice };
      } else if (normalized === "min price") {
        properties[name] = { number: minPrice };
      }
      continue;
    }

    if (definition.type === "select") {
      if (normalized === "category" && product.category) {
        properties[name] = { select: { name: trimText(product.category, 100) } };
      }
      continue;
    }

    if (definition.type === "multi_select") {
      if (normalized === "tags" && product.tags?.length) {
        properties[name] = {
          multi_select: product.tags.slice(0, 20).map((tag) => ({ name: trimText(tag, 100) }))
        };
      }
      continue;
    }

    if (definition.type === "files") {
      if (normalized.includes("image") || normalized.includes("asset")) {
        properties[name] = { files: images };
      }
      continue;
    }

    if (definition.type === "checkbox") {
      if (
        normalized.includes("approved") ||
        normalized.includes("posted to social") ||
        normalized.includes("publishing in social")
      ) {
        properties[name] = { checkbox: false };
      }
      continue;
    }

    if (definition.type === "status") {
      const option = definition.status?.options?.find((item) => /scraped|new|todo/i.test(item.name));
      if (option) {
        properties[name] = { status: { name: option.name } };
      }
      continue;
    }

    if (definition.type === "date") {
      if (normalized.includes("ingested")) {
        properties[name] = { date: { start: now } };
      }
    }
  }

  return properties;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStoredSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    token: settings.notionToken,
    databaseId: settings.notionDatabaseId,
    enforceCommercialLicense: Boolean(settings.enforceCommercialLicense),
    enforceMaxPrintTime: Boolean(settings.enforceMaxPrintTime)
  };
}

function exceedsMaxPrintTime(product) {
  const durationSeconds = Number(product?.selectedProfile?.durationSeconds || 0);
  return Number.isFinite(durationSeconds) && durationSeconds > MAX_PRINT_TIME_SECONDS;
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const currentTab = await chrome.tabs.get(tabId);
  if (currentTab.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdate);
      reject(new Error("Timed out while loading MakerWorld product page."));
    }, timeoutMs);

    function handleUpdate(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(handleUpdate);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
  });
}

async function extractProductFromUrl(url) {
  let tabId = null;

  try {
    const createdTab = await chrome.tabs.create({
      url,
      active: false
    });
    tabId = createdTab.id;

    if (!tabId) {
      throw new Error("Could not open a background tab for this MakerWorld product.");
    }

    await waitForTabComplete(tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await delay(800);

    let response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PRODUCT" }).catch(() => null);
    if (!response?.ok) {
      await delay(1200);
      response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PRODUCT" }).catch(() => null);
    }

    if (!response?.ok || !response.product) {
      throw new Error(response?.error || "Could not extract product data from the selected card.");
    }

    return response.product;
  } finally {
    if (tabId) {
      await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

async function findExistingProduct(token, databaseId, product, database = null) {
  const schemaSource = database || (await getDatabase(token, databaseId));
  const urlProperty = getPropertyNameByType(schemaSource.properties, "url", ["Source Link"]);
  const titleProperty = getPropertyNameByType(schemaSource.properties, "title", ["Model Name", "Name"]);
  const normalizedUrl = normalizeSourceUrl(product?.sourceUrl);

  if (urlProperty && normalizedUrl) {
    const byUrl = await notionFetch(token, `/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: urlProperty,
          url: {
            equals: normalizedUrl
          }
        },
        page_size: 1
      })
    });

    if (byUrl.results?.length) {
      return {
        exists: true,
        matchType: "source-url",
        pageId: byUrl.results[0].id,
        pageUrl: byUrl.results[0].url
      };
    }
  }

  if (titleProperty && product?.sourceTitle) {
    const byTitle = await notionFetch(token, `/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: titleProperty,
          title: {
            equals: trimText(product.sourceTitle, 200)
          }
        },
        page_size: 5
      })
    });

    if (byTitle.results?.length) {
      const matched = byTitle.results.find((page) => {
        if (!urlProperty || !normalizedUrl) {
          return true;
        }

        const pageUrlValue = page.properties?.[urlProperty]?.url || "";
        return !pageUrlValue || normalizeSourceUrl(pageUrlValue) === normalizedUrl;
      });

      if (matched) {
        return {
          exists: true,
          matchType: "title",
          pageId: matched.id,
          pageUrl: matched.url
        };
      }
    }
  }

  return {
    exists: false
  };
}

async function createNotionPage(token, databaseId, product, database = null) {
  const databaseSource = database || (await getDatabase(token, databaseId));
  const properties = buildProperties(databaseSource.properties, product);

  return notionFetch(token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: buildRichText(
              `Imported from MakerWorld.\nSource: ${normalizeSourceUrl(product.sourceUrl)}\nLicense status: ${product.licenseStatus}`
            )
          }
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: buildRichText(product.licenseText || "No license text captured from the page.")
          }
        }
      ]
    })
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!["IMPORT_TO_NOTION", "CHECK_DUPLICATE", "IMPORT_FROM_URL"].includes(message?.type)) {
    return false;
  }

  (async () => {
    try {
      let { token, databaseId, enforceCommercialLicense, enforceMaxPrintTime, product } =
        message.payload || {};

      if (message.type === "IMPORT_FROM_URL") {
        const settings = await getStoredSettings();
        token = settings.token;
        databaseId = settings.databaseId;
        enforceCommercialLicense = settings.enforceCommercialLicense;
        enforceMaxPrintTime = settings.enforceMaxPrintTime;
        product = await extractProductFromUrl(message.payload?.url);
      }

      if (!token || !databaseId) {
        throw new Error("Missing Notion token or database ID in extension settings.");
      }

      if (!product?.sourceTitle) {
        throw new Error("No product data received from the current MakerWorld page.");
      }

      if (
        (message.type === "IMPORT_TO_NOTION" || message.type === "IMPORT_FROM_URL") &&
        enforceCommercialLicense &&
        product.licenseStatus &&
        product.licenseStatus !== "unknown" &&
        product.licenseStatus !== "review"
      ) {
        throw new Error(
          `Import blocked by license setting. Current status: ${product.licenseStatus.replaceAll("_", " ")}.`
        );
      }

      if (
        (message.type === "IMPORT_TO_NOTION" || message.type === "IMPORT_FROM_URL") &&
        enforceMaxPrintTime &&
        exceedsMaxPrintTime(product)
      ) {
        throw new Error("Import blocked by print-time setting. This product takes more than 8 hours to print.");
      }

      const database = await getDatabase(token, databaseId);
      const existing = await findExistingProduct(token, databaseId, product, database);

      if (message.type === "CHECK_DUPLICATE") {
        sendResponse({
          ok: true,
          ...existing
        });
        return;
      }

      if (existing.exists) {
        sendResponse({
          ok: false,
          duplicate: true,
          error: "This product already exists in Notion.",
          ...existing
        });
        return;
      }

      const created = await createNotionPage(token, databaseId, product, database);
      sendResponse({
        ok: true,
        productTitle: product.sourceTitle,
        pageUrl: created.url,
        pageId: created.id
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Import failed."
      });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get([
    "notionToken",
    "notionDatabaseId",
    "enforceCommercialLicense",
    "enforceMaxPrintTime"
  ]);

  await chrome.storage.sync.set({
    notionToken: current.notionToken || DEFAULT_SETTINGS.notionToken,
    notionDatabaseId: current.notionDatabaseId || DEFAULT_SETTINGS.notionDatabaseId,
    enforceCommercialLicense:
      typeof current.enforceCommercialLicense === "boolean"
        ? current.enforceCommercialLicense
        : DEFAULT_SETTINGS.enforceCommercialLicense,
    enforceMaxPrintTime:
      typeof current.enforceMaxPrintTime === "boolean"
        ? current.enforceMaxPrintTime
        : DEFAULT_SETTINGS.enforceMaxPrintTime
  });
});
