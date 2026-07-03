# Malayalam Voice Assistant Demo

API-backed demo for a Malayalam call automation proposal. The browser records the caller's voice, the local backend sends it to Sarvam AI, and the app plays spoken Malayalam back.

## Provider

This version uses Sarvam AI because its docs show support for:

- Speech to text with Malayalam language code `ml-IN`
- Chat completion through Sarvam chat models
- Text to speech with Bulbul voices

Use a Sarvam free-trial/free-credit API key from the Sarvam dashboard.

## Setup

Create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and add:

```text
SARVAM_API_KEY=your_sarvam_api_key_here
```

Dependencies are project-local:

- Packages: `node_modules/`
- npm cache: `.npm-cache/`
- No global npm packages required

## Run

Open terminal 1 for the backend:

```powershell
cd E:\AI\chat_demo
npm.cmd run server
```

Open terminal 2 for the frontend:

```powershell
cd E:\AI\chat_demo
npm.cmd run start -- --port 5173
```

Open the URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

If port `5173` is busy, Vite may print `http://127.0.0.1:5174/`.

## Ngrok Demo

For ngrok, build once and expose only the backend port. The backend serves both the app and API.

First-time ngrok setup:

```powershell
cd E:\AI\chat_demo
npm.cmd run ngrok:auth -- YOUR_NGROK_AUTHTOKEN
```

Terminal 1:

```powershell
cd E:\AI\chat_demo
npm.cmd run build
npm.cmd run server
```

Terminal 2:

```powershell
ngrok http 8787
```

Open the `https://...ngrok-free.app` URL shown by ngrok.

## Render Deploy

This repo includes `render.yaml` for Render Blueprint deployment.

Render settings:

```text
Build Command: npm install && npm run build
Start Command: npm run server
```

Environment variable required:

```text
SARVAM_API_KEY=your_sarvam_api_key
```

The backend serves both the built frontend and `/api/*`, so deploy it as one Render Web Service.

## Demo Flow

1. Click `Record Malayalam`.
2. Speak naturally in Malayalam.
3. Click `Stop and send`.
4. The backend transcribes the audio, generates a Malayalam answer, converts it to speech, and the browser plays it.

Example prompts:

- `എന്റെ ബിൽ എത്രയാണ്?`
- `നെറ്റ്‌വർക്ക് രണ്ടു ദിവസമായി ലഭിക്കുന്നില്ല`
- `നാളെ വൈകിട്ട് ഒരു അപ്പോയിന്റ്മെന്റ് വേണം`
- `എനിക്ക് ഓപ്പറേറ്ററോട് സംസാരിക്കണം`

## Build Check

```powershell
npm.cmd run build
```
