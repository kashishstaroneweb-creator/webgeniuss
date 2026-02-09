# Self-Hosted Real Build Preview – How It Will Work

This doc describes how to replace the current “single-script iframe” preview with a **real Vite build** run on your backend, then served and shown in an iframe. You can review this and then we implement step by step.

---

## 1. Why do this?

| Current (iframe + Babel) | Real build |
|--------------------------|------------|
| One HTML string, one script, Babel in browser | Real `npm install` + `vite build` |
| Fragile: backticks, “X is not defined”, missing tags break it | Same as production: normal build/runtime errors |
| No cost, runs in user’s browser | Runs on your server (self-hosted, no third-party sandbox) |

Goal: **Preview = real app**, so it only fails when the generated code actually has build/runtime errors, not because of our string injection.

---

## 2. High-level flow

```
User clicks “Preview” (or switches to Preview tab)
    → Frontend calls backend: “Give me a preview URL for this website”
    → Backend:
        1. Write project files to a directory (temp or per-website)
        2. Run: npm install
        3. Run: npm run build (Vite)
        4. Serve the built output (dist/) under a URL
        5. Return that URL to the frontend
    → Frontend sets iframe src = that URL
    → User sees the real built app in the iframe
```

No Babel in the browser, no single-script injection. The iframe loads a **real built SPA** from your server.

---

## 3. What we already have (backend)

In `backend/src/website/website.service.ts` you already have:

- **`saveViteProject(userId, websiteId, components, viteConfig, websiteName)`**  
  Writes a full Vite project to disk:
  - `generated_sites/<userId>/<websiteId>/`
  - `package.json`, `vite.config.js`, `index.html`
  - `src/main.jsx`, `src/style.css`
  - `src/components/*.jsx` (from `components[]`)

So **writing the project to disk** is done. We only need to add:

1. **Build step** in that directory: `npm install` then `npm run build`.
2. **Serving** the `dist/` folder at a stable URL.
3. **Preview API** that the frontend calls to get that URL (and optionally triggers build if needed).
4. **Cleanup** (optional): when to delete old build dirs to save disk.

---

## 4. Options for “where to build” and “where to serve”

### Option A – Build in `generated_sites` (simplest)

- Use the same path you already use: `generated_sites/<userId>/<websiteId>/`.
- When user asks for preview:
  1. Ensure project is on disk (call `saveViteProject` if needed).
  2. Run `npm install` and `npm run build` in that directory.
  3. Serve `generated_sites/<userId>/<websiteId>/dist/` at a URL like:
     - `GET /website/preview/:userId/:websiteId/` → static files from that `dist/`.
- **Pros:** Reuses existing logic, one source of truth per website.  
- **Cons:** Build runs on your server; need to handle concurrent builds (e.g. queue or limit).

### Option B – Build in a temp directory per preview

- On each “preview” request, create a unique dir, e.g. `preview_builds/<previewId>/`.
- Write the same project files there (reuse the same structure as `saveViteProject`), then `npm install` + `npm run build`.
- Serve `preview_builds/<previewId>/dist/` at `GET /website/preview/build/:previewId/`.
- After some TTL (e.g. 1 hour) or when user “closes” preview, delete the dir.
- **Pros:** Isolated per preview; no long-term disk growth if you clean up.  
- **Cons:** More disk I/O and builds (every preview = new build unless we cache by websiteId).

**Recommendation:** Start with **Option A** (build in `generated_sites/<userId>/<websiteId>/`). Add a dedicated “preview” endpoint that builds (if needed) and returns the URL. If you later want isolation or short-lived previews, we can add Option B with a `previewId` and cleanup.

---

## 5. Backend pieces to add

### 5.1 Build step (Node)

In the backend, in the directory where the Vite project lives:

```text
npm install
npm run build
```

Use Node’s `child_process` (e.g. `exec` or `spawn` with `shell: true`) so the process runs in that directory. Set a timeout (e.g. 2–3 minutes). Capture stdout/stderr so you can return “Build failed” with a message if `npm run build` exits non-zero.

### 5.2 Serving `dist/` (NestJS)

- Use Nest’s **static assets** for a route prefix, e.g. `/website/preview/`.
- Map:
  - `GET /website/preview/:userId/:websiteId/` → `generated_sites/<userId>/<websiteId>/dist/index.html`
  - `GET /website/preview/:userId/:websiteId/assets/*` → `generated_sites/<userId>/<websiteId>/dist/assets/*`
- Vite’s default build outputs `dist/index.html` and `dist/assets/*`. So “base” for the SPA must match: in `vite.config.js` you may need `base: '/website/preview/<userId>/<websiteId>/'` for that build, **or** you serve at root of a subdomain/path so we don’t have to change base (see below).

