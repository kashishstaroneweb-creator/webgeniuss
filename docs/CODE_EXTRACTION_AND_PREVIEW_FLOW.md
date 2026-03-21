# Code Extraction and Preview Flow

This document describes how WebGenius generates website code (via the v0 API), extracts and normalizes it, stores it, and finally how the frontend displays it in the **Code** panel and renders it in the **Preview** iframe.

---

## 1. High-level flow

```
User submits prompt (Dashboard)
    → POST /website/generate (Backend)
    → v0 Platform API returns chat + files (or JSON in message text)
    → Backend parses, sanitizes, normalizes, saves to DB + generated_sites/
    → Backend returns full website object to frontend
    → Frontend stores in state and passes to WebsitePreview + code tabs
    → WebsitePreview builds a single HTML document and writes it into an iframe
    → Iframe loads React CDN + Babel, runs component code + App, renders into #root
```

---

## 2. Backend: request and API call

**Entry:** `WebsiteController.generate()`  
**File:** `backend/src/website/website.controller.ts`

- `POST /website/generate` with body: `{ prompt, websiteName?, userId? }`.
- Controller calls `WebsiteService.generateWebsite(userId, prompt, websiteName)`.

**File:** `backend/src/website/website.service.ts`

- **Enhance prompt:** `enhanceUserPrompt(prompt)` adds design/functionality requirements (shop, calculator, todo, or generic).
- **Call v0 Platform API:** `v0-sdk` `createClient` → `chats.create({ system, message, responseMode: 'sync' })`, poll `chats.getById` until files or completed; auth via `V0_API_KEY` / `OPENAI_API_KEY` (see `WebsiteService` constructor).
- Raw result: chat with `latestVersion.files` (`name`, `content`) → normalized paths → `convertV0FilesToStructure`; else parse `text` / assistant message as JSON (legacy).

---

## 3. Backend: extract and normalize code

**File:** `backend/src/website/website.service.ts`

### 3.1 Parse response

- **Primary:** `parseV0Response(responseContent)`
  - Strips optional markdown fences (e.g. `\`\`\`json` … `\`\`\``).
  - `JSON.parse(content)` → object with at least `components` and/or `viteConfig` (or legacy `html`/`css`/`js`).
