/**
 * Comprehensive code sanitizer for v0-generated code
 * Fixes all known preview breaking patterns
 */

export class CodeSanitizer {
  /**
   * Next.js `metadata` / `export const metadata` is invalid when multiple files are concatenated for preview.
   * Strip blocks and next/metadata imports from stored v0 output.
   */
  static stripNextJsMetadataBlocks(code: string): string {
    if (!code || typeof code !== 'string') return code;
    let s = code;
    const headerPatterns = [
      /export\s+const\s+metadata\s*(?::\s*[^\n=]+)?=\s*\{/,
      /const\s+metadata\s*:\s*Metadata\s*=\s*\{/,
      /const\s+metadata\s*=\s*\{/,
    ];
    let removed = true;
    while (removed) {
      removed = false;
      for (const re of headerPatterns) {
        const m = re.exec(s);
        if (!m || m.index === undefined) continue;
        const start = m.index;
        const braceIdx = s.indexOf('{', start);
        if (braceIdx === -1) continue;
        let depth = 0;
        let i = braceIdx;
        for (; i < s.length; i++) {
          const ch = s[i];
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
        if (depth !== 0) continue;
        let end = i;
        while (end < s.length && /\s/.test(s[end])) end++;
        if (s[end] === ';') end++;
        s = s.slice(0, start) + '\n' + s.slice(end);
        removed = true;
        break;
      }
    }
    s = s.replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"]next['"]\s*;?\s*/g, '');
    s = s.replace(/import\s+\{\s*Metadata\s*\}\s+from\s+['"]next['"]\s*;?\s*/g, '');
    s = s.replace(/import\s+type\s+Metadata\s+from\s+['"]next['"]\s*;?\s*/g, '');
    return s;
  }

  /**
   * Master sanitization - run on ALL code before preview/save
   */
  static sanitizeAll(code: string): string {
    let sanitized = code;
    sanitized = this.stripNextJsMetadataBlocks(sanitized);
    sanitized = this.fixTemplateLiteralsInJSX(sanitized);
    sanitized = this.fixDollarSignsInJSX(sanitized);
    sanitized = this.fixInvalidAssignments(sanitized);
    sanitized = this.fixAdjacentJSX(sanitized);
    sanitized = this.fixComponentPlaceholders(sanitized);
    sanitized = this.fixTypoDestructuring(sanitized);
    sanitized = this.normalizeImportsExports(sanitized);
    sanitized = this.addMissingVariableFallbacks(sanitized);
    sanitized = this.fixBrokenImageUrls(sanitized);
    return sanitized;
  }

  /**
   * Sanitize without changing structure (no import/export removal, no fallback injection).
   * Use when you want to fix syntax only and keep imports for stored code.
   */
  static sanitizeSyntaxOnly(code: string): string {
    let sanitized = code;
    sanitized = this.stripNextJsMetadataBlocks(sanitized);
    sanitized = this.fixTemplateLiteralsInJSX(sanitized);
    sanitized = this.fixDollarSignsInJSX(sanitized);
    sanitized = this.fixInvalidAssignments(sanitized);
    sanitized = this.fixAdjacentJSX(sanitized);
    sanitized = this.fixComponentPlaceholders(sanitized);
    sanitized = this.fixTypoDestructuring(sanitized);
    sanitized = this.fixBrokenImageUrls(sanitized);
    return sanitized;
  }

  static fixTemplateLiteralsInJSX(code: string): string {
    let result = code;
    let maxIterations = 10;
    let iterations = 0;
    const pattern = /\{`([^`]*\$\{[^}]+\}[^`]*)`\}/g;
    while (pattern.test(result) && iterations < maxIterations) {
      result = result.replace(pattern, (match, template) => {
        const parts: string[] = [];
        let current = '';
        let depth = 0;
        let inExpr = false;
        for (let i = 0; i < template.length; i++) {
          const char = template[i];
          const next = template[i + 1];
          if (char === '$' && next === '{' && !inExpr) {
            if (current) parts.push(`'${current.replace(/'/g, "\\'")}'`);
            current = '';
            inExpr = true;
            depth = 1;
            i++;
            continue;
          }
          if (inExpr) {
            if (char === '{') depth++;
            if (char === '}') {
              depth--;
              if (depth === 0) {
                parts.push(`(${current})`);
                current = '';
                inExpr = false;
                continue;
              }
            }
          }
          current += char;
        }
        if (current) parts.push(`'${current.replace(/'/g, "\\'")}'`);
        return `{${parts.join(' + ')}}`;
      });
      pattern.lastIndex = 0;
      iterations++;
    }
    return result;
  }

  static fixDollarSignsInJSX(code: string): string {
    return code.replace(/>\s*\$\{([^}]+)\}\s*</g, (_match, expr) => {
      return `>{'$' + (${expr})}<`;
    });
  }

  static fixInvalidAssignments(code: string): string {
    let result = code;
    result = result.replace(/!\s*(\w+)\s*=\s*\{\}/g, '!$1');
    result = result.replace(/!\s*(\w+)\s*=\s*\[\]/g, '!$1');
    result = result.replace(/=\s*\{\}s\s*,/g, '= {},');
    result = result.replace(/=\s*\{\}\.(\w+)/g, '= ({}).$1');
    result = result.replace(/=\s*\[\]\.(\w+)/g, '= ([]).$1');
    return result;
  }

  static fixAdjacentJSX(code: string): string {
    return code.replace(
      /return\s*\(\s*(<\w+[^>]*>[\s\S]*?<\/\w+>)\s+(<\w+[^>]*>[\s\S]*?<\/\w+>)/g,
      'return (<>$1$2</>)',
    );
  }

  static fixComponentPlaceholders(code: string): string {
    return code.replace(/const\s+([A-Z]\w+)\s*=\s*\[\]\s*;?\s*\n/g, '');
  }

  static fixTypoDestructuring(code: string): string {
    return code.replace(/=\s*\{\}s\s*([,}])/g, '= {}$1');
  }

  static normalizeImportsExports(code: string): string {
    let result = code;
    result = result.replace(/import\s+.*?from\s+['"].*?['"];?\s*\n?/g, '');
    result = result.replace(/import\s+['"].*?['"];?\s*\n?/g, '');
    result = result.replace(/export\s+default\s+/g, '');
    result = result.replace(/export\s+/g, '');
    return result;
  }

  static addMissingVariableFallbacks(code: string): string {
    const commonVars = [
      'products',
      'mockProducts',
      'productList',
      'items',
      'data',
      'mockData',
      'list',
      'todos',
      'tasks',
    ];
    let fallbacks = '';
    for (const varName of commonVars) {
      const usedRegex = new RegExp(`\\b${varName}\\b`);
      const definedRegex = new RegExp(`(const|let|var)\\s+${varName}\\s*=`);
      if (usedRegex.test(code) && !definedRegex.test(code)) {
        fallbacks += `if (typeof ${varName} === 'undefined') { var ${varName} = []; }\n`;
      }
    }
    return fallbacks + code;
  }

  /** Unsplash placeholder (single stable image) so we use Unsplash not Picsum. */
  private static unsplashPlaceholderUrl(width: number, height: number): string {
    const w = Math.min(1200, Math.max(48, width));
    const h = Math.min(800, Math.max(48, height));
    return `https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=${w}&h=${h}&fit=crop`;
  }

  static fixBrokenImageUrls(code: string): string {
    const brokenDomains = [
      'imgur.com',
      'i.imgur.com',
      'example.com',
      'placeholder.com',
      'via.placeholder.com',
    ];
    let result = code;
    for (const domain of brokenDomains) {
      const regex = new RegExp(
        `https?://(www\\.)?${domain.replace('.', '\\.')}/[^\\s"')]*`,
        'g',
      );
      result = result.replace(regex, (match) => {
        const widthMatch = match.match(/(\d+)x(\d+)/);
        if (widthMatch) {
          return CodeSanitizer.unsplashPlaceholderUrl(parseInt(widthMatch[1], 10), parseInt(widthMatch[2], 10));
        }
        return CodeSanitizer.unsplashPlaceholderUrl(800, 600);
      });
    }
    return result;
  }

  /**
   * Broad check (e.g. for raw API response). May false-positive on code containing "placeholder", "TODO:", etc.
   */
  static detectRefusal(code: string): boolean {
    const refusalPatterns = [
      /I can't help/i,
      /I cannot assist/i,
      /I'm not able to/i,
      /against my guidelines/i,
      /placeholder/i,
      /TODO:/g,
      /FIXME:/g,
    ];
    return refusalPatterns.some((pattern) => pattern.test(code));
  }

  /**
   * Strict check for parsed component/main code. Only flags clear refusal messages, not code that
   * contains words like "placeholder" (e.g. in JSX) or "TODO:" in comments.
   */
  static detectRefusalStrict(code: string): boolean {
    if (!code || typeof code !== 'string') return false;
    const refusalPhrases = [
      "i'm sorry",
      'i am sorry',
      "i'm not able to assist",
      'i cannot assist',
      "i can't assist",
      'not able to assist',
      'against my guidelines',
    ];
    const lower = code.toLowerCase();
    const hasRefusalPhrase = refusalPhrases.some((p) => lower.includes(p));
    if (!hasRefusalPhrase) return false;
    // Only treat as refusal if content looks like a message: very short or phrase near start
    const trim = code.trim();
    if (trim.length < 400) return true;
    const start = lower.slice(0, 200);
    return refusalPhrases.some((p) => start.includes(p));
  }

  static escapeForScript(code: string): string {
    return code.replace(/\\/g, '\\\\').replace(/`/g, '__BACKTICK_PLACEHOLDER__');
  }

  static restoreEscaped(code: string): string {
    return code.replace(/__BACKTICK_PLACEHOLDER__/g, '`');
  }
}
