/**
 * Pre-preview validator
 * Run this BEFORE building the iframe to catch issues early
 */

export class PreviewValidator {
  
  /**
   * Validate website structure before preview
   * Returns { valid: boolean, errors: string[] }
   */
  static validate(website: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check basic structure
    if (!website.components?.length && !website.html) {
      errors.push('No components or HTML found');
      return { valid: false, errors };
    }
    
    // Validate components
    if (website.components) {
      const componentErrors = this.validateComponents(website.components);
      errors.push(...componentErrors);
    }
    
    // Validate main code
    if (website.viteConfig?.mainJsx) {
      const mainErrors = this.validateMainCode(
        website.viteConfig.mainJsx,
        website.components || []
      );
      errors.push(...mainErrors);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate component array
   */
  private static validateComponents(components: any[]): string[] {
    const errors: string[] = [];
    
    for (const component of components) {
      // Check component has required fields
      if (!component.name) {
        errors.push('Component missing name');
        continue;
      }
      
      if (!component.code) {
        errors.push(`Component ${component.name} has no code`);
        continue;
      }
      
      // Check for syntax issues
      const syntaxErrors = this.checkSyntax(component.code, component.name);
      errors.push(...syntaxErrors);
      
      // Check component is actually defined
      if (!this.hasComponentDefinition(component.code, component.name)) {
        errors.push(`Component ${component.name} is not properly defined in its code`);
      }
    }
    
    // Check for duplicate names
    const names = components.map(c => c.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate component names: ${duplicates.join(', ')}`);
    }
    
    return errors;
  }

  /**
   * Validate main code
   */
  private static validateMainCode(mainCode: string, components: any[]): string[] {
    const errors: string[] = [];
    
    // Check syntax
    const syntaxErrors = this.checkSyntax(mainCode, 'main.jsx');
    errors.push(...syntaxErrors);
    
    // Check that components used in main are defined
    const usedComponents = this.extractUsedComponents(mainCode);
    const definedComponents = components.map(c => c.name);
    
    for (const used of usedComponents) {
      if (!definedComponents.includes(used)) {
        errors.push(`Component <${used}> used in main but not defined`);
      }
    }
    
    // Check for render call
    if (!this.hasRenderCall(mainCode)) {
      errors.push('Main code missing render call (ReactDOM.render or createRoot)');
    }
    
    return errors;
  }

  /**
   * Check code for common syntax errors
   */
  private static checkSyntax(code: string, filename: string): string[] {
    const errors: string[] = [];
    
    // Check for template literals in JSX attributes (common error)
    if (/\{\s*`[^`]*\$\{/.test(code)) {
      errors.push(`${filename}: Template literals in JSX attributes (use concatenation instead)`);
    }
    
    // Check for invalid assignments
    if (/!\s*\w+\s*=\s*[\{\[]/.test(code)) {
      errors.push(`${filename}: Invalid assignment (e.g., !x = {})`);
    }
    
    // Check for typo destructuring
    if (/=\s*\{\}s[,\s]/.test(code)) {
      errors.push(`${filename}: Typo in destructuring (= {}s instead of = {})`);
    }
    
    // Check for unescaped backticks that would break embedding
    const backtickCount = (code.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      errors.push(`${filename}: Unmatched backticks (odd count: ${backtickCount})`);
    }
    
    return errors;
  }

  /**
   * Check if component is defined in code
   */
  private static hasComponentDefinition(code: string, name: string): boolean {
    const patterns = [
      new RegExp(`function\\s+${name}\\s*\\(`),
      new RegExp(`const\\s+${name}\\s*=\\s*\\(`),
      new RegExp(`const\\s+${name}\\s*=\\s*function`),
      new RegExp(`class\\s+${name}\\s+extends`)
    ];
    
    return patterns.some(pattern => pattern.test(code));
  }

  /**
   * Extract component names used in JSX
   */
  private static extractUsedComponents(code: string): string[] {
    const components = new Set<string>();
    
    // Match <ComponentName ... />
    const selfClosingRegex = /<([A-Z]\w+)[^>]*\/>/g;
    let match;
    while ((match = selfClosingRegex.exec(code)) !== null) {
      components.add(match[1]);
    }
    
    // Match <ComponentName>...</ComponentName>
    const openingRegex = /<([A-Z]\w+)[^>]*>/g;
    while ((match = openingRegex.exec(code)) !== null) {
      components.add(match[1]);
    }
    
    return Array.from(components);
  }

  /**
   * Check if code has a render call
   */
  private static hasRenderCall(code: string): boolean {
    return /ReactDOM\.(render|createRoot)/.test(code) ||
           /root\.render/.test(code);
  }

  /**
   * Auto-fix validation errors if possible
   * Returns { fixed: boolean, code: string, unfixableErrors: string[] }
   */
  static autoFix(website: any): { fixed: boolean; website: any; unfixableErrors: string[] } {
    const validation = this.validate(website);
    
    if (validation.valid) {
      return { fixed: false, website, unfixableErrors: [] };
    }
    
    let fixed = { ...website };
    const unfixableErrors: string[] = [];
    
    // Try to fix missing render
    if (validation.errors.some(e => e.includes('missing render call'))) {
      if (fixed.viteConfig && fixed.components?.length > 0) {
        const firstComponent = fixed.components[0].name;
        fixed.viteConfig.mainJsx = `
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<${firstComponent} />);
`.trim();
      }
    }
    
    // Try to generate missing components
    for (const error of validation.errors) {
      const match = error.match(/Component <(\w+)> used in main but not defined/);
      if (match) {
        const componentName = match[1];
        fixed.components = fixed.components || [];
        fixed.components.push({
          name: componentName,
          path: `components/${componentName}.jsx`,
          code: `
function ${componentName}() {
  return <div>${componentName} Component</div>;
}
`.trim(),
          language: 'jsx'
        });
      }
    }
    
    // Re-validate
    const revalidation = this.validate(fixed);
    
    return {
      fixed: revalidation.valid,
      website: fixed,
      unfixableErrors: revalidation.errors
    };
  }
}