- **Fallback:** If parse fails, `extractCodeFromResponse(responseContent)`:
  - Tries to find a JSON object containing `"components"` or legacy `"html"`/`"css"`/`"js"` in the string and parse it.
  - Or extracts from code blocks / tags (e.g. ````html`, ````css`, ````js`) or `<html>`, `<style>`, `<script>`.

### 3.2 Normalize “files” format to “components + viteConfig”

- If parsed object has `files: [{ path, content }]` (v0 “files” format):
  - `convertV0FilesToStructure(websiteCode)`:
    - Splits `files` into: component files (`components?/`, `.tsx`/`.jsx`), page files (`app/`, `.tsx`/`.jsx`), style files (`.css`/`.scss`).
    - Builds `components[]` from component files (name from path, e.g. `Header.jsx` → `Header`).
    - Builds `mainJsx` from the first app page: strip imports, rename default export to `App`, ensure `ReactDOM.createRoot(...).render(<App />)` (or `ReactDOM.render`).
    - If no app page but there are components: generates a minimal `mainJsx` that imports all components and renders `<App />` with them.
    - Puts `mainJsx`, `styleCss` (and optional existing viteConfig) into `viteConfig`.

Result after this step: one structure with:

- `components`: `[{ name, type, path, code, language }]`
- `viteConfig`: `{ mainJsx?, mainJs?, styleCss?, indexHtml?, viteConfig?, packageJson? }`
- Optional legacy: `html`, `css`, `js`

### 3.3 Sanitize code (all paths)

- **JSX:** `sanitizeJsxDollarInterpolation(code)` so `${...}` in JSX text becomes `{'$' + ...}` (avoids Babel “Unterminated template”).
- **Invalid assignments:** `sanitizeInvalidConditionAssignment(code)` (e.g. `!x = {}` → `!x`).
- **Images:** `replaceBrokenImageUrls(code)` replaces imgur (etc.) URLs with placeholder URLs (e.g. picsum) with context-based dimensions.

Applied to:

- Every `component.code`
- `viteConfig.mainJsx` and `viteConfig.mainJs`
- Legacy `html`, `css`, `js` if present

### 3.4 Extract final structure

- `components = websiteCode.components || []`
- `viteConfig = websiteCode.viteConfig || null`
- Legacy: `htmlCode`, `cssCode`, `jsCode` from `websiteCode.html/css/js` or defaults.

---

## 4. Backend: persist and return

**File:** `backend/src/website/website.service.ts`

- **DB:** `websiteRepository.create()` + `save()`:
  - If component-based: stores `components`, `viteConfig`; legacy fields stored empty (or vice versa for legacy).
  - Also: `userId`, `websiteName`, `prompt`, `generatedPath`, `createdAt`.
- **Prompt history:** Raw `responseContent` and `prompt` saved to prompt history.
- **Files on disk:**
  - Component-based: `saveViteProject()` → `generated_sites/{userId}/{websiteId}/` with `index.html`, `package.json`, `vite.config.js`, `src/main.jsx`, `src/style.css`, and each component under `src/components/` (or path from config).
  - Legacy: `saveWebsiteFiles()` → `index.html`, `styles.css`, `app.js` in that folder.
- **Return:** Saved website entity (with `id` as string) including `components`, `viteConfig`, and legacy fields so the frontend has everything for code view and preview.

---

## 5. Frontend: receive and store

**File:** `frontend/src/pages/Dashboard.tsx`

- **Generate:** `handleGenerate()` → `api.post('/website/generate', { prompt, websiteName })` → response is the full website object.
- **Set state:** `setGeneratedWebsite(res.data)` so the object has:
  - `id`, `websiteName`, `prompt`, `createdAt`
  - `components`, `viteConfig` (for component-based)
  - `htmlCode`, `cssCode`, `jsCode` (for legacy)
- **Load from history:** When URL has `?website=id`, `api.get(\`/website/${id}\`)` loads the same shape and sets `generatedWebsite`.

Same kind of object is used on **History** and **Websites** when opening a website (by id) for code view and preview.

---

## 6. Frontend: showing the code (Code panel)

**Files:** `frontend/src/pages/Dashboard.tsx`, `History.tsx`, `Websites.tsx`

- **Tabs:** One tab per component (`component-0`, `component-1`, …), plus tabs for **style**, **main** (mainJsx/mainJs), **index** (indexHtml), **vite** (vite.config), **package** (packageJson).
- **Source of truth:**
  - Component code: `generatedWebsite.components[i].code` (and `.name`, `.path`, `.language`).
  - Styles: `generatedWebsite.viteConfig.styleCss`.
  - Entry: `generatedWebsite.viteConfig.mainJsx` or `mainJs`.
  - HTML shell: `generatedWebsite.viteConfig.indexHtml`.
  - Config files: `viteConfig.viteConfig`, `viteConfig.packageJson`.
- **Rendering:** These strings are shown in syntax-highlighter panels (e.g. Prism); no transformation beyond formatting (e.g. `formatCode`, `formatJson`). So “extraction” for the code view is simply: use the same `components` and `viteConfig` returned from the backend.

---

## 7. Frontend: preview (WebsitePreview → iframe)

**File:** `frontend/src/components/WebsitePreview.tsx`

**Props:** `html`, `css`, `js` (legacy) and/or `components`, `viteConfig`, `websiteName`.

When the user opens the preview, the parent (e.g. Dashboard) passes:

- `components={generatedWebsite.components}`
- `viteConfig={generatedWebsite.viteConfig}`
- Optionally `html`/`css`/`js` for legacy.

### 7.1 Branch: component-based vs legacy

- If `components && components.length > 0` → **component-based** path (React or vanilla).
- Else → **legacy** path: single HTML string (optionally inject `<style>` and `<script>` from `css`/`js`), then `doc.write(content)` into iframe.

### 7.2 React vs vanilla (component-based)

- **React:** Any component has `language === 'jsx'` or code contains `import React` / `from 'react'` / `className=`.
- **Vanilla:** Otherwise; components are treated as plain JS functions and rendered with a small `jsx()` DOM helper and `appendChild`.

### 7.3 React path: building the iframe document

1. **Inputs:** `viteConfig.styleCss`, `viteConfig.mainJsx` (or `mainJs`), and `components`.

2. **Process each component:**
   - Sanitize `$` in JSX text (same idea as backend).
   - Remove all `import` lines (React/hooks provided by preamble; other imports replaced or removed so no duplicate `const Header = []` for component names).
   - Remove `export default` and ensure component is a named function matching `component.name` (e.g. `function Header(...)`).
   - Optional: default props (e.g. `product = {}`) to avoid runtime errors.
   - Wrap each component in an IIFE that returns the component: `const Header = (function() { ... component code ... return Header; })();` so names don’t collide across files.

3. **Process mainJsx:**
   - Strip all imports (React, ReactDOM, component imports, style, data). For non-component default imports, replace with `const X = [];` only if `X` is not a component name (and remove any leftover `const ComponentName = [];` so “Identifier already declared” doesn’t happen).
   - Remove exports and `'use client'` / duplicate React destructuring.
   - Ensure there is a single `function App() { return (<> ... <Header /> ... </>); }` (either keep from mainJsx or inject one).
   - Detect root element id from `getElementById('...')` in the script.

4. **Assemble full HTML:**
   - React + ReactDOM from CDN (UMD).
   - Babel standalone for in-browser JSX.
   - One `<script type="text/babel">` containing:
     - IIFE with try/catch.
     - Preamble: `const { useState, useEffect, ... } = React;` and optional fallbacks for data variables (e.g. `movieData`, `products`) only if not already declared.
     - **Component definitions** (IIFEs) in order → `const Header = (...)(); const Hero = (...)(); ...`
     - **App + mount** (processed mainJsx) → `function App() { ... }` and `ReactDOM.createRoot(...).render(<App />)`.
   - `<style>`: global reset + `viteConfig.styleCss`.
   - `<div id="root">` (or id from mainJsx).

5. **Write to iframe:** `doc.open(); doc.write(content); doc.close();` (and replace imgur etc. in `content` with placeholder image URLs).

6. **When it runs:** Iframe loads; Babel compiles the single script; React and all components run in one global scope; `App` mounts into `#root` and the preview is visible.

### 7.4 Vanilla path (component-based, non-React)

- Components are converted to global functions (strip exports, ensure `function ComponentName()`).
- A small `jsx(tag, props, ...children)` helper is injected.
- “Main” execution code appends each component’s root node to `#app`.
- Full HTML is built with that script and styles and written into the iframe.

---

## 8. Summary table

| Stage            | Where        | What happens |
|-----------------|-------------|----------------|
| **Generate**    | Controller  | POST /website/generate → WebsiteService.generateWebsite |
| **API**         | WebsiteService | enhanceUserPrompt → v0 API chat completion |
| **Parse**       | WebsiteService | parseV0Response (or extractCodeFromResponse) → JSON object |
| **Normalize**   | WebsiteService | convertV0FilesToStructure if `files` → components + viteConfig |
| **Sanitize**    | WebsiteService | JSX `$`, invalid assignments, image URLs on all code strings |
| **Persist**     | WebsiteService | Save to DB (components, viteConfig, legacy), prompt history, generated_sites/ files |
| **Return**      | Controller  | Full website object to frontend |
| **Store**       | Dashboard etc. | setGeneratedWebsite(res.data) or from GET /website/:id |
| **Code view**   | Dashboard/History/Websites | Tabs show components[].code, viteConfig.styleCss, mainJsx, indexHtml, etc. |
| **Preview**     | WebsitePreview | components + viteConfig → single HTML with React CDN + Babel + processed components + App → doc.write(iframe) |

That’s the full flow from “extract code” (parse + normalize + sanitize on the backend) to “show it” (code tabs) and “preview” (iframe built and run in WebsitePreview).
