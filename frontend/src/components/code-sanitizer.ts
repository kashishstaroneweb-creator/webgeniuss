/**
 * Comprehensive code sanitizer for v0-generated code
 * Fixes all known preview breaking patterns
 */

export class CodeSanitizer {
  /**
   * Master sanitization - run on ALL code (includes import/export normalization and variable fallbacks)
   */
  static sanitizeAll(code: string): string {
    let sanitized = code;
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
   * Sanitize for preview without injecting variable fallbacks (frontend adds its own with PascalCase handling)
   */
  static sanitizeForPreview(code: string): string {
    let sanitized = code;
    sanitized = this.fixTemplateLiteralsInJSX(sanitized);
    sanitized = this.fixDollarSignsInJSX(sanitized);
    sanitized = this.fixInvalidAssignments(sanitized);
    sanitized = this.fixAdjacentJSX(sanitized);
    sanitized = this.fixComponentPlaceholders(sanitized);
    sanitized = this.fixTypoDestructuring(sanitized);
    sanitized = this.normalizeImportsExports(sanitized);
    sanitized = this.fixBrokenImageUrls(sanitized);
    return sanitized;
  }

  static fixTemplateLiteralsInJSX(code: string): string {
    let result = code;
    let maxIterations = 10;
    let iterations = 0;
    const pattern = /\{`([^`]*\$\{[^}]+\}[^`]*)`\}/g;
    while (pattern.test(result) && iterations < maxIterations) {
      result = result.replace(pattern, (_match: string, template: string) => {
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
    return code.replace(/>\s*\$\{([^}]+)\}\s*</g, (_match: string, expr: string) => {
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
      'products', 'mockProducts', 'productList', 'items',
      'data', 'mockData', 'list', 'todos', 'tasks',
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

  static fixBrokenImageUrls(code: string): string {
    const brokenDomains = [
      'imgur.com', 'i.imgur.com',
      'example.com', 'placeholder.com', 'via.placeholder.com',
    ];
    let result = code;
    for (const domain of brokenDomains) {
      const regex = new RegExp(
        `https?://(www\\.)?${domain.replace('.', '\\.')}/[^\\s"')]*`,
        'g',
      );
      result = result.replace(regex, (match: string) => {
        const widthMatch = match.match(/(\d+)x(\d+)/);
        if (widthMatch) return `https://picsum.photos/${widthMatch[1]}/${widthMatch[2]}`;
        return 'https://picsum.photos/800/600';
      });
    }
    return result;
  }

  static detectRefusal(code: string): boolean {
    return [
      /I can't help/i, /I cannot assist/i, /I'm not able to/i,
      /against my guidelines/i, /placeholder/i, /TODO:/g, /FIXME:/g,
    ].some((p) => p.test(code));
  }

  static escapeForScript(code: string): string {
    return code.replace(/\\/g, '\\\\').replace(/`/g, '__BACKTICK_PLACEHOLDER__');
  }

  static restoreEscaped(code: string): string {
    return code.replace(/__BACKTICK_PLACEHOLDER__/g, '`');
  }
}
