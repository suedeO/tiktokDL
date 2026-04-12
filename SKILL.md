---
name: tiktok-to-photos
version: 1.0.0
description: Download a TikTok video with yt-dlp using the fixed command pattern and then save the downloaded video to the Photos app. Use this skill when the user provides a TikTok URL and wants the video downloaded without checking or installing yt-dlp.
---

# TikTok to Photos

Use this skill when the user wants a TikTok video downloaded and saved to the Photos app.

## Rules

- Do not check, install, upgrade, or troubleshoot `yt-dlp`.
- Assume `yt-dlp` is already installed.
- Start with the download step immediately.

## Workflow

1. Take the TikTok URL from the user.
2. Run `scripts/downloadTiktokVideo.sh` with the TikTok URL.
3. Let the script save the file to `/var/minis/attachments/` using the TikTok video ID as the filename.
4. After the download completes, save the downloaded video to the Photos app.
5. Confirm completion.

## Command format

The download must use this exact pattern:

```bash
yt-dlp --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -o "/var/minis/attachments/%(id)s.%(ext)s" "<TIKTOK_URL>"
```

## Avoid

- Running `which yt-dlp`, `command -v yt-dlp`, or `yt-dlp --version`.
- Changing the output directory.
- Using another downloader unless the user explicitly asks.
