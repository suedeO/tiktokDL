// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.1.4
// @updatedAt 2026-05-18T09:21:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description TikTok downloader via WebView in-page fetch + debug log
// ==/Yasba==

module.exports = async function (inputUrl) {
  const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  const logLines = []
  const log = (m) => logLines.push(`[${new Date().toISOString()}] ${m}`)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function flush(tag) {
    const dir = FileManager.documentsDirectory + "/Yasba-Downloads"
    await FileManager.createDirectory(dir, true)
    const p = `${dir}/tiktok_debug_${Date.now()}_${tag}.log`
    await FileManager.writeAsString(p, logLines.join("\n"))
    return p
  }

  function cleanUrl(u) {
    return String(u || "").replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&").trim()
  }

  let webView = null
  try {
    webView = new WebViewController({ ephemeral: false })
    try { webView.setCustomUserAgent(UA) } catch {}

    log(`loadURL: ${inputUrl}`)
    const ok = await webView.loadURL(inputUrl)
    if (!ok) throw new Error("WebView load failed")
    await webView.waitForLoad()
    await sleep(2500)

    // Extract candidate URL from page state in page context
    const extracted = await webView.evaluateJavaScript(`
      (function () {
        function parseTag(id) {
          const el = document.querySelector('script#' + id);
          if (!el || !el.textContent) return null;
          try { return JSON.parse(el.textContent); } catch { return null; }
        }

        const urls = [];
        const v = document.querySelector('video');
        if (v?.src) urls.push(v.src);

        const uni = parseTag('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        const uv = uni?.__DEFAULT_SCOPE__?.['webapp.reflow.video.detail']?.itemInfo?.itemStruct?.video;
        if (uv?.playAddr) urls.push(uv.playAddr);
        if (uv?.downloadAddr) urls.push(uv.downloadAddr);

        const sigi = parseTag('SIGI_STATE');
        if (sigi?.ItemModule && typeof sigi.ItemModule === 'object') {
          const k = Object.keys(sigi.ItemModule)[0];
          const sv = sigi.ItemModule[k]?.video;
          if (sv?.playAddr) urls.push(sv.playAddr);
          if (sv?.downloadAddr) urls.push(sv.downloadAddr);
        }

        return { pageUrl: location.href, urls };
      })()
    `)

    const urls = [...new Set((extracted?.urls || []).map(cleanUrl).filter(Boolean))]
    log(`candidate count: ${urls.length}`)
    if (!urls.length) {
      const lp = await flush("no_candidates")
      throw new Error(`No candidate video URL (log: ${lp})`)
    }

    // Try in-page fetch (same webview session)
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i]
      log(`try in-page fetch #${i + 1}: ${u.slice(0, 150)}`)

      const result = await webView.evaluateJavaScript(`
        (async function () {
          const url = ${JSON.stringify(u)};
          try {
            const r = await fetch(url, { method: "GET" });
            if (!r.ok) return { ok: false, status: r.status, reason: "http" };
            const ab = await r.arrayBuffer();
            const bytes = new Uint8Array(ab);

            // Uint8Array -> base64
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
              const sub = bytes.subarray(i, i + chunk);
              binary += String.fromCharCode.apply(null, sub);
            }
            const b64 = btoa(binary);
            return { ok: true, b64, size: bytes.length };
          } catch (e) {
            return { ok: false, reason: String(e) };
          }
        })()
      `)

      if (!result?.ok || !result?.b64) {
        log(`fail #${i + 1}: ${JSON.stringify(result)}`)
        continue
      }

      log(`success #${i + 1}, bytes=${result.size}`)

      // base64 -> bytes
      const b64 = result.b64
      const raw = atob(b64)
      const out = new Uint8Array(raw.length)
      for (let j = 0; j < raw.length; j++) out[j] = raw.charCodeAt(j)

      const dir = FileManager.documentsDirectory + "/Yasba-Downloads"
      await FileManager.createDirectory(dir, true)
      const outPath = `${dir}/tiktok_${Date.now()}.mp4`
      await FileManager.writeAsBytes(outPath, out)

      await flush("success")
      return outPath
    }

    const lp = await flush("failed")
    throw new Error(`All in-page fetch attempts failed (log: ${lp})`)
  } finally {
    try { webView?.dispose() } catch {}
  }
}
