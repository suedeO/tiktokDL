// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.1.0
// @updatedAt 2026-05-18T09:05:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description TikTok downloader using WebView cookies + native fetch (no external API)
// ==/Yasba==

module.exports = async function (inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    throw new Error("Invalid input URL")
  }

  const UA_MOBILE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  let webView = null
  try {
    webView = new WebViewController({ ephemeral: false })

    // capture possible real media requests from page runtime
    const mediaRequests = []
    webView.shouldAllowRequest = async (req) => {
      const u = String(req.url || "")
      if (
        /video\/tos/i.test(u) ||
        /\.mp4(\?|$)/i.test(u) ||
        /mime_type=video_mp4/i.test(u)
      ) {
        mediaRequests.push({
          url: u,
          headers: req.headers || {},
        })
      }
      return true
    }

    // optional UA tune
    try { webView.setCustomUserAgent(UA_MOBILE) } catch {}

    const loaded = await webView.loadURL(inputUrl)
    if (!loaded) throw new Error("Failed to load TikTok URL in WebView")

    await webView.waitForLoad()
    await sleep(1500)

    const currentUrl = await webView.evaluateJavaScript("return location.href")

    // Extract candidate video URLs from page JSON and <video> element
    const extracted = await webView.evaluateJavaScript(`
      (function () {
        function parseTag(id) {
          const el = document.querySelector('script#' + id)
          if (!el || !el.textContent) return null
          try { return JSON.parse(el.textContent) } catch { return null }
        }

        const urls = []
        const directVideoSrc = document.querySelector('video')?.src
        if (directVideoSrc) urls.push(directVideoSrc)

        const uni = parseTag('__UNIVERSAL_DATA_FOR_REHYDRATION__')
        const uVideo = uni?.__DEFAULT_SCOPE__?.['webapp.reflow.video.detail']?.itemInfo?.itemStruct?.video
        if (uVideo) {
          if (uVideo.playAddr) urls.push(uVideo.playAddr)
          if (uVideo.downloadAddr) urls.push(uVideo.downloadAddr)
          if (uVideo.playAddrH264) urls.push(uVideo.playAddrH264)
        }

        const sigi = parseTag('SIGI_STATE')
        if (sigi?.ItemModule && typeof sigi.ItemModule === 'object') {
          const firstKey = Object.keys(sigi.ItemModule)[0]
          const item = sigi.ItemModule[firstKey]
          const v = item?.video
          if (v) {
            if (v.playAddr) urls.push(v.playAddr)
            if (v.downloadAddr) urls.push(v.downloadAddr)
            if (v.playAddrH264) urls.push(v.playAddrH264)
          }
        }

        return { currentUrl: location.href, urls }
      })()
    `)

    const cleanUrl = (u) =>
      String(u || "")
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&")
        .trim()

    const candidateSet = new Set()

    for (const u of extracted?.urls || []) {
      const cu = cleanUrl(u)
      if (cu) candidateSet.add(cu)
    }

    for (const r of mediaRequests) {
      const cu = cleanUrl(r.url)
      if (cu) candidateSet.add(cu)
    }

    const candidates = [...candidateSet]
    if (!candidates.length) {
      throw new Error("Could not extract any TikTok video URL candidate")
    }

    // Build cookie header from WebView store
    const pageCookies = await webView.getCookies(String(currentUrl || inputUrl))
    const cookieHeader = (pageCookies || [])
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")

    const baseReferer = String(currentUrl || inputUrl)

    // Try all candidates with progressively stronger headers
    let lastErr = "Unknown"
    for (const videoUrl of candidates) {
      const profiles = [
        {
          "user-agent": UA_MOBILE,
          referer: "https://www.tiktok.com/",
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        {
          "user-agent": UA_MOBILE,
          referer: baseReferer,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
      ]

      for (const headers of profiles) {
        try {
          const resp = await fetch(videoUrl, { method: "GET", headers, timeout: 60 })
          if (!resp.ok) {
            lastErr = `HTTP ${resp.status}`
            continue
          }

          const bytes = new Uint8Array(await resp.arrayBuffer())
          if (!bytes.length) {
            lastErr = "Empty file bytes"
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

    throw new Error(`All candidates failed: ${lastErr}`)
  } finally {
    try { webView?.dispose() } catch {}
  }
}
