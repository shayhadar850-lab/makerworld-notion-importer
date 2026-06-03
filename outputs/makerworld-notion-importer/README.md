# MakerWorld to Notion Importer

Chrome extension for importing MakerWorld product pages and listing cards into a Notion database.

## What it does

- Reads the current MakerWorld model page.
- Adds an `Add to Notion` button on MakerWorld listing cards.
- Extracts title, engagement, description, tags, images, profile time, weight, and color count.
- Chooses a single-color profile under 8 hours when one exists.
- Sends the product into your Notion database with automatic field mapping.
- Lets you decide whether commercial-license restrictions should block the import or just be shown.
- Lets you decide whether products over 8 hours print time should be blocked.

## Setup

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   `outputs/makerworld-notion-importer`

## Extension settings

Open the extension settings page and fill:

- `Notion API Token`
- `Notion Database ID`
- Optional default for license enforcement
- Optional default for blocking products over 8 hours print time

This repo intentionally ships with empty defaults for Notion credentials.
Fill them locally after loading the extension in Chrome.

## Supported Notion fields

The importer maps automatically when these fields exist:

- Title: `Name`, `Model Name`, or any title property
- Description: `Description`, `תיאור המוצר`
- Images/files: `Images`, `Original Images`, `Marketing Assets`
- URL: `Source Link`
- Numbers: `Likes`, `Price`, `Min Price`
- Select: `Category`
- Multi-select: `Tags`
- Status: `Workflow Stage`
- Date: `Ingested At`
- Rich text logs: `Automation Logs`, `Last Agent`

## Notes

- Images are imported as external Notion files.
- Price and minimum price are estimated from engagement, weight, print time, and category.
- License handling is optional and controlled by the toggle in the popup or options page.
- The repo does not include any live API keys or database IDs.
