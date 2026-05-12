# X Bot Blocker

A lightweight Chrome extension for X/Twitter that helps hide suspicious bot replies and adds a per-video download button to videos on the page.

## Features

- Hide likely spam or bot replies on X/Twitter detail pages.
- Score replies with configurable heuristic rules.
- Add custom keyword and regex blocking rules.
- Debug mode for inspecting tweet scores.
- Add an inline video download icon on each detected video player, including quoted/embedded tweet videos when a direct media URL is available.
- Export and import blocker configuration.

## Install Locally

1. Open `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder.
5. Open or refresh `https://x.com`.

## Permissions

This extension requests:

- `storage`: save rules, keywords, thresholds, and UI settings.
- `downloads`: start browser downloads for detected direct video media URLs.
- `https://x.com/*`, `https://twitter.com/*`, `https://api.x.com/*`: run the blocker and media detection on X/Twitter pages.

The extension runs locally in your browser. It does not upload your rules, browsing data, or downloaded media URLs to a third-party server.

## Video Download Notes

X/Twitter often renders videos as `blob:` streams in the DOM. The extension tries to detect the real media URL from page/API responses and then downloads that URL through Chrome's download API.

If a video only exposes a `blob:` URL, play the video or refresh the page and try again. Some videos may still be unavailable depending on how X/Twitter serves the media.

Please use the download feature only for media you have the right to download and store.

## Development

The extension is Manifest V3 and uses plain JavaScript, HTML, and CSS.

Important files:

- `manifest.json`: extension manifest and permissions.
- `content.js`: tweet scanning, blocking logic, UI injection, and download button handling.
- `media-sniffer.js`: page-context media URL detection.
- `background.js`: download request handling.
- `popup.html` / `popup.js`: settings popup.
- `styles.css`: injected page styles.

Run quick syntax checks:

```bash
node --check content.js
node --check media-sniffer.js
node --check background.js
```

## License

MIT
