# Why Preview Errors Happen (and Why They Differ Per Website)

## The core situation

We take **AI-generated code** (different every time) and:

1. **Inject it into our own HTML/script** (string building in `WebsitePreview.tsx`).
2. **Run that combined script in the iframe** with Babel (one big inline script).

So we have **two worlds** meeting:

- **Our code** – builds one HTML string and one script (template literals, string replace, etc.).
- **Generated code** – arbitrary JS/JSX (template literals, assignments, imports, etc.).

Whenever the **generated** code contains something that **breaks how we build or run** the script, we get a runtime/parse error. Because the AI output **changes per generation**, **different sites hit different failure modes**.

---

## 1. Why “Unterminated template” (your current error)

**What you see:**

```text
> 34 |         <nav className={`header__nav ${isMenuOpen ? 'is-open' : ''}">
     |                                                                    ^
Unterminated template.
```

**What’s actually wrong:**  
The **generated** code uses a **template literal** (backticks `` ` ``):

```jsx
className={`header__nav ${isMenuOpen ? 'is-open' : ''}`}
```

Our **preview** builds the iframe HTML with a **JavaScript template literal** in the source of `WebsitePreview.tsx`:

```js
content = `<!DOCTYPE html>...
  ...
  ${componentDefinitions}   // ← we inject the generated code here
  ${appCode}
  ...
</html>`;
```

As soon as the **first backtick** inside `componentDefinitions` appears, the **parser** thinks our own template literal has **ended**. So:

- Our template is “closed” too early.
- The rest of the line (and possibly more) is parsed as normal JS, not as a string.
- The resulting script is invalid → Babel reports **“Unterminated template”**.

So the error is **not** that the AI wrote `` `...` `` (that’s valid JSX). The error is that we **embed** that string **unchanged** into **another** template literal. The inner backticks **break the outer** template literal.

**Why it varies:**  
Only **some** generated sites use template literals in JSX (e.g. `` className={`...`} ``). When they do, we hit this. When they don’t, we don’t.

---

## 2. Why different websites throw different errors

The model generates **different code** each time (different structure, patterns, and quirks). So each integration point can be hit in different ways:

| What the AI generates | What we do with it | Error you can get |
|-----------------------|--------------------|--------------------|
| `` className={`...`} `` | We inject it into our backtick template | **Unterminated template** |
| `product = {}.price` in JSX | We inject as-is; Babel parses it | **Invalid left-hand side in assignment** |
| `if (!product = {}) return null;` | Same | **Invalid left-hand side in assignment** |
| `${price}` in JSX text | Babel sees `${` and thinks template literal | **Unterminated template** (or similar) |
| `import Header from './Header'` + we replace with `const Header = []` | Same name later declared as component | **Identifier 'Header' has already been declared** |
| Other invalid or odd patterns | We don’t sanitise that case | **Other syntax/runtime errors** |

So:

- **Same app, same preview pipeline**, but **different generated code**.
- Different code hits **different** corners of our pipeline (embedding, import stripping, Babel parsing).
- Result: **different errors for different sites**.

---

## 3. Root causes (summary)

1. **Embedding**  
   We put generated code into **our** strings (template literals). Any character that has special meaning in **our** context (e.g. `` ` ``) can break the embedding if not escaped.

2. **No control over AI output**  
   We don’t constrain the AI to a small, fixed subset of JS/JSX. It can emit any valid (or borderline) pattern, so we see a **wide variety** of edge cases.

3. **Single script, single parse**  
   The whole app is one inline Babel script. **One** bad construct anywhere in the generated code makes the **entire** script fail to parse or run.

4. **Multiple “boundaries”**  
   - Building the HTML string (our template literals).
   - Stripping/rewriting imports and placeholders.
   - Babel parsing and running the combined script.  
   Each boundary can interact badly with some AI output and produce a **different** error.

---

## 4. Strategy: one approach for all sites

We can’t fix “each website” by hand. We make the pipeline **robust to arbitrary** generated code:

1. **Escape at embed boundaries**  
   Before we inject any generated string into **our** template literals, we escape characters that would break the embedding (e.g. `` ` `` and `\`).  
   → Prevents **Unterminated template** (and similar) from inner backticks.

2. **Sanitise known bad patterns**  
   We detect and rewrite **recurring** invalid or problematic patterns (e.g. `x = {}.prop`, `!x = {}`, `${...}` in JSX text) so the final script is valid.  
   → Handles **Invalid left-hand side** and similar errors for **any** site that generates those patterns.

3. **Avoid introducing new bugs**  
   When we strip imports or add placeholders, we must not declare the same names as real components (or we get “already been declared”).  
   → Same rule for every site; no per-site fix.

4. **Add new sanitisation as new patterns appear**  
   When a **new** error shows up, we add a **generic** sanitisation or escaping step that covers that **class** of problem, so future sites that generate the same pattern are fixed automatically.

So: **one set of rules** (escape + sanitise + careful placeholder logic), applied to **every** generation, so we don’t have to fix “each website” individually.

---

## 5. Your specific error and what we did

- **Error:** `Unterminated template` at the line with `` className={`header__nav ${isMenuOpen ? 'is-open' : ''}`} ``.
- **Cause:** That backtick string was injected into our template literal without escaping, so it closed our template and broke the script.
- **Fix (already in code):**  
  - Define `escapeForEmbed(s)` (escape `\` and `` ` ``).  
  - Use it for every interpolated value that contains generated code (each component’s `code`, `componentDefinitions`, `appCode`, `styleCss`, etc.) when building the HTML string.  
  So **any** future site that uses template literals in JSX is safe, not only this one.

If you still see the error after pulling the latest code, try a **hard refresh** or **rebuild** so the bundle with `escapeForEmbed` is the one running; if the old bundle is cached, the fix won’t be active.

---

## 6. Short answers to your questions

**Why does this error come?**  
Because we embed generated code (which contains backticks) into our own backtick template. The inner backtick ends our template and produces invalid script → “Unterminated template”.

**Why do different website generations give different errors?**  
Because each generation produces different code. Different code hits different parts of our pipeline (embedding, import handling, Babel parsing), so we get different error types. The **root cause** is always: **arbitrary generated code** meeting **our embedding and parsing rules**; the **symptom** depends on which pattern that particular generation used.

If you want, next step can be: double-check that `escapeForEmbed` is applied everywhere we inject code (and add a quick checklist in this doc), or add a small “preview health” check that logs when we’re about to inject unescaped backticks.
