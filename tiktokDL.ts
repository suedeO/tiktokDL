// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.1.2
// @updatedAt 2026-05-18T09:10:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description TikTok downloader with WebView request replay + debug log (no external API)
// ==/Yasba==

module.exports = async function (inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    throw new Error("Invalid input URL")
  }

  const UA_MOBILE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const now = () => new Date().toISOString()

  function cleanUrl(u) {
    return String(u || "")
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .trim()
  }

  function parseJsonFromHtml(html, id) {
    const re = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, "i")
    const m = html.match(re)
    if (!m || !m[1]) return null
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  }

  const logLines = []
  const log = (msg) => logLines.push(`[${now()}] ${msg}`)

  async function flushLog(tag) {
    try {
      const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
      await FileManager.createDirectory(outDir, true)
      const path = `${outDir}/tiktok_debug_${Date.now()}_${tag}.log`
      await FileManager.writeAsString(path, logLines.join("\n"))
      return path
    } catch {
      return null
    }
  }

  function pickHeaders(srcHeaders, allowKeys) {
    const out = {}
    if (!srcHeaders) return out

    // normalize keys to lowercase lookup
    const map = {}
    for (const k of Object.keys(srcHeaders)) {
      map[String(k).toLowerCase()] = srcHeaders[k]
    }

    for (const k of allowKeys) {
      const v = map[k]
      if (typeof v === "string" && v.trim()) out[k] = v
    }
    return out
  }

  function cookiesToHeader(cookies) {
    return (cookies || [])
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  }

  // ---------- Step 1: resolve URL + fetch HTML parse ----------
  log(`Input URL: ${inputUrl}`)

  const resolvedResp = await fetch(inputUrl, {
    method: "GET",
    headers: { "user-agent": UA_MOBILE, "accept-language": "en-US,en;q=0.9" },
    timeout: 30,
  })
  const resolvedUrl = resolvedResp?.url || inputUrl
  log(`Resolved URL: ${resolvedUrl}`)

  const candidates = new Set()

  try {
    const pageResp = await fetch(resolvedUrl, {
      method: "GET",
      headers: { "user-agent": UA_MOBILE, "accept-language": "en-US,en;q=0.9" },
      timeout: 45,
    })
    log(`Page fetch status: ${pageResp.status}`)

    if (pageResp.ok) {
      const html = await pageResp.text()

      const uni = parseJsonFromHtml(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__")
      if (uni) {
        const v = uni?.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct?.video
        if (v?.playAddr) candidates.add(cleanUrl(v.playAddr))
        if (v?.downloadAddr) candidates.add(cleanUrl(v.downloadAddr))
        if (v?.playAddrH264) candidates.add(cleanUrl(v.playAddrH264))
        log(
          `UNIVERSAL parse: play=${!!v?.playAddr}, download=${!!v?.downloadAddr}, h264=${!!v?.playAddrH264}`
        )
      } else {
        log("UNIVERSAL parse: not found")
      }

      const sigi = parseJsonFromHtml(html, "SIGI_STATE")
      if (sigi?.ItemModule && typeof sigi.ItemModule === "object") {
        const firstKey = Object.keys(sigi.ItemModule)[0]
        const item = sigi.ItemModule[firstKey]
        const v = item?.video
        if (v?.playAddr) candidates.add(cleanUrl(v.playAddr))
        if (v?.downloadAddr) candidates.add(cleanUrl(v.downloadAddr))
        if (v?.playAddrH264) candidates.add(cleanUrl(v.playAddrH264))
        log(
          `SIGI parse: play=${!!v?.playAddr}, download=${!!v?.downloadAddr}, h264=${!!v?.playAddrH264}`
        )
      } else {
        log("SIGI parse: not found")
      }
    }
  } catch (e) {
    log(`Page parse error: ${String(e)}`)
  }

  // ---------- Step 2: WebView capture actual media requests ----------
  let webView = null
  let capturedMedia = []
  let pageUrlFromWebView = resolvedUrl

  try {
    webView = new WebViewController({ ephemeral: false })
    try { webView.setCustomUserAgent(UA_MOBILE) } catch {}

    webView.shouldAllowRequest = async (req) => {
      const u = String(req.url || "")
      if (/video\/tos/i.test(u) || /mime_type=video_mp4/i.test(u) || /\.mp4(\?|$)/i.test(u)) {
        capturedMedia.push({
          url: u,
          headers: req.headers || {},
          method: req.method || "GET",
        })
      }
      return true
    }

    const loaded = await webView.loadURL(resolvedUrl)
    log(`WebView loadURL: ${loaded}`)

    if (loaded) {
      await webView.waitForLoad()
      await sleep(3000)

      try {
        pageUrlFromWebView = await webView.evaluateJavaScript("return location.href")
      } catch {}

      // poke video element to force request
      try {
        await webView.evaluateJavaScript(`
          (function () {
            const v = document.querySelector('video');
            if (v) {
              try { v.muted = true; } catch {}
              try { v.play(); } catch {}
            }
            return !!v;
          })()
        `)
      } catch {}

      await sleep(2500)

      // runtime resource fallback
      try {
        const runtimeUrls = await webView.evaluateJavaScript(`
          (function () {
            const arr = [];
            const v = document.querySelector('video');
            if (v?.src) arr.push(v.src);
            const entries = performance.getEntriesByType('resource') || [];
            for (const e of entries) {
              if (e && e.name && /video\\/tos|mime_type=video_mp4|\\.mp4(\\?|$)/i.test(e.name)) {
                arr.push(e.name);
              }
            }
            return arr;
          })()
        `)
        for (const u of runtimeUrls || []) candidates.add(cleanUrl(u))
      } catch (e) {
        log(`Runtime resource parse error: ${String(e)}`)
      }

      for (const x of capturedMedia) candidates.add(cleanUrl(x.url))
      log(`Captured media requests: ${capturedMedia.length}`)
    }
  } catch (e) {
    log(`WebView capture error: ${String(e)}`)
  }

  const candidateList = [...candidates].filter(Boolean)
  log(`Candidate count: ${candidateList.length}`)
  candidateList.slice(0, 5).forEach((u, i) => log(`Candidate[${i}]: ${u.slice(0, 220)}`))

  if (!candidateList.length) {
    const p = await flushLog("no_candidates")
    throw new Error(`Could not extract any TikTok video URL candidate${p ? ` (log: ${p})` : ""}`)
  }

  // ---------- Step 3: Build cookie headers ----------
  let cookieHeaderPage = ""
  let cookieHeaderVideo = ""

  try {
    if (webView) {
      const c1 = await webView.getCookies(pageUrlFromWebView || resolvedUrl)
      cookieHeaderPage = cookiesToHeader(c1)
      log(`Page cookies: ${c1?.length || 0}`)
    }
  } catch (e) {
    log(`getCookies(page) error: ${String(e)}`)
  }

  // ---------- Step 4: replay attempts ----------
  let lastErr = "Unknown"
  let attemptNo = 0

  for (const videoUrl of candidateList) {
    // try per-video cookies too
    try {
      if (webView) {
        const c2 = await webView.getCookies(videoUrl)
        cookieHeaderVideo = cookiesToHeader(c2)
        log(`Video cookies for host ${videoUrl.split("/")[2]}: ${c2?.length || 0}`)
      }
    } catch (e) {
      log(`getCookies(video) error: ${String(e)}`)
    }

    const capturedForThis = capturedMedia.find((x) => cleanUrl(x.url) === cleanUrl(videoUrl))
    const replayBaseHeaders = capturedForThis
      ? pickHeaders(capturedForThis.headers, [
          "accept",
          "accept-encoding",
          "accept-language",
          "range",
          "sec-fetch-dest",
          "sec-fetch-mode",
          "sec-fetch-site",
        ])
      : {}

    const profiles = [
      {
        ...replayBaseHeaders,
        "user-agent": UA_MOBILE,
        referer: "https://www.tiktok.com/",
        ...(cookieHeaderVideo ? { cookie: cookieHeaderVideo } : {}),
      },
      {
        ...replayBaseHeaders,
        "user-agent": UA_MOBILE,
        referer: pageUrlFromWebView || resolvedUrl,
        ...(cookieHeaderVideo ? { cookie: cookieHeaderVideo } : {}),
      },
      {
        ...replayBaseHeaders,
        "user-agent": UA_MOBILE,
        referer: "https://www.tiktok.com/",
        ...(cookieHeaderPage ? { cookie: cookieHeaderPage } : {}),
      },
      {
        ...replayBaseHeaders,
        "user-agent": UA_MOBILE,
        referer: pageUrlFromWebView || resolvedUrl,
        origin: "https://www.tiktok.com",
        ...(cookieHeaderVideo || cookieHeaderPage
          ? { cookie: cookieHeaderVideo || cookieHeaderPage }
          : {}),
      },
    ]

    for (let i = 0; i < profiles.length; i++) {
      attemptNo++
      const headers = profiles[i]
      try {
        const resp = await fetch(videoUrl, {
          method: "GET",
          headers,
          timeout: 60,
        })

        log(`Attempt#${attemptNo} profile=${i + 1} status=${resp.status}`)

        if (!resp.ok) {
          lastErr = `HTTP ${resp.status}`
          continue
        }

        const bytes = new Uint8Array(await resp.arrayBuffer())
        log(`Attempt#${attemptNo} bytes=${bytes.length}`)

        if (!bytes.length) {
          lastErr = "Empty response body"
          continue
        }

        const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
        await FileManager.createDirectory(outDir, true)

        const outPath = `${outDir}/tiktok_${Date.now()}.mp4`
        await FileManager.writeAsBytes(outPath, bytes)

        const logPath = await flushLog("success")
        // You can inspect logPath later from Files app if needed.
        return outPath
      } catch (e) {
        lastErr = String(e)
        log(`Attempt#${attemptNo} error=${lastErr}`)
      }
    }
  }

  const logPath = await flushLog("failed")
  try { webView?.dispose() } catch {}
  throw new Error(`All download attempts failed: ${lastErr}${logPath ? ` (log: ${logPath})` : ""}`)
}
