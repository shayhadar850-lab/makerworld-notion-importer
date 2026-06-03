function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function textOf(node) {
  return node?.textContent?.trim() || "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeUrlForCompare(url) {
  return String(url || "")
    .replace(/#.*$/, "")
    .replace(/\?.*$/, "")
    .trim();
}

function getPageData() {
  const jsonScript = Array.from(document.scripts).find((script) => {
    const text = script.textContent || "";
    return text.includes('"pageProps"') && text.includes('"design"');
  });

  const parsed = jsonScript ? safeJsonParse(jsonScript.textContent || "") : null;
  const design = parsed?.props?.pageProps?.design || null;

  return { parsed, design };
}

function isDesignDataStale(design) {
  if (!design) {
    return true;
  }

  const pageTitle = textOf(document.querySelector("h1"));
  const canonicalUrl =
    document.querySelector('meta[property="og:url"]')?.content || window.location.href;
  const designSlug = String(design.slug || "").trim();
  const canonical = normalizeUrlForCompare(canonicalUrl);

  if (designSlug && !canonical.includes(designSlug)) {
    return true;
  }

  if (pageTitle && design.title && pageTitle !== design.title) {
    return true;
  }

  return false;
}

function parseHashInstanceId() {
  const match = window.location.hash.match(/profileId-(\d+)/);
  return match ? Number(match[1]) : null;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function hexToColorName(hex) {
  const normalized = (hex || "").toUpperCase();
  const mapping = {
    "#FFFFFF": "White",
    "#000000": "Black",
    "#808080": "Gray",
    "#A9A9A9": "Gray",
    "#8B4513": "Brown",
    "#C19A6B": "Caramel",
    "#D2B48C": "Beige",
    "#6B8E23": "Olive Green",
    "#228B22": "Green",
    "#800080": "Purple",
    "#FFC0CB": "Pink"
  };

  return mapping[normalized] || normalized || "Unknown";
}

function isCommerciallyAllowed(licenseText) {
  const text = (licenseText || "").toLowerCase();
  if (!text) {
    return "unknown";
  }

  if (text.includes("commercial use") && text.includes("strictly prohibited")) {
    return "blocked";
  }

  if (text.includes("commercial use") && text.includes("join my membership")) {
    return "membership_required";
  }

  if (text.includes("commercial")) {
    return "review";
  }

  return "unknown";
}

function collectLicenseText() {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
  const licenseHeading = headings.find((heading) => /license/i.test(textOf(heading)));

  if (!licenseHeading) {
    return "";
  }

  const lines = [];
  let node = licenseHeading.nextElementSibling;

  while (node) {
    const label = node.tagName.toLowerCase();
    if (/^h[1-4]$/.test(label)) {
      break;
    }

    const text = textOf(node);
    if (text) {
      lines.push(text);
    }
    node = node.nextElementSibling;
  }

  return lines.join("\n\n").trim();
}

function collectDescriptionText() {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
  const startHeading = headings.find((heading) => /^description$/i.test(textOf(heading)));

  if (!startHeading) {
    return "";
  }

  const chunks = [];
  let node = startHeading.nextElementSibling;

  while (node) {
    const label = node.tagName.toLowerCase();
    const text = textOf(node);

    if (/^h[1-3]$/.test(label) && /^(license|comment|related models|remixes)$/i.test(text)) {
      break;
    }

    if (/^h[1-3]$/.test(label) && text && !/^description$/i.test(text)) {
      chunks.push(`${text}:`);
    } else if (text) {
      chunks.push(text);
    }

    node = node.nextElementSibling;
  }

  return chunks.join("\n").trim();
}

function collectCreatorName() {
  const candidates = Array.from(document.querySelectorAll('a[href*="/@"]'))
    .map((node) => textOf(node))
    .filter(Boolean)
    .filter((text) => !text.startsWith("@"));

  return candidates[0] || "";
}

function collectCategoryText() {
  const parts = Array.from(document.querySelectorAll('a[href*="/3d-models/"]'))
    .map((node) => textOf(node))
    .filter(Boolean);

  return parts.join(" > ");
}

function parseCompactNumber(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return 0;
  }

  const cleaned = text.replace(/,/g, "");
  if (cleaned.endsWith("k")) {
    return Math.round(Number(cleaned.slice(0, -1)) * 1000);
  }

  if (cleaned.endsWith("m")) {
    return Math.round(Number(cleaned.slice(0, -1)) * 1000000);
  }

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function collectBodyLines() {
  return (document.body.innerText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function fallbackStatsFromDom() {
  const lines = collectBodyLines();
  const openIndex = lines.findIndex((line) => /open in bambu studio/i.test(line));
  const commentLine = lines.find((line) => /comment\s*&\s*rating/i.test(line));
  const commentMatch = commentLine?.match(/\(([\d.,kKmM]+)\)/);

  const stats = {
    likeCount: 0,
    commentCount: commentMatch ? parseCompactNumber(commentMatch[1]) : 0,
    downloadCount: 0,
    collectionCount: 0
  };

  if (openIndex >= 0) {
    const nearby = lines
      .slice(openIndex + 1, openIndex + 10)
      .filter((line) => /^[\d.,]+\s*[kKmM]?$/.test(line));

    if (nearby[0]) stats.likeCount = parseCompactNumber(nearby[0]);
    if (nearby[1]) stats.collectionCount = parseCompactNumber(nearby[1]);
    if (nearby[nearby.length - 1]) stats.downloadCount = parseCompactNumber(nearby[nearby.length - 1]);
  }

  return stats;
}

function collectDomImages() {
  const urls = Array.from(document.images)
    .map((img) => img.currentSrc || img.src || "")
    .filter((src) => src.includes("makerworld.bblmw.com/makerworld/model/"));

  return unique(
    urls.map((url) =>
      url
        .replace(/\?x-oss-process=.*$/i, "")
        .replace(/%2C/g, ",")
    )
  );
}

function extractSelectedProfileTitleFromDom() {
  const lines = collectBodyLines();
  const profileIndex = lines.findIndex((line) => /^print profile/i.test(line));
  const stopWords = new Set([
    "All",
    "A1",
    "P2S",
    "X1 Carbon",
    "H2D Pro",
    "H2D",
    "P1P",
    "X2D",
    "X1",
    "P1S",
    "H2C",
    "H2S",
    "X1E",
    "A2L",
    "A1 mini"
  ]);

  if (profileIndex < 0) {
    return "";
  }

  for (const line of lines.slice(profileIndex + 1, profileIndex + 20)) {
    if (stopWords.has(line)) {
      continue;
    }

    if (/^(designer|open in bambu studio|bill of materials)$/i.test(line)) {
      continue;
    }

    if (/^[\d.,]+\s*[kKmM]?$/.test(line)) {
      continue;
    }

    if (/^\(.*\)$/.test(line)) {
      continue;
    }

    return line;
  }

  return "";
}

function extractDimensions(descriptionText) {
  const matches = [...descriptionText.matchAll(/(Width|Height|Depth):\s*([\d.]+)\s*mm/gi)];
  if (!matches.length) {
    return null;
  }

  const dimensions = {};
  for (const match of matches) {
    dimensions[match[1].toLowerCase()] = Number(match[2]);
  }
  return dimensions;
}

function chooseBestProfile(instances) {
  if (!Array.isArray(instances) || !instances.length) {
    return null;
  }

  const eligible = instances.filter((instance) => {
    const seconds = Number(instance.prediction || 0);
    return (
      Number(instance.materialColorCnt || 0) <= 1 &&
      !instance.needAms &&
      seconds > 0 &&
      seconds <= 8 * 3600
    );
  });

  const pool = eligible.length ? eligible : instances;

  return pool
    .slice()
    .sort((a, b) => {
      const aScore =
        Number(a.downloadCount || 0) * 2 +
        Number(a.printCount || 0) +
        Number(a.ratingCount || 0) * 10;
      const bScore =
        Number(b.downloadCount || 0) * 2 +
        Number(b.printCount || 0) +
        Number(b.ratingCount || 0) * 10;
      return bScore - aScore;
    })[0];
}

function buildFallbackProductPayload() {
  const descriptionText =
    collectDescriptionText() ||
    document.querySelector('meta[name="description"]')?.content ||
    "";
  const licenseText = collectLicenseText();
  const dimensions = extractDimensions(descriptionText);
  const stats = fallbackStatsFromDom();
  const canonicalUrl =
    document.querySelector('meta[property="og:url"]')?.content || window.location.href;
  const domImages = collectDomImages();

  return {
    ok: true,
    product: {
      sourceTitle: textOf(document.querySelector("h1")) || document.title.replace(/\s*-\s*Free.*$/, ""),
      sourceUrl: canonicalUrl,
      creatorName: collectCreatorName(),
      category: collectCategoryText(),
      subcategory: "",
      tags: [],
      summary: document.querySelector('meta[name="description"]')?.content || "",
      description: descriptionText,
      dimensions,
      likeCount: stats.likeCount,
      commentCount: stats.commentCount,
      downloadCount: stats.downloadCount,
      collectionCount: stats.collectionCount,
      coverUrl: document.querySelector('meta[property="og:image"]')?.content || "",
      imageUrls: domImages,
      licenseText,
      licenseStatus: isCommerciallyAllowed(licenseText),
      selectedProfile: {
        id: parseHashInstanceId(),
        title: extractSelectedProfileTitleFromDom(),
        durationSeconds: 0,
        durationHuman: "",
        weightGrams: 0,
        materialColorCount: 0,
        colorHexes: [],
        colorNames: [],
        needsAms: false,
        imageCount: domImages.length
      }
    }
  };
}

function collectImages(design, instance) {
  const urls = [];

  urls.push(design?.coverUrl);
  urls.push(design?.coverLandscape);
  urls.push(design?.coverPortrait);

  for (const picture of instance?.pictures || []) {
    urls.push(picture?.url);
  }

  for (const plate of instance?.extention?.modelInfo?.plates || []) {
    urls.push(plate?.thumbnail?.url);
    urls.push(plate?.top_picture?.url);
    urls.push(plate?.pick_picture?.url);
  }

  return unique(urls);
}

function buildProductPayload() {
  const { design } = getPageData();
  if (!design || isDesignDataStale(design)) {
    return buildFallbackProductPayload();
  }

  const selectedInstanceId = parseHashInstanceId();
  const selectedInstance =
    (design.instances || []).find((instance) => Number(instance.id) === selectedInstanceId) ||
    chooseBestProfile(design.instances || []);

  const descriptionText = collectDescriptionText() || design.summary || "";
  const licenseText = collectLicenseText();
  const dimensions = extractDimensions(descriptionText);
  const imageUrls = collectImages(design, selectedInstance);
  const filaments =
    selectedInstance?.extention?.modelInfo?.plates?.flatMap((plate) => plate.filaments || []) ||
    selectedInstance?.instanceFilaments ||
    [];
  const colorHexes = unique(filaments.map((item) => item?.color));

  return {
    ok: true,
    product: {
      sourceTitle: design.title || textOf(document.querySelector("h1")),
      sourceUrl: window.location.href,
      creatorName: design.designCreator?.name || "",
      category:
        design.categories?.[0]?.name ||
        Array.from(document.querySelectorAll('a[href*="/3d-models/"]'))
          .map((node) => textOf(node))
          .filter(Boolean)
          .join(" > "),
      subcategory: design.categories?.[1]?.name || "",
      tags: unique((design.tags || []).map((tag) => String(tag).trim())).slice(0, 20),
      summary: design.summary || "",
      description: descriptionText,
      dimensions,
      likeCount: Number(design.likeCount || 0),
      commentCount: Number(design.commentCount || 0),
      downloadCount: Number(design.downloadCount || 0),
      collectionCount: Number(design.collectionCount || 0),
      coverUrl: design.coverUrl || "",
      imageUrls,
      licenseText,
      licenseStatus: isCommerciallyAllowed(licenseText),
      selectedProfile: selectedInstance
        ? {
            id: selectedInstance.id,
            title: selectedInstance.title || "",
            durationSeconds: Number(selectedInstance.prediction || 0),
            durationHuman: formatDuration(Number(selectedInstance.prediction || 0)),
            weightGrams: Number(selectedInstance.weight || 0),
            materialColorCount: Number(selectedInstance.materialColorCnt || 0),
            colorHexes,
            colorNames: colorHexes.map(hexToColorName),
            needsAms: Boolean(selectedInstance.needAms),
            imageCount: imageUrls.length
          }
        : null
    }
  };
}

function ensureListingButtonStyles() {
  if (document.getElementById("mw-notion-listing-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "mw-notion-listing-style";
  style.textContent = `
    .mw-notion-action-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .mw-notion-import-button {
      border: 0;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: #ffffff;
      background: #1f7a54;
      box-shadow: 0 4px 10px rgba(31, 122, 84, 0.2);
    }

    .mw-notion-import-button[data-state="loading"] {
      background: #7a5c1f;
    }

    .mw-notion-import-button[data-state="done"] {
      background: #2b5f9e;
    }

    .mw-notion-import-button[data-state="duplicate"] {
      background: #6e6a63;
    }

    .mw-notion-import-button[data-state="error"] {
      background: #8c2f1a;
    }

    .mw-notion-import-hint {
      font-size: 11px;
      color: #5f564d;
    }
  `;
  document.head.appendChild(style);
}

function isCurrentPageModelUrl(url) {
  return normalizeUrlForCompare(url) === normalizeUrlForCompare(window.location.href);
}

function findListingTitleLinks() {
  const links = Array.from(document.querySelectorAll('a[href*="/models/"]'));
  const seen = new Set();

  return links.filter((link) => {
    const href = normalizeUrlForCompare(link.href);
    const title = textOf(link);

    if (!href || !title || isCurrentPageModelUrl(href)) {
      return false;
    }

    if (seen.has(href)) {
      return false;
    }

    if (link.dataset.mwNotionBound === "true") {
      seen.add(href);
      return false;
    }

    seen.add(href);
    return true;
  });
}

function setListingButtonState(button, state, label, hint = "") {
  button.dataset.state = state;
  button.textContent = label;
  const hintEl = button.parentElement?.querySelector(".mw-notion-import-hint");
  if (hintEl) {
    hintEl.textContent = hint;
  }
}

function bindListingImportButton(link) {
  const host = link.parentElement;
  if (!host || host.querySelector(".mw-notion-action-row")) {
    return;
  }

  link.dataset.mwNotionBound = "true";

  const row = document.createElement("div");
  row.className = "mw-notion-action-row";

  const button = document.createElement("button");
  button.className = "mw-notion-import-button";
  button.type = "button";
  button.textContent = "Add to Notion";
  button.dataset.state = "idle";

  const hint = document.createElement("span");
  hint.className = "mw-notion-import-hint";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const productUrl = normalizeUrlForCompare(link.href);
    setListingButtonState(button, "loading", "Importing...", "");
    button.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "IMPORT_FROM_URL",
        payload: {
          url: productUrl
        }
      });

      if (response?.ok) {
        setListingButtonState(button, "done", "Imported", response.productTitle || "");
        return;
      }

      if (response?.duplicate) {
        setListingButtonState(button, "duplicate", "Already exists", "");
        return;
      }

      setListingButtonState(button, "error", "Retry import", response?.error || "Import failed");
      button.disabled = false;
    } catch (_error) {
      setListingButtonState(button, "error", "Retry import", "Could not reach the importer");
      button.disabled = false;
    }
  });

  row.appendChild(button);
  row.appendChild(hint);
  host.appendChild(row);
}

function enhanceListingCards() {
  ensureListingButtonStyles();
  for (const link of findListingTitleLinks()) {
    bindListingImportButton(link);
  }
}

let listingEnhancerStarted = false;

function startListingEnhancer() {
  if (listingEnhancerStarted) {
    return;
  }

  listingEnhancerStarted = true;
  enhanceListingCards();

  const observer = new MutationObserver(() => {
    enhanceListingCards();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXTRACT_PRODUCT") {
    sendResponse(buildProductPayload());
    return true;
  }

  return false;
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startListingEnhancer, { once: true });
} else {
  startListingEnhancer();
}
