chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'BB_DOWNLOAD_MEDIA') return false;

  chrome.downloads.download({
    url: message.url,
    filename: message.filename || 'x-video.mp4',
    saveAs: false,
  }, (downloadId) => {
    const err = chrome.runtime.lastError;
    if (err) {
      sendResponse({ ok: false, error: err.message });
      return;
    }
    sendResponse({ ok: true, downloadId });
  });

  return true;
});
