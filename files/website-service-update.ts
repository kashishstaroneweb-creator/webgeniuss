/**
 * Updated website.service.ts - Integration with CodeSanitizer
 * Add this to your existing service
 */

import { CodeSanitizer } from './code-sanitizer';

export class WebsiteService {
  
  async generateWebsite(userId: string, prompt: string, websiteName: string) {
    // ... existing code for API call ...
    
    // After parsing v0 response:
    let websiteCode = await this.parseV0Response(responseContent);
    
    // Normalize structure (files → components)
    if (websiteCode.files) {
      websiteCode = this.convertV0FilesToStructure(websiteCode);
    }
    
    // **NEW: Comprehensive sanitization**
    websiteCode = this.sanitizeWebsiteCode(websiteCode);
    
    // Check for refusals
    if (this.hasRefusal(websiteCode)) {
      throw new Error('AI generated placeholder or refusal content. Please try again.');
    }
    
    // Save to database
    // ... rest of your code ...
  }

  /**
   * Apply comprehensive sanitization to all code
   */
  private sanitizeWebsiteCode(websiteCode: any): any {
    const sanitized = { ...websiteCode };
    
    // Sanitize each component
    if (sanitized.components) {
      sanitized.components = sanitized.components.map(component => ({
        ...component,
        code: CodeSanitizer.sanitizeAll(component.code)
      }));
    }
    
    // Sanitize viteConfig code
    if (sanitized.viteConfig) {
      if (sanitized.viteConfig.mainJsx) {
        sanitized.viteConfig.mainJsx = this.sanitizeMainCode(
          sanitized.viteConfig.mainJsx,
          sanitized.components || []
        );
      }
      if (sanitized.viteConfig.mainJs) {
        sanitized.viteConfig.mainJs = CodeSanitizer.sanitizeAll(
          sanitized.viteConfig.mainJs
        );
      }
      if (sanitized.viteConfig.styleCss) {
        sanitized.viteConfig.styleCss = CodeSanitizer.fixBrokenImageUrls(
          sanitized.viteConfig.styleCss
        );
      }
    }
    
    // Sanitize legacy code
    if (sanitized.html) {
      sanitized.html = CodeSanitizer.fixBrokenImageUrls(sanitized.html);
    }
    if (sanitized.css) {
      sanitized.css = CodeSanitizer.fixBrokenImageUrls(sanitized.css);
    }
    if (sanitized.js) {
      sanitized.js = CodeSanitizer.sanitizeAll(sanitized.js);
    }
    
    return sanitized;
  }

  /**
   * Sanitize main.jsx and remove component placeholders
   */
  private sanitizeMainCode(mainCode: string, components: any[]): string {
    let sanitized = CodeSanitizer.sanitizeAll(mainCode);
    
    // Remove placeholder definitions for actual components
    const componentNames = components.map(c => c.name);
    for (const name of componentNames) {
      const placeholderRegex = new RegExp(
        `const\\s+${name}\\s*=\\s*\\[\\]\\s*;?\\s*\\n?`,
        'g'
      );
      sanitized = sanitized.replace(placeholderRegex, '');
    }
    
    return sanitized;
  }

  /**
   * Check if code contains refusals or placeholders
   */
  private hasRefusal(websiteCode: any): boolean {
    const codesToCheck = [];
    
    if (websiteCode.components) {
      codesToCheck.push(...websiteCode.components.map(c => c.code));
    }
    if (websiteCode.viteConfig?.mainJsx) {
      codesToCheck.push(websiteCode.viteConfig.mainJsx);
    }
    
    return codesToCheck.some(code => CodeSanitizer.detectRefusal(code));
  }
}
