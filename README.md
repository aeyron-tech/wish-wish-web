# Wish Wish web (test UI)

Grocery compare desk for Wish Wish. Talks to the deployed AWS API:

`https://ai-6324514494074177b48dc4858456a287.ecs.us-east-1.on.aws`

`POST /v2/chat` (live shop search / cart JSON). The browser hits this app’s `/api/agent`, which proxies that call so CORS is not required on the API.

## Local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

## Env

| Name | Default |
|---|---|
| `WISHWISH_API_URL` | AWS ECS URL above |
| `WISHWISH_TOKEN` | `test` (v2 falls back if storefront session create fails) |
