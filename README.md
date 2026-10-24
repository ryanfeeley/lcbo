# LCBO Inventory Nearby

A GitHub Pages interface to search LCBO products by name or exact SKU and check inventory near your location or an Ontario address. Uses the same compact layout and location controls as [DineSafe](https://github.com/ryanfeeley/dinesafe) and [Toronto Incidents](https://github.com/ryanfeeley/toronto-incidents).

**Website:** https://ryanfeeley.github.io/lcbo/

## Hosting

The interface is static and deployed to GitHub Pages by `.github/workflows/pages.yml` whenever `main` changes. Set repository Settings → Pages → Source to **GitHub Actions**.

LCBO.dev currently does not allow direct browser requests from the Pages origin. `src/config.js` points the interface at a small API bridge hosted separately on Sites. That service must allow anonymous access for the Pages interface to work; its CORS handler permits `https://ryanfeeley.github.io`. It forwards only fixed product, inventory, and address queries. No API keys or database are required. No credentials belong in `src/config.js`.

The complete bridge source lives in `worker/server.js`. Changes to the bridge must also be deployed to its hosting service; Pages deployment only updates the interface.

## Development

No dependencies to install. Node.js 24 recommended.

```sh
node --test tests/*.test.mjs
node scripts/build-pages.mjs
python3 -m http.server 8000 --directory pages-dist
```

For localhost development, use a local bridge or add your local origin to the bridge's explicit origin allowlist. The production bridge allows only the Pages origin and its own origin.

`node scripts/build.mjs` builds the combined Sites Worker artifact under `dist/server/index.js`. This requires the deployment's `.openai/hosting.json`.

## Data and privacy

- Products and inventory: [LCBO.dev](https://lcbo.dev), an independent service updated daily. This project is not affiliated with LCBO. Stock is not reserved; confirm with the store before making a trip.
- Addresses: [OpenStreetMap Nominatim](https://nominatim.org). Searches are submitted explicitly, with cached results in the bridge.
- Coordinates are sent through the bridge to LCBO.dev for nearby inventory. Distances are straight-line estimates.
- Saved products and theme preference are stored only in the visitor's browser.
- Missing inventory records do not confirm zero stock. API outages display retryable errors instead of fabricated results.
