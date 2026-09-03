# Wish Wish web (test UI)

Grocery compare desk. This app is **not** in the AI backend repo. It proxies to the AWS API:

`https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws`

The browser calls `/api/agent` on this Next app. That route `POST`s `/v2/chat` on AWS, so CORS on the backend is not required.

## Local

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Vercel

Set `WISHWISH_API_URL` (optional; defaults to the AWS URL above) and `WISHWISH_TOKEN` (optional; defaults to `test`).
