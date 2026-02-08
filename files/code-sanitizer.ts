/**
 * Comprehensive code sanitizer for v0-generated code
 * Fixes all known preview breaking patterns
 */

export class CodeSanitizer {
  
  /**
   * Master sanitization - run on ALL code before preview
   */
  static sanitizeAll(code: string): string {
    let sanitized = code;
    
    // Run all transforms in order (order matters!)
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
   * Fix template literals in JSX attributes
   * {`text ${expr}`} → {'text ' + (expr)}
   */
  static fixTemplateLiteralsInJSX(code: string): string {
    let result = code;
    let maxIterations = 10;
    let iterations = 0;
    
    // Pattern: {`...${...}...`}
    const pattern = /\{`([^`]*\$\{[^}]+\}[^`]*)`\}/g;
    
    while (pattern.test(result) && iterations < maxIterations) {
      result = result.replace(pattern, (match, template) => {
        // Convert template literal to concatenation
        let parts = [];
        let current = '';
        let depth = 0;
        let inExpr = false;
        
        for (let i = 0; i < template.length; i++) {
          const char = template[i];
          const next = template[i + 1];
          
          if (char === '$' && next === '{' && !inExpr) {
            if (current) parts.push(`'${current}'`);
            current = '';
            inExpr = true;
            depth = 1;
            i++; // skip {
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
        
        if (current) parts.push(`'${current}'`);
        
        return `{${parts.join(' + ')}}`;
      });
      
      pattern.lastIndex = 0;
      iterations++;
    }
    
    return result;
  }

  /**
   * Fix ${expr} in JSX text (outside attributes)
   * <div>${expr}</div> → <div>{'$' + expr}</div>
   */
  static fixDollarSignsInJSX(code: string): string {
    return code.replace(/>\s*\$\{([^}]+)\}\s*</g, (match, expr) => {
      return `>{'$' + (${expr})}<`;
    });
  }

  /**
   * Fix invalid assignments: !x = {}, !x = [], x = {}.prop
   */
  static fixInvalidAssignments(code: string): string {
    let result = code;
    
    // !x = {} or !x = []
    result = result.replace(/!\s*(\w+)\s*=\s*\{\}/g, '!$1');
    result = result.replace(/!\s*(\w+)\s*=\s*\[\]/g, '!$1');
    
    // = {}s, (typo in destructuring)
    result = result.replace(/=\s*\{\}s\s*,/g, '= {},');
    
    // x = {}.someProperty (should be x = ({}).someProperty)
    result = result.replace(/=\s*\{\}\.(\w+)/g, '= ({}).$1');
    result = result.replace(/=\s*\[\]\.(\w+)/g, '= ([]).$1');
    
    return result;
  }

  /**
   * Fix adjacent JSX elements (need wrapper)
   * <div/><div/> → <><div/><div/></>
   */
  static fixAdjacentJSX(code: string): string {
    // Look for return statements with adjacent JSX
    return code.replace(
      /return\s*\(\s*(<\w+[^>]*>[\s\S]*?<\/\w+>)\s+(<\w+[^>]*>[\s\S]*?<\/\w+>)/g,
      'return (<>$1$2</>)'
    );
  }

  /**
   * Remove placeholder component definitions
   * const ComponentName = []; (when ComponentName is a real component)
   */
  static fixComponentPlaceholders(code: string): string {
    // Remove lines like: const Header = [];
    return code.replace(/const\s+([A-Z]\w+)\s*=\s*\[\]\s*;?\s*\n/g, '');
  }

  /**
   * Fix common typos in destructuring defaults
   */
  static fixTypoDestructuring(code: string): string {
    // { product = {}s } → { product = {} }
    return code.replace(/=\s*\{\}s\s*([,}])/g, '= {}$1');
  }

  /**
   * Normalize imports/exports for IIFE wrapping
   */
  static normalizeImportsExports(code: string): string {
    let result = code;
    
    // Remove all import statements
    result = result.replace(/import\s+.*?from\s+['"].*?['"];?\s*\n?/g, '');
    result = result.replace(/import\s+['"].*?['"];?\s*\n?/g, '');
    
    // Convert export default to assignment
    result = result.replace(/export\s+default\s+/g, '');
    
    // Remove other exports
    result = result.replace(/export\s+/g, '');
    
    return result;
  }

  /**
   * Add fallbacks for commonly used undefined variables
   */
  static addMissingVariableFallbacks(code: string): string {
    const commonVars = [
      'products', 'mockProducts', 'productList', 'items',
      'data', 'mockData', 'list', 'todos', 'tasks'
    ];
    
    let fallbacks = '';
    
    for (const varName of commonVars) {
      // Check if variable is used but not defined
      const usedRegex = new RegExp(`\\b${varName}\\b`);
      const definedRegex = new RegExp(`(const|let|var)\\s+${varName}\\s*=`);
      
      if (usedRegex.test(code) && !definedRegex.test(code)) {
        fallbacks += `if (typeof ${varName} === 'undefined') { var ${varName} = []; }\n`;
      }
    }
    
    return fallbacks + code;
  }

  /**
   * Replace broken image URLs
   */
  static fixBrokenImageUrls(code: string): string {
    const brokenDomains = [
      'imgur.com', 'i.imgur.com',
      'example.com', 'placeholder.com',
      'via.placeholder.com'
    ];
    
    let result = code;
    
    for (const domain of brokenDomains) {
      const regex = new RegExp(`https?://(www\\.)?${domain.replace('.', '\\.')}/[^\\s"')]*`, 'g');
      result = result.replace(regex, (match) => {
        // Extract dimensions if possible
        const widthMatch = match.match(/(\d+)x(\d+)/);
        if (widthMatch) {
          return `https://picsum.photos/${widthMatch[1]}/${widthMatch[2]}`;
        }
        return 'https://picsum.photos/800/600';
      });
    }
    
    return result;
  }

  /**
   * Detect and handle refusals from v0
   */
  static detectRefusal(code: string): boolean {
    const refusalPatterns = [
      /I can't help/i,
      /I cannot assist/i,
      /I'm not able to/i,
      /against my guidelines/i,
      /placeholder/i,
      /TODO:/g,
      /FIXME:/g
    ];
    
    return refusalPatterns.some(pattern => pattern.test(code));
  }

  /**
   * Wrap component code in IIFE
   */
  static wrapInIIFE(componentName: string, code: string): string {
    return `
(function() {
  ${code}
  if (typeof ${componentName} === 'undefined') {
    window.${componentName} = ${componentName};
  }
})();
`.trim();
  }

  /**
   * Escape code for embedding in script tag
   */
  static escapeForScript(code: string): string {
    return code
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '__BACKTICK_PLACEHOLDER__');
  }

  /**
   * Restore escaped code
   */
  static restoreEscaped(code: string): string {
    return code.replace(/__BACKTICK_PLACEHOLDER__/g, '`');
  }
}
