# Demo and Live picture making

Demo is the default. It previews an idea, not a generated picture. No image API is called.

## Enable Live

Live frontend support is implemented. The server function and Portkey integration are NOT implemented yet. Changing the mode alone will not generate images.

1. Implement/deploy a server function that uses Portkey. Store the provider key in that function's secrets, never in frontend variables.
2. Copy `.env.example` to `.env.local` at the repository root.
3. Set:

```dotenv
VITE_IMAGE_MODE=live
VITE_IMAGE_ENDPOINT=/api/generate-image
```

Replace `/api/generate-image` with your actual server function address. This is NOT the Portkey API address. For an external function, configure its CORS policy to allow the website origin.

4. Restart `npm run dev`. For a deployed website, set these variables in the hosting build settings and rebuild/redeploy. Vite settings are baked into the build.
5. Create together will show `Create my picture` and explain that references are sent online.

To return to Demo, set `VITE_IMAGE_MODE=demo` and restart/rebuild. `.env.local` is ignored by Git. All VITE_* settings are public; never put secrets there.

## Server contract

POST the configured endpoint with JSON:

```json
{
  "category": { "id": "cat", "name": "Cat" },
  "idea": "wearing a funny hat",
  "references": ["data:image/png;base64,..."]
}
```

Only the displayed references (up to four) are sent; classifier embeddings are not sent. Return JSON `{ "image": "data:image/png;base64,..." }` or an HTTPS image URL. Prefer inline image data for reliable display. The frontend handles errors and a two-minute timeout and cancels stale requests when the subject or idea changes.

The server must validate input and image sizes, compose a constrained prompt using the selected subject, and enforce access control and rate/spending limits. Frontend selection is educational guidance, not enforcement; a public caller can bypass it. Reference images guide generation; the generator is not fine-tuned on workshop examples.