**Simpler variant:** Serve the whole `dist` folder as static files under a single path, e.g.:

- Route: `GET /preview/:buildId/` and `GET /preview/:buildId/*`
- `buildId` could be `userId_websiteId` or a short unique id that you map to a `dist` path.
- Nest static module: `ServeStaticModule.forRoot({ rootPath: '<path to dist root>', serveRoot: '/preview/...' })` or a custom controller that reads from the filesystem and sends `index.html` vs asset files. Easiest is one static root per build and a dynamic route that points to the right root.

(We can implement the exact route and mapping when we code it; the important part is: **some URL that serves the contents of `dist/`**.)

### 5.3 Preview API (what the frontend calls)

New endpoint, e.g.:

- **`POST /website/:websiteId/preview`** (or `GET` if you prefer)
  - Auth: ensure the user owns this website.
  - Load website from DB (components, viteConfig, etc.).
  - Ensure project on disk (`saveViteProject`).
  - Run build (`npm install` + `npm run build`) in that directory.
  - If build fails: return `{ success: false, error: 'Build failed', log: stderr }`.
  - If build succeeds: return `{ success: true, previewUrl: 'https://your-api.com/preview/<userId>/<websiteId>/' }` (or whatever the real URL is).

Frontend then sets `iframe.src = previewUrl`.

### 5.4 Base URL for the built app

Vite builds with `base: '/'` by default, so assets are loaded from `/assets/...`. If you serve the app at `https://api.example.com/preview/user123/website456/`, the browser will request `https://api.example.com/assets/...` (wrong). So you need either:

- **A:** Build with `base: '/preview/user123/website456/'` so assets are requested under that path, and you serve both `index.html` and `assets/` under that prefix, or  
- **B:** Serve the preview at a path that looks like “root” for that iframe (e.g. a dedicated subdomain or a route that serves the whole dist at `/preview/xyz/` and Vite’s `base` is set to `/preview/xyz/` for that build).

We’ll set `base` in the generated `vite.config.js` (or override when building for preview) so it matches the serve path. Detail can be done in implementation.

---

## 6. Frontend changes

- **Preview tab / “View Preview” button:**  
  Instead of rendering `<WebsitePreview html={...} css={...} ... />` (the current component that builds the single HTML string and doc.writes into an iframe), do:

  1. Call the new API: `GET/POST /website/:websiteId/preview` (or the exact path we define).
  2. If the API returns `previewUrl`, set the iframe to:
     - `<iframe src={previewUrl} ... />`
  3. If the API returns “build failed”, show a message (e.g. “Preview build failed: …” with the log).
  4. Optional: show a loading state (“Building preview…”) while the request is in flight.

- **Keep the old `WebsitePreview` component** for legacy HTML/CSS/JS-only websites if you don’t want to build those (or we can add a separate path for “legacy” that still uses the current method). For **component-based (Vite) websites**, use the new “real build” preview only.

---

## 7. Security and robustness

- **Auth:** Preview endpoint must check that the requesting user is allowed to see that website (e.g. owner or shared).
- **Path traversal:** When serving files from `dist/`, resolve paths so that only files under the intended `dist` directory are served (no `..`).
- **Build timeout:** Cap `npm install` + `npm run build` time (e.g. 2–3 min) so one bad build doesn’t hang the server.
- **Concurrent builds:** If many users hit “Preview” at once, you might run many `npm install` + `npm run build` in parallel. Consider a simple in-memory queue (e.g. one build per websiteId at a time) or a limit on concurrent builds to avoid CPU/memory spikes.
- **Disk:** If you use Option A and never delete builds, disk can grow. Optional: periodic cleanup of old `dist` folders or of `generated_sites` for inactive users.

---

## 8. Summary checklist (for implementation)

- [ ] Backend: add a “build” helper that, given a project directory, runs `npm install` and `npm run build` with a timeout and returns success/failure + logs.
- [ ] Backend: ensure `vite.config.js` base (or build env) matches the preview URL path so assets load.
- [ ] Backend: add static (or controller) serving for `dist/` at a stable preview URL (e.g. `/preview/:userId/:websiteId/` or `/preview/:buildId/`).
- [ ] Backend: add `GET/POST /website/:websiteId/preview` that loads website, ensures project on disk, runs build, returns `previewUrl` or error.
- [ ] Frontend: for Vite/component-based websites, call the preview API and set iframe `src` to `previewUrl`; show “Building…” and “Build failed” when appropriate.
- [ ] (Optional) Keep current iframe preview for legacy HTML/CSS/JS-only sites.
- [ ] (Optional) Queue or limit concurrent builds; add cleanup for old build dirs.

Once you’ve read this and are happy with the flow, we can implement it step by step (e.g. backend build + serve first, then frontend).
