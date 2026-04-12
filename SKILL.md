---
name: tiktok-to-chat-attachment
version: 1.1.0
description: Download a TikTok video with yt-dlp using the fixed command pattern and then attach the downloaded video in chat as the only response. Use this skill when the user provides a TikTok URL and wants the video attached in chat without checking or installing yt-dlp.
---

# TikTok to Chat Attachment

Use this skill when the user wants a TikTok video downloaded and attached directly in chat.

## Rules

- Do not check, install, upgrade, or troubleshoot `yt-dlp`.
- Assume `yt-dlp` is already installed.
- Start with the download step immediately.
- Do not save the video to Photos.
- After downloading, attach the video in chat.
- Do not write any text in the response; return only the attachment.

## Workflow

1. Take the TikTok URL from the user.
2. Run `scripts/downloadTiktokVideo.sh` with the TikTok URL.
3. Let the script save the file to `/var/minis/attachments/` using the TikTok video ID as the filename.
4. Attach the downloaded video file in chat.
5. Do not add confirmation text, explanation, or any extra message.

## Command format

The download must use this exact pattern:

```bash
yt-dlp --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -o "/var/minis/attachments/%(id)s.%(ext)s" "<TIKTOK_URL>"
```

## Avoid

- Running `which yt-dlp`, `command -v yt-dlp`, or `yt-dlp --version`.
- Changing the output directory.
- Saving to Photos.
- Writing any text when returning the final result.
- Using another downloader unless the user explicitly asks.
