# Website Generation Flow (end-to-end)

Single reference for the full pipeline: from user prompt to preview iframe. Use this to trace where data is transformed and where errors can come from.

---

## 1. One-line overview

```
User prompt → Backend: enhance prompt → v0 API → parse JSON → normalize (files→components) → sanitize (all code) → strip placeholders → save DB + files
→ Frontend: load website → WebsitePreview builds one HTML string (React path or legacy) → escape/transform script → doc.write(iframe) → Babel runs script → render
```

---

## 1b. How preview works when the code is fine (no errors)

When the generated code is valid and doesn’t hit any of the known breaking patterns, preview works like this:

1. **You open preview**  
   Frontend has the website data: `components[]` (name, path, code) and `viteConfig` (mainJsx, styleCss). It passes them into `WebsitePreview`.

2. **WebsitePreview builds one HTML string**  
   - **React path** (components + JSX):
     - Each component’s `code` is lightly transformed (template literals in JSX → string concat, invalid assignment fixes, imports/exports stripped) and wrapped in an IIFE: `const Header = (function(){ ... return typeof Header === 'function' ? Header : function Header(){ return null; }; })();`
     - Main app code (`mainJsx`) is processed the same way (imports stripped, placeholders removed) and becomes `appCode`.
     - Fallbacks are added for used-but-undeclared names: PascalCase → noop function, others → `[]`.
     - An error boundary is added and the root render is wrapped in it.
   - All of that is concatenated into **one HTML document**: `<html>…<script src="react">…<script src="react-dom">…<script src="babel">…<script type="text/babel">(function(){ fallbacks; error boundary; componentDefinitions; appCode; })();</script></html>`.

3. **That HTML is written into the iframe**  
   `iframe.contentDocument` is opened, the full `content` string is written with `doc.write(content)`, then the document is closed.

4. **The browser runs the iframe page**  
   It loads the script tags. React and ReactDOM come from the CDN. The big inline `<script type="text/babel">` is compiled by Babel (in the browser), then executed. So in order:
   - Fallback variables and the error boundary are defined.
   - Each component IIFE runs and assigns a function to the global name (e.g. `Header`, `Hero`).
   - The app code runs and calls `ReactDOM.createRoot(...).render(<PreviewErrorBoundary><App /></PreviewErrorBoundary>)`.
   - React renders the tree; each `<Header />`, `<Hero />`, etc. resolves to the function we assigned. No imports or build step—everything is globals in one script.

5. **You see the site**  
   The app renders into the iframe’s root div. If anything in the tree throws, the error boundary catches it and shows a “Preview error” message instead of a blank screen.

So when the code is great: **same data, same single HTML string, same single script run by Babel in the iframe**. The “process” is: build that one document from components + mainJsx + style, write it into the iframe, let Babel + React run it. Errors only appear when the generated code (or our transforms) introduce something that breaks that single script (parse error, invalid element type, etc.); the docs above describe those cases and the fixes.

---

## 2. Backend (website.service.ts)

**Entry:** `WebsiteController.generate()` → `WebsiteService.generateWebsite(userId, prompt, websiteName)`  
**File:** `backend/src/website/website.service.ts`

### 2.1 Input and API

