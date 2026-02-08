/**
 * Updated WebsitePreview.tsx - Integration with CodeSanitizer
 * Replace your loadContent function with this
 */

import { CodeSanitizer } from './code-sanitizer';

export function WebsitePreview({ website, websiteName }) {
  
  const loadContent = () => {
    const { components, viteConfig, html, css, js } = website;
    
    // React path with components
    if (components?.length > 0) {
      return buildReactPreview(components, viteConfig, websiteName);
    }
    
    // Legacy path
    return buildLegacyPreview(html, css, js, websiteName);
  };

  const buildReactPreview = (components, viteConfig, websiteName) => {
    // 1. Process each component with full sanitization
    const processedComponents = components.map(component => {
      let code = CodeSanitizer.sanitizeAll(component.code);
      
      // Remove imports/exports for IIFE
      code = CodeSanitizer.normalizeImportsExports(code);
      
      return {
        ...component,
        code: code
      };
    });

    // 2. Process main code
    let mainCode = viteConfig?.mainJsx || this.generateDefaultMain(components);
    mainCode = CodeSanitizer.sanitizeAll(mainCode);
    mainCode = CodeSanitizer.normalizeImportsExports(mainCode);
    
    // Remove component placeholders
    for (const comp of components) {
      const regex = new RegExp(`const\\s+${comp.name}\\s*=\\s*\\[\\]\\s*;?`, 'g');
      mainCode = mainCode.replace(regex, '');
    }

    // 3. Build component definitions (wrapped in IIFEs)
    const componentDefs = processedComponents
      .map(comp => {
        return `
// Component: ${comp.name}
(function() {
  ${comp.code}
  if (typeof ${comp.name} !== 'undefined') {
    window.${comp.name} = ${comp.name};
  }
})();
`.trim();
      })
      .join('\n\n');

    // 4. Extract used variables and add fallbacks
    const usedVars = this.extractUsedVariables(mainCode);
    const fallbacks = usedVars
      .map(varName => `if (typeof ${varName} === 'undefined') { var ${varName} = []; }`)
      .join('\n');

    // 5. Build final script
    const finalScript = `
${fallbacks}

${componentDefs}

// Main application code
${mainCode}
`.trim();

    // 6. Escape for embedding
    const escapedScript = CodeSanitizer.escapeForScript(finalScript);

    // 7. Build HTML
    const styleCss = viteConfig?.styleCss || '';
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(websiteName)}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>${this.escapeHtml(styleCss)}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; }
    #root { width: 100%; min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script type="text/babel">
    ${CodeSanitizer.restoreEscaped(escapedScript)}
  </script>
  
  <script>
    // Error boundary
    window.addEventListener('error', (e) => {
      console.error('Preview error:', e.error);
      const root = document.getElementById('root');
      if (root && !root.innerHTML) {
        root.innerHTML = '<div style="padding: 20px; color: #e74c3c;"><h3>Preview Error</h3><p>' + e.message + '</p></div>';
      }
    });
  </script>
</body>
</html>
`.trim();

    return html;
  };

  const buildLegacyPreview = (html, css, js, websiteName) => {
    let finalHtml = html || '<div id="root"></div>';
    let finalCss = css || '';
    let finalJs = js || '';
    
    // Sanitize JS
    finalJs = CodeSanitizer.sanitizeAll(finalJs);
    
    // Fix image URLs
    finalHtml = CodeSanitizer.fixBrokenImageUrls(finalHtml);
    finalCss = CodeSanitizer.fixBrokenImageUrls(finalCss);
    
    // Inject style if missing
    if (!finalHtml.includes('<style>') && finalCss) {
      finalHtml = finalHtml.replace(
        '</head>',
        `<style>${finalCss}</style></head>`
      );
    }
    
    // Inject script if missing
    if (!finalHtml.includes('<script>') && finalJs) {
      finalHtml = finalHtml.replace(
        '</body>',
        `<script>${finalJs}</script></body>`
      );
    }
    
    return finalHtml;
  };

  const extractUsedVariables = (code: string): string[] => {
    const commonVars = [
      'products', 'mockProducts', 'productList', 'items',
      'data', 'mockData', 'list', 'todos', 'tasks',
      'cart', 'user', 'settings'
    ];
    
    return commonVars.filter(varName => {
      const usedRegex = new RegExp(`\\b${varName}\\b`);
      const definedRegex = new RegExp(`(const|let|var)\\s+${varName}\\s*=`);
      return usedRegex.test(code) && !definedRegex.test(code);
    });
  };

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const generateDefaultMain = (components: any[]): string => {
    const firstComponent = components[0]?.name || 'App';
    
    return `
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<${firstComponent} />);
`.trim();
  };

  // Use the loadContent function in your iframe doc.write
  const loadIframeContent = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    
    try {
      const content = loadContent();
      doc.open();
      doc.write(content);
      doc.close();
    } catch (error) {
      console.error('Error loading preview:', error);
      doc.open();
      doc.write(`
        <div style="padding: 20px; color: #e74c3c;">
          <h3>Preview Error</h3>
          <p>${error.message}</p>
        </div>
      `);
      doc.close();
    }
  };

  // ... rest of your component
}
