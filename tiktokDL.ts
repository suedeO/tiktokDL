// ==Yasba==
// @siteId tiktok
// @siteName TikTok
// @version 1.0.1
// @updatedAt 2026-05-18T08:29:00Z
// @matchHosts tiktok.com,www.tiktok.com,m.tiktok.com,vt.tiktok.com
// @description Native-first TikTok downloader (no external API)
// ==/Yasba==

module.exports = async function (inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    throw new Error("Invalid input URL")
  }

  const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  // 1) Resolve short links (e.g. tiktok.com/t/... or vt.tiktok.com/...)
  const resolvedResp = await fetch(inputUrl, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": UA },
  })
  const resolvedUrl = resolvedResp?.url || inputUrl

  // 2) Load TikTok page HTML
  const pageResp = await fetch(resolvedUrl, {
    method: "GET",
    headers: {
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
    },
  })
  if (!pageResp.ok) {
    throw new Error(`Failed to load TikTok page: HTTP ${pageResp.status}`)
  }

  const html = await pageResp.text()

  function parseJsonFromScriptTag(id) {
    const re = new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, "i")
    const m = html.match(re)
    if (!m || !m[1]) return null
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  }

  // 3) Prefer UNIVERSAL_DATA (observed on current TikTok web)
  let playAddr = null

  const universal = parseJsonFromScriptTag("__UNIVERSAL_DATA_FOR_REHYDRATION__")
  if (universal) {
    const itemStruct =
      universal?.__DEFAULT_SCOPE__?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct

    playAddr =
      itemStruct?.video?.playAddr ||
      itemStruct?.video?.downloadAddr ||
      itemStruct?.video?.playAddrH264 ||
      null
  }

  // 4) Fallback to SIGI_STATE (older/alternate page structure)
  if (!playAddr) {
    const sigi = parseJsonFromScriptTag("SIGI_STATE")
    if (sigi?.ItemModule && typeof sigi.ItemModule === "object") {
      const firstKey = Object.keys(sigi.ItemModule)[0]
      const item = sigi.ItemModule[firstKey]
      playAddr =
        item?.video?.playAddr ||
        item?.video?.downloadAddr ||
        item?.video?.playAddrH264 ||
        null
    }
  }

  if (!playAddr || typeof playAddr !== "string") {
    throw new Error("Could not extract TikTok playable URL from page JSON")
  }

  // Unescape common escaped formats
  const videoUrl = playAddr
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")

  // 5) Download video bytes
  const videoResp = await fetch(videoUrl, {
    method: "GET",
    headers: {
      "user-agent": UA,
      referer: "https://www.tiktok.com/",
    },
  })
  if (!videoResp.ok) {
    throw new Error(`Video download failed: HTTP ${videoResp.status}`)
  }

  const bytes = new Uint8Array(await videoResp.arrayBuffer())

  // 6) Save file locally
  const outDir = FileManager.documentsDirectory + "/Yasba-Downloads"
  await FileManager.createDirectory(outDir, true)

  const outPath = outDir + `/tiktok_${Date.now()}.mp4`
  await FileManager.writeAsBytes(outPath, bytes)

  // 7) Return absolute file path for Yasba intent result
  return outPath
}