- **Enhance prompt:** `enhanceUserPrompt(prompt)` — adds design/functionality (shop, calculator, todo, etc.).
- **v0 Platform API call:** official [`v0-sdk`](https://v0.app/docs/api/platform/packages/v0-sdk) `createClient({ apiKey, baseUrl })` (same stack as `import { v0 } from 'v0-sdk'`, plus **`V0_API_URL`** and legacy key) → `chats.create({ system, message, responseMode: 'sync', modelConfiguration? })`, then `chats.getById` while the version is pending. **`OPENAI_API_KEY`** is copied to **`V0_API_KEY`** in `WebsiteService` when needed. Optional model: **`V0_PLATFORM_MODEL_ID`** only (`v0-max`, etc.).
- **Response:** Chat JSON with **`latestVersion.files`** (`name` + `content`) → `normalizeV0SdkFiles` → `convertV0FilesToStructure`; fallback: parse `text` / last assistant `content` as JSON (legacy).

### 2.2 Parse response

- **Primary:** `parseV0Response(responseContent)` — strip markdown fences, `JSON.parse()`.
- **On failure (e.g. "Unterminated string"):** `tryRepairTruncatedJson()` then parse again.
- **Fallback:** `extractCodeFromResponse(responseContent)` — find JSON or code blocks.

Result: object with `components`, `viteConfig`, or legacy `html`/`css`/`js`.

### 2.3 Normalize structure

- If response has **`files: [{ path, content }]`**:
  - **`convertV0FilesToStructure(websiteCode)`** builds:
    - `components[]` from `components?/*.tsx|jsx`
    - `viteConfig.mainJsx` from `app/*.tsx|jsx` (or minimal App if missing)
    - `viteConfig.styleCss` from `.css`/`.scss`

After this: one shape with `components` + `viteConfig` (and optional legacy).

### 2.4 Sanitize (order matters)

Applied to **each component.code**, then **mainJsx** / **mainJs**:

1. **transformJsxAttributeTemplateLiterals(code)** — `` {\`...${expr}...\`} `` → `{'...' + (expr)}` (no backticks in JSX attrs).
2. **sanitizeJsxDollarInterpolation(code)** — `${expr}` in JSX text → `{'$' + expr}`.
3. **sanitizeInvalidConditionAssignment(code)** — `!x = {}` / `!x = []` → `!x`; `= {}s,` → `= {},` (typo fix).
4. **replaceBrokenImageUrls(code)** — imgur etc. → placeholder URLs (picsum/Unsplash if key set).

Legacy: only **replaceBrokenImageUrls** on `html`, `css`, `js`.

### 2.5 Strip placeholders

- **Strip from mainJsx/mainJs:** any `const ComponentName = [];` for names in `components` (avoids "Identifier has already been declared" in preview).

### 2.6 Save

- Save to DB (website entity).
- Optionally write to `generated_sites/` (if used).
- Return full website object to frontend.

---

## 3. Frontend – data source

- **API:** Website data (e.g. from history or after generate) includes:
  - `components`: `[{ name, path, code, language }]`
  - `viteConfig`: `{ mainJsx?, mainJs?, styleCss? }`
  - Optional: `html`, `css`, `js` (legacy)

- **WebsitePreview** receives: `components`, `viteConfig`, `websiteName`, and optionally `html`, `css`, `js`.

---

## 4. Frontend – preview build (WebsitePreview.tsx)

**File:** `frontend/src/components/WebsitePreview.tsx`  
**Function:** `loadIframeContent()` → inside it, **`loadContent()`** builds `content` and runs `doc.write(content)`.

### 4.1 Helpers (defined inside loadContent)

- **escapeForEmbed(s)** — `\` → `\\`, `` ` `` → `` \` `` (for HTML/title/style/body).
- **SCRIPT_BT** — `'__WEBPREVIEW_BACKTICK__'`; **escapeForEmbedInScript(s)** — backtick → SCRIPT_BT, backslash doubled.
- **escapeBackslashOnly(s)** — only double backslashes (for embedding already-escaped script).
- **transformJsxAttributeTemplateLiterals(code)** — same idea as backend: `` {\`...\`} `` → concatenation (loop until no match).
- **sanitizeInvalidAssignment(code)** — same fixes as backend + `= {}s,` → `= {},`.

### 4.2 Branch: component-based vs legacy

- **If `components?.length > 0`:**
  - **React path** (if JSX detected): use `mainJsx`, wrap each component in IIFE, build one HTML with React + Babel script.
  - **Vanilla path:** build HTML with plain script, no React.
- **Else:** **Legacy path** — use `html` / `css` / `js`; inject `<style>` and `<script>` if missing.

### 4.3 React path (main case)

1. **processedComponents** = for each component:
   - `sanitizeDollarInJsx(c.code)` then **transformJsxAttributeTemplateLiterals** then strip imports/exports, fix exports, default props, etc.
2. **processedMain** = from `viteConfig.mainJsx`: strip imports, replace component imports (no `const X = []` for component names), strip placeholder `const Name = [];`; then **transformJsxAttributeTemplateLiterals**; then **escapeForEmbedInScript(processedMain)** → **appCode**.
3. **componentDefinitions** = each processed component code wrapped in IIFE, with **escapeForEmbedInScript(code)**; then **sanitizeInvalidAssignment(componentDefinitions)**.
4. **reactFallbackLines** = `if (typeof products === 'undefined') { var products = []; }` etc. for known data names.
5. **content** = one big template literal:
   - `<title>`, `<style>` (escapeForEmbed for title/style).
   - `<script type="text/babel">`: fallback lines, componentDefinitions, appCode — embedded with **escapeBackslashOnly** (already escaped above).
6. **Imgur** (and similar) URLs in `content` replaced with placeholder image URLs.

### 4.4 Before doc.write (all paths)

1. **Safety pass:** In full `content`, replace `{__WEBPREVIEW_BACKTICK__...${...}...__WEBPREVIEW_BACKTICK__}` with concatenation form (so we never restore backticks for template literals).
2. **Restore placeholder:** `content = content.replace(/__WEBPREVIEW_BACKTICK__/g, '`')`.
3. **Final script fix:** For **every** `<script>...</script>`, replace body with:
   - **sanitizeInvalidAssignment(transformJsxAttributeTemplateLiterals(body))**  
   So any remaining `` {\`...\`} `` or `= {}s,` in the script is fixed here.
4. **doc.open(); doc.write(content); doc.close();**

### 4.5 What runs in the iframe

- HTML with React + ReactDOM + Babel scripts.
- One inline `<script type="text/babel">` with: fallbacks, then each component as IIFE, then App init (mainJsx or generated App).
- Babel compiles JSX and runs the script; React renders into `#root` (or configured root id).

---

## 5. Where errors come from

| Error | Likely place |
|-------|----------------------|
| "Unterminated template" | Backtick in generated code; should be fixed by transform (backend + frontend) and final script-body transform. |
| "Expecting Unicode escape \uXXXX" | Double-escaped backtick; we use placeholder + safety pass + final transform to avoid. |
| "Identifier 'X' has already been declared" | Placeholder `const X = []` left in mainJsx or emitted by import replacement; backend strips from mainJsx; frontend avoids emitting for component names. |
| "Invalid left-hand side in assignment" | `!x = {}` or `x = {}.prop` or `= {}s,`; backend and frontend sanitize; final script-body runs sanitizeInvalidAssignment. |
| "Unexpected token, expected `,`" (e.g. `product = {}s`) | Typo in destructuring default; sanitizeInvalidAssignment fixes `= {}s,` → `= {},` (backend + frontend + final script). |
| Babel/parse errors on exact line in script | That line is in the final script body; check what the **final** script-body transform received (add a short log of `body` before transform if needed). |

---

## 6. Quick trace checklist

1. **Backend:** Is the raw v0 response valid JSON? (parseV0Response / repair / extractCodeFromResponse.)
2. **Backend:** After sanitize, does code still have `` ` `` in JSX attrs or `= {}s`? (transformJsxAttributeTemplateLiterals, sanitizeInvalidConditionAssignment.)
3. **Frontend:** Is this site using React path? (components + JSX detection.)
4. **Frontend:** Is **transformJsxAttributeTemplateLiterals** and **sanitizeInvalidAssignment** applied to each component and to mainJsx, and again on the **entire script body** before doc.write?
5. **Iframe:** The exact script Babel runs is the script tag body **after** the final replace (step 4.4.3). Log that string to see what Babel actually parses.

---

*Doc kept under 300 lines; see CODE_EXTRACTION_AND_PREVIEW_FLOW.md and PREVIEW_ERRORS_WHY_AND_STRATEGY.md for more detail.*
