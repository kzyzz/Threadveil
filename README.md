# Threadveil

Threadveil is a small Chrome extension for making X/Twitter threads quieter.

It hides noisy replies with local rules, keyword filters, and lightweight scoring, so a thread feels easier to read.

## Install

This extension is meant to be loaded manually.

1. Download or clone this repository.
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the project folder.
6. Refresh X/Twitter.

## What It Does

- Hides likely spam replies on tweet detail pages.
- Lets you add custom keywords and regex rules.
- Lets you tune rule weights and the blocking threshold.
- Provides a debug mode when you want to inspect scoring.
- Keeps settings in your browser with Chrome extension storage.

## Privacy

Threadveil runs locally in your browser. It does not upload your rules, browsing data, or thread content to a server.

## Development

Quick syntax checks:

```bash
node --check content.js
node --check media-sniffer.js
node --check background.js
```

## License

MIT
