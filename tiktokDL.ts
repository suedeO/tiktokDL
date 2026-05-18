// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.1.3
// @updatedAt 2026-05-18T09:16:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description TikTok downloader using GM.xmlHttpRequest + debug log (no external API)
// ==/Yasba==

module.exports = async function (inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") throw new Error("Invalid input URL")

  const { GM } = await import("scripting")

  const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const now = () => new Date().toISOString()
  const logLines = []
  const log = (m) => logLines.push(`[${now()}] ${m}`)

  function cleanUrl(u) {
    return String(u || "").replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&").trim()
  }

  function parseJsonFromHtml(html, id) {
    const re = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, "i")
    const m = html.match(re)
    if (!m || !m[1]) return null
    try { return JSON.parse(m[1]) } catch { return null }
  }

  async function flushLog(tag) {
    const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
    await FileManager.createDirectory(outDir, true)
    const p = `${outDir}/tiktok_debug_${Date.now()}_${tag}.log`
    await FileManager.writeAsString(p, logLines.join("\n"))
    return p
  }

  function cookiesToHeader(cookies) {
    return (cookies || []).map((c) => `${c.name}=${c.value}`).join("; ")
  }

  function gmDownloadArrayBuffer(url, headers) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: "GET",
        url,
        headers,
        timeout: 60_000,
        responseType: "arraybuffer",
        onload: (resp) => {
          const status = resp?.status || 0
          if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}`))
          resolve(resp.response)
        },
        onerror: (e) => reject(new Error(`GM XHR error: ${String(e)}`)),
        ontimeout: () => reject(new Error("GM XHR timeout")),
      })
    })
  }

  log(`Input URL: ${inputUrl}`)

  // Resolve
  const resolvedResp = await fetch(inputUrl, {
    method: "GET",
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    timeout: 30,
  })
  const resolvedUrl = resolvedResp?.url || inputUrl
  log(`Resolved URL: ${resolvedUrl}`)

  const candidates = new Set()

  // Parse HTML first
  try {
    const pageResp = await fetch(resolvedUrl, {
      method: "GET",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      timeout: 45,
    })
    log(`Page fetch status: ${pageResp.status}`)

    if (pageResp.ok) {
      const html = await pageResp.text()
      const uni = parseJsonFromHtml(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__")
      const v1 = uni?.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct?.video
      if (v1?.playAddr) candidates.add(cleanUrl(v1.playAddr))
      if (v1?.downloadAddr) candidates.add(cleanUrl(v1.downloadAddr))
      if (v1?.playAddrH264) candidates.add(cleanUrl(v1.playAddrH264))
    }
  } catch (e) {
    log(`HTML parse error: ${String(e)}`)
  }

  // WebView cookie collection
  let webView = null
  let pageUrl = resolvedUrl
  let pageCookieHeader = ""
  try {
    webView = new WebViewController({ ephemeral: false })
    try { webView.setCustomUserAgent(UA) } catch {}

    await webView.loadURL(resolvedUrl)
    await webView.waitForLoad()
    await sleep(2500)

    try { pageUrl = await webView.evaluateJavaScript("return location.href") } catch {}
    const c = await webView.getCookies(pageUrl || resolvedUrl)
    pageCookieHeader = cookiesToHeader(c)
    log(`Page cookies: ${c?.length || 0}`)

    // runtime video src fallback
    const runtimeSrc = await webView.evaluateJavaScript(`
      (function(){ const v=document.querySelector('video'); return v?.src || ""; })()
    `)
    if (runtimeSrc) candidates.add(cleanUrl(runtimeSrc))
  } catch (e) {
    log(`WebView stage error: ${String(e)}`)
  }

  const candidateList = [...candidates].filter(Boolean)
  log(`Candidate count: ${candidateList.length}`)
  candidateList.forEach((u, i) => log(`Candidate[${i}]: ${u.slice(0, 220)}`))

  if (!candidateList.length) {
    const lp = await flushLog("no_candidates")
    throw new Error(`Could not extract any TikTok video URL candidate (log: ${lp})`)
  }

  // Try GM.xmlHttpRequest download
  let lastErr = "Unknown"
  for (const videoUrl of candidateList) {
    // host-specific cookies
    let videoCookieHeader = ""
    try {
      if (webView) {
        const vc = await webView.getCookies(videoUrl)
        videoCookieHeader = cookiesToHeader(vc)
        log(`Video cookies: ${vc?.length || 0}`)
      }
    } catch {}

    const cookie = videoCookieHeader || pageCookieHeader

    const headerProfiles = [
      { "user-agent": UA, referer: "https://www.tiktok.com/", ...(cookie ? { cookie } : {}) },
      { "user-agent": UA, referer: pageUrl || resolvedUrl, ...(cookie ? { cookie } : {}) },
      { "user-agent": UA, referer: "https://www.tiktok.com/", origin: "https://www.tiktok.com", ...(cookie ? { cookie } : {}) },
    ]

    for (let i = 0; i < headerProfiles.length; i++) {
      try {
        log(`Try GM XHR: candidate=${candidateList.indexOf(videoUrl)+1}, profile=${i+1}`)
        const ab = await gmDownloadArrayBuffer(videoUrl, headerProfiles[i])
        const bytes = new Uint8Array(ab)
        log(`GM XHR bytes: ${bytes.length}`)

        if (!bytes.length) throw new Error("Empty body")

        const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
        await FileManager.createDirectory(outDir, true)
        const outPath = `${outDir}/tiktok_${Date.now()}.mp4`
        await FileManager.writeAsBytes(outPath, bytes)

        const lp = await flushLog("success")
        log(`Saved: ${outPath}; Log: ${lp}`)
        try { webView?.dispose() } catch {}
        return outPath
      } catch (e) {
        lastErr = String(e)
        log(`Try failed: ${lastErr}`)
      }
    }
  }

  const lp = await flushLog("failed")
  try { webView?.dispose() } catch {}
  throw new Error(`All download attempts failed: ${lastErr} (log: ${lp})`)
}
