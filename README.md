# Luminary — AI Photo Editor

A modern AI-powered photo editor built with React + Vite.

## Features
- Brightness, contrast, saturation, blur, rotate controls
- Filters: grayscale, sepia, vintage, cinematic
- AI prompt box: type "make it brighter", "add sepia", "rotate 90"
- Undo / Redo
- Export edited image (pixel-accurate, full resolution)

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Import the repo on vercel.com
3. Vercel auto-detects Vite — just click Deploy

Build settings (auto-detected, no changes needed):
- Build command: `npm run build`
- Output directory: `dist`
