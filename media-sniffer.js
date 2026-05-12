(function () {
  'use strict';

  const SOURCE = 'BB_MEDIA_SNIFFER';
  const originalFetch = window.fetch;
  const OriginalXHR = window.XMLHttpRequest;

  function isTweetApi(url) {
    return typeof url === 'string' && url.includes('/graphql/');
  }

  function postItems(items) {
    if (!items.length) return;
    window.postMessage({ source: SOURCE, items }, '*');
  }

  function collectTweetMedia(data) {
    const out = [];
    const seen = new Set();
    walk(data);
    return out;

    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      const legacy = node.legacy;
      const tweetId = node.rest_id || (legacy && legacy.id_str);
      if (tweetId && legacy) {
        const media = extractBestVariant(legacy);
        const key = media ? tweetId + '|' + media.url : '';
        if (media && !seen.has(key)) {
          seen.add(key);
          out.push({ tweetId, url: media.url, ext: media.ext, mediaId: media.mediaId });
        }
      }

      Object.keys(node).forEach(key => walk(node[key]));
    }
  }

  function extractBestVariant(legacy) {
    const mediaList = []
      .concat((legacy.extended_entities && legacy.extended_entities.media) || [])
      .concat((legacy.entities && legacy.entities.media) || []);

    for (const media of mediaList) {
      const variants = media.video_info && Array.isArray(media.video_info.variants)
        ? media.video_info.variants
        : [];
      const mp4s = variants
        .filter(v => v && v.url && (!v.content_type || v.content_type === 'video/mp4'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (mp4s.length > 0) return { url: mp4s[0].url, ext: 'mp4', mediaId: extractTwitterMediaId(mp4s[0].url) };

      const hls = variants.find(v => v && v.url && /\.m3u8(\?|$)/i.test(v.url));
      if (hls) return { url: hls.url, ext: 'm3u8', mediaId: extractTwitterMediaId(hls.url) };
    }

    return null;
  }

  function extractTwitterMediaId(url) {
    const m = (url || '').match(/\/(?:amplify_video|amplify_video_thumb|ext_tw_video|ext_tw_video_thumb)\/(\d+)\//);
    return m ? m[1] : '';
  }

  function inspectText(text) {
    if (!text || text.length < 100) return;
    try {
      postItems(collectTweetMedia(JSON.parse(text)));
    } catch (e) {
      // Not JSON.
    }
  }

  if (typeof originalFetch === 'function') {
    window.fetch = async function (input, init) {
      const response = await originalFetch.apply(this, arguments);
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isTweetApi(url)) {
        response.clone().text().then(inspectText).catch(() => {});
      }
      return response;
    };
  }

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    let url = '';
    const open = xhr.open;

    xhr.open = function (method, requestUrl) {
      url = typeof requestUrl === 'string' ? requestUrl : (requestUrl ? requestUrl.toString() : '');
      return open.apply(this, arguments);
    };

    xhr.addEventListener('load', function () {
      if (!isTweetApi(url)) return;
      try {
        if (typeof xhr.responseText === 'string') inspectText(xhr.responseText);
      } catch (e) {
        // responseText is unavailable for some responseTypes.
      }
    });

    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;
})();
