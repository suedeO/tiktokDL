// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.1.1
// @updatedAt 2026-05-18T09:08:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description TikTok downloader: fetch-html first, then WebView fallback (no external API)
// ==/Yasba==

module.exports = async function (inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    throw new Error("Invalid input URL")
  }

  const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const cleanUrl = (u) =>
    String(u || "")
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .trim()

  function parseJsonFromHtml(html, id) {
    const re = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, "i")
    const m = html.match(re)
    if (!m || !m[1]) return null
    try { return JSON.parse(m[1]) } catch { return null }
  }

  // 1) Resolve short URL
  const resolvedResp = await fetch(inputUrl, {
    method: "GET",
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    timeout: 30,
  })
  const resolvedUrl = resolvedResp?.url || inputUrl

  // 2) Fetch HTML and parse candidate video URLs
  const candidateSet = new Set()

  const pageResp = await fetch(resolvedUrl, {
    method: "GET",
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    timeout: 45,
  })
  if (pageResp.ok) {
    const html = await pageResp.text()

    const uni = parseJsonFromHtml(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__")
    if (uni) {
      const v = uni?.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct?.video
      if (v?.playAddr) candidateSet.add(cleanUrl(v.playAddr))
      if (v?.downloadAddr) candidateSet.add(cleanUrl(v.downloadAddr))
      if (v?.playAddrH264) candidateSet.add(cleanUrl(v.playAddrH264))
    }

    const sigi = parseJsonFromHtml(html, "SIGI_STATE")
    if (sigi?.ItemModule && typeof sigi.ItemModule === "object") {
      const firstKey = Object.keys(sigi.ItemModule)[0]
      const item = sigi.ItemModule[firstKey]
      const v = item?.video
      if (v?.playAddr) candidateSet.add(cleanUrl(v.playAddr))
      if (v?.downloadAddr) candidateSet.add(cleanUrl(v.downloadAddr))
      if (v?.playAddrH264) candidateSet.add(cleanUrl(v.playAddrH264))
    }
  }

  // 3) WebView fallback capture (if still none)
  if (!candidateSet.size) {
    let webView = null
    try {
      webView = new WebViewController({ ephemeral: false })
      const seen = []

      webView.shouldAllowRequest = async (req) => {
        const u = String(req.url || "")
        if (/video\/tos/i.test(u) || /mime_type=video_mp4/i.test(u) || /\.mp4(\?|$)/i.test(u)) {
          seen.push(u)
        }
        return true
      }

      try { webView.setCustomUserAgent(UA) } catch {}
      await webView.loadURL(resolvedUrl)
      await webView.waitForLoad()
      await sleep(2500)

      // Try extracting from runtime DOM too
      const runtimeUrls = await webView.evaluateJavaScript(`
        (function () {
          const arr = []
          const v = document.querySelector("video")
          if (v?.src) arr.push(v.src)
          const resources = performance.getEntriesByType("resource") || []
          for (const r of resources) {
            if (r && r.name && /video\\/tos|mime_type=video_mp4|\\.mp4(\\?|$)/i.test(r.name)) {
              arr.push(r.name)
            }
          }
          return arr
        })()
      `)

      for (const u of runtimeUrls || []) candidateSet.add(cleanUrl(u))
      for (const u of seen) candidateSet.add(cleanUrl(u))
    } catch {
      // ignore fallback errors
    } finally {
      try { webView?.dispose() } catch {}
    }
  }

  const candidates = [...candidateSet].filter(Boolean)
  if (!candidates.length) {
    throw new Error("Could not extract any TikTok video URL candidate")
  }

  // 4) Download attempts
  let lastErr = "Unknown"

  const headerProfiles = [
    { "user-agent": UA, referer: "https://www.tiktok.com/" },
    { "user-agent": UA, referer: resolvedUrl },
    { "user-agent": UA, referer: "https://www.tiktok.com/", origin: "https://www.tiktok.com" },
  ]

  for (const videoUrl of candidates) {
    for (const headers of headerProfiles) {
      try {
        const r = await fetch(videoUrl, { method: "GET", headers, timeout: 60 })
        if (!r.ok) {
          lastErr = `HTTP ${r.status}`
          continue
        }

        const bytes = new Uint8Array(await r.arrayBuffer())
        if (!bytes.length) {
          lastErr = "Empty response body"
          continue
        }

        const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
        await FileManager.createDirectory(outDir, true)

        const outPath = `${outDir}/tiktok_${Date.now()}.mp4`
        await FileManager.writeAsBytes(outPath, bytes)
        return outPath
      } catch (e) {
        lastErr = String(e)
      }
    }
  }

  throw new Error(`All download attempts failed: ${lastErr}`)
}
