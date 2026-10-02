# Picture making: Demo and Live

Demo remains the default and needs only `npm run dev`. It previews an idea and sends no image-generation requests.

## Local Live setup

Use Node.js 22.9+ (Node.js 24 recommended).

1. Copy `.env.example` to `.env.local`, and `.env.server.example` to `.env.server.local`.
2. In `.env.local`, set:

```dotenv
VITE_IMAGE_MODE=live
VITE_IMAGE_ENDPOINT=/api/generate-image
```

3. Configure `.env.server.local` using YOUR Portkey workspace:
   - `IMAGE_MODEL`: the exact model name accepted by your route.
   - `IMAGE_OPERATION=edits`: multipart `/images/edits`, or `chat`: `/chat/completions` with image output.
   - `PORTKEY_CONFIG_ID` OR `PORTKEY_VIRTUAL_KEY`: the configured route/provider connection.
   - `PORTKEY_API_KEY`: server-only secret. Never place it in VITE_* variables.
   - `WORKSHOP_ACCESS_CODE`: a separate private code shared with workshop participants. It is not the API key. It is kept only in memory in the browser input.
4. Run `npm run server` in one terminal and `npm run dev` in another. Restart both after changing environment files. Vite proxies `/api` to the local server on port 8787.
5. Add examples in Teach, open Challenge → Create together, enter the workshop code, then create a picture.

The key and access code have deliberately not been created or filled in. No provider requests were made during development.

## Model compatibility — verify before enabling paid calls

The adapters implement request/response shapes, not guaranteed availability of specific models. `gpt-image-2` and `google/gemini-3.1-flash-image-preview` must be confirmed in your Portkey workspace. Names can differ by provider route. Do not assume that the Google-prefixed name implies a direct Gemini connection.

- `edits` sends PNG references as multipart `image` (one reference) or `image[]` (multiple), plus `model`, `prompt`, and `n=1`. Your route/model must support that format. The generic Portkey edits documentation still describes legacy limitations, so current model support must be checked against your account.
- `chat` sends text and image_url references with `modalities: [image, text]`. Use only a compatible image-output chat route, such as an appropriately configured OpenRouter route. It is NOT the native Gemini generateContent API. The response must contain `choices[0].message.images[0].image_url.url`.
- Both adapters accept images-edits-style `data[0].b64_json` or `data[0].url`. There is no automatic fallback or retry that could unexpectedly charge twice.

Official references: https://portkey.ai/docs/api-reference/inference-api/images/create-image-edit and https://portkey.ai/docs/api-reference/inference-api/chat-completions

## Hosting

No hosting provider is configured or changed. Keep the existing public site in Demo until explicitly enabling Live.

The included server is a portable Node HTTP service, NOT a deployed serverless function. For a single-instance Node host, build the static frontend with `npm run build`, run the server with `npm run server`, and reverse-proxy `/api` to it. Set `HOST=0.0.0.0` if required by the host, `APP_ORIGIN` to the exact HTTPS website origin, and keep the secrets in host environment settings. Alternatively, set VITE_IMAGE_ENDPOINT to the HTTPS address of the server. It permits only the configured origin.

For serverless hosting, adapt the HTTP handler to the selected platform and use a shared rate-limit store. Choosing a hosting provider and deploying are still separate steps; no account settings or deployments were changed.

## Protection and limits

The server checks the workshop code before parsing images, validates request size, PNG headers/dimensions, 1–4 references, and short text. It constructs a child-friendly subject-constrained prompt. It sends neither classifier embeddings nor the full dataset. Invalid responses and provider failures produce friendly errors without provider body or secret logging. Requests time out after 90 seconds; the frontend after 120 seconds. Editing an idea aborts the outstanding client request.

`IMAGE_REQUEST_LIMIT=20` limits total generation attempts per server process, including failed provider attempts. Only one generation runs at a time. The counter resets on restart and is not shared across replicas. Use a provider/account spending cap as the authoritative budget, and a persistent shared limiter for multi-instance production. The workshop code is a basic shared gate, not individual user authentication.

The category picker is educational guidance. A prompt cannot guarantee that a model follows the requested subject, and a client can invent category names. The server has no authoritative copy of local training data; it cannot prove that a category was learned. Reference images guide generation; the generator is not fine-tuned here.

## Checks

`npm run test:server` tests validation, both adapter formats, access control, origin rejection and limits using mocked providers. `npm test`, `npm run lint`, and `npm run build` check the frontend. None uses a real API key.
