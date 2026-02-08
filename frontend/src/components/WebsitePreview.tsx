import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import Button from './ui/Button';

interface Component {
  name: string;
  type: string;
  path: string;
  code: string;
  language: string;
}

interface ViteConfig {
  packageJson?: string;
  viteConfig?: string;
  indexHtml?: string;
  mainJs?: string;
  mainJsx?: string;
  styleCss?: string;
}

interface WebsitePreviewProps {
  html?: string;
  css?: string;
  js?: string;
  components?: Component[];
  viteConfig?: ViteConfig;
  websiteName?: string;
  prompt?: string;
  onClose?: () => void;
  isModal?: boolean;
  className?: string;
}

// Known globals and reserved names that must never get a fallback definition
const PREVIEW_KNOWN_GLOBALS = new Set([
  'React', 'ReactDOM', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer', 'createContext',
  'createElement', 'Fragment', 'StrictMode', 'Component', 'PureComponent', 'Children', 'cloneElement', 'isValidElement',
  'document', 'window', 'console', 'fetch', 'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Map', 'Set', 'Promise',
  'localStorage', 'sessionStorage',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Symbol', 'RegExp', 'Error', 'Math', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURIComponent', 'encodeURIComponent',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'length', 'map', 'filter', 'forEach', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'indexOf', 'find', 'findIndex', 'includes',
  'keys', 'values', 'entries', 'reduce', 'some', 'every', 'flat', 'join', 'concat', 'sort', 'reverse',
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'await',
]);

/**
 * Wrap adjacent JSX elements (e.g. in object values like icons) in a React fragment so Babel doesn't throw
 * "Adjacent JSX elements must be wrapped in an enclosing tag".
 */
function wrapAdjacentJsxInFragment(code: string): string {
  // Object property value that is 2+ adjacent self-closing JSX tags (e.g. users: <path .../><circle .../>,)
  const adjacentJsxInObject = /:\s*((?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/>\s*){2,})(\s*)(,|\})/g;
  return code.replace(adjacentJsxInObject, ': <>$1</>$2$3');
}

/**
 * Find identifiers that are used in the script but not declared (and not components/globals).
 * These get an empty-array fallback so the preview doesn't throw ReferenceError for any data variable.
 */
function getUsedButUndeclaredIdentifiers(
  fullScript: string,
  componentNames: string[],
): string[] {
  const componentSet = new Set(componentNames.map((n) => n.trim()).filter(Boolean));
  const componentLower = new Set(componentNames.map((n) => n.trim().toLowerCase()));

  const declared = new Set<string>();
  const used = new Set<string>();

  const idRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;

  // Declared: const/let/var name =, function name(, and destructuring const { a, b } / const [ a, b ]
  const declPatterns = [
    /\b(?:const|let|var)\s+(\w+)\s*[=\[{]/g,
    /\bfunction\s+(\w+)\s*\(/g,
    /\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g,
    /\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g,
  ];
  for (const re of declPatterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(fullScript)) !== null) {
      if (m[1] !== undefined) {
        if (m[1].includes(',')) {
          m[1].split(',').forEach((s: string) => {
            const id = (s.split('=')[0].trim().replace(/[:{}]/g, '').trim() || '').trim();
            if (id && !id.startsWith('...')) declared.add(id);
          });
        } else {
          declared.add(m[1]);
        }
      }
    }
  }
  // Destructuring: extract identifiers from { a, b, c } and [ a, b ]
  const destrObj = fullScript.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g);
  for (const d of destrObj) {
    d[1].split(',').forEach((s: string) => {
      const id = (s.split(':')[0].split('=')[0].trim().replace(/[{}]/g, '') || '').trim();
      if (id && !id.startsWith('...')) declared.add(id);
    });
  }
  const destrArr = fullScript.matchAll(/\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g);
  for (const d of destrArr) {
    d[1].split(',').forEach((s: string) => {
      const id = (s.split('=')[0].trim().replace(/[\[\]]/g, '') || '').trim();
      if (id && !id.startsWith('...')) declared.add(id);
    });
  }

  let tok;
  while ((tok = idRegex.exec(fullScript)) !== null) {
    used.add(tok[1]);
  }

  const needsFallback: string[] = [];
  const seen = new Set<string>();
  for (const id of used) {
    if (seen.has(id)) continue;
    if (declared.has(id)) continue;
    if (PREVIEW_KNOWN_GLOBALS.has(id)) continue;
    if (componentSet.has(id) || componentLower.has(id.toLowerCase())) continue;
    if (id.length < 2) continue;
    seen.add(id);
    needsFallback.push(id);
  }
  return needsFallback.sort();
}

const WebsitePreview = ({ html, css, js, components, viteConfig, websiteName, prompt, onClose, isModal = false, className }: WebsitePreviewProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Function to load content into iframe (memoized with useCallback)
  const loadIframeContent = useCallback(() => {
    if (iframeRef.current) {
      // Wait for iframe to be ready
      const iframe = iframeRef.current;
      
      const loadContent = () => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!doc) return;
          
          let content = '';

          // Escape so generated code never breaks our template literals. For HTML (title/style/body) use \` → one backtick in output.
          const escapeForEmbed = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
          // Placeholder for backticks in script content; restored to real ` before doc.write so Babel sees valid template literals.
          // Only escape backticks — template interpolation inserts values as-is, so do NOT double backslashes or \' becomes \\' and breaks parsing (e.g. "Queen's Gambit").
          const SCRIPT_BT = '__WEBPREVIEW_BACKTICK__';
          const escapeForEmbedInScript = (s: string) => String(s).replace(/`/g, SCRIPT_BT);
          const escapeBackslashOnly = (s: string) => String(s).replace(/\\/g, '\\\\');

          // Rewrite JSX attribute template literals to string concatenation so we never emit backticks (avoids Babel/Unicode escape issues). e.g. className={`header__nav ${x}`} → className={'header__nav ' + (x)}
          const transformJsxAttributeTemplateLiterals = (code: string): string => {
            // Match {\`...\`} or {\`...\`} with [\s\S]*? to allow newlines; run in loop to catch all occurrences
            const re = /\{\s*`([\s\S]*?)`\s*\}/g;
            let prev = '';
            while (prev !== code) {
              prev = code;
              code = code.replace(re, (match, content) => {
                if (!content.includes('${')) return match;
                const parts: { type: 'str'; value: string } | { type: 'expr'; value: string }[] = [];
                let rest = content;
                while (rest.length > 0) {
                  const i = rest.indexOf('${');
                  if (i === -1) {
                    if (rest.length > 0) parts.push({ type: 'str', value: rest });
                    break;
                  }
                  if (i > 0) parts.push({ type: 'str', value: rest.slice(0, i) });
                  let depth = 0;
                  let j = i + 2;
                  for (; j < rest.length; j++) {
                    const c = rest[j];
                    if (c === '{') depth++;
                    else if (c === '}') {
                      if (depth === 0) break;
                      depth--;
                    }
                  }
                  parts.push({ type: 'expr', value: rest.slice(i + 2, j).trim() });
                  rest = rest.slice(j + 1);
                }
                let out = '{';
                parts.forEach((p, idx) => {
                  if (p.type === 'str') {
                    const escaped = p.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    out += "'" + escaped + "'";
                  } else {
                    out += '(' + p.value + ')';
                  }
                  if (idx < parts.length - 1) out += ' + ';
                });
                out += '}';
                return out;
              });
            }
            return code;
          };

          // Normalize over-escaped apostrophes in string literals so Babel never sees \\' or \\\\' (e.g. "Queen's Gambit"). One place that fixes all sources.
          const normalizeEscapedQuotes = (code: string): string => {
            if (!code || typeof code !== 'string') return code;
            return code.replace(/(\\)+'/g, "\\'"); // \', \\', \\\'... → exactly \'
          };

          // Remove one top-level "function App() { ... }" so we don't redeclare App when componentDefinitions already has "const App = (function() {...})();"
          const stripTopLevelFunctionApp = (code: string): string => {
            const match = code.match(/\bfunction\s+App\s*\([^)]*\)\s*\{/);
            if (!match) return code;
            const start = code.indexOf(match[0]);
            let depth = 1;
            let i = start + match[0].length;
            while (i < code.length && depth > 0) {
              const c = code[i];
              if (c === '{' && code[i - 1] !== '\\') depth++;
              else if (c === '}' && code[i - 1] !== '\\') depth--;
              i++;
            }
            const end = depth === 0 ? i : code.length;
            return (code.slice(0, start).trimEnd() + '\n\n' + code.slice(end).trimStart()).trim();
          };

          // Remove misplaced </> (and optional )) that appears between two closing tags so Babel doesn't throw "Expected corresponding JSX closing tag for <main>".
          const fixMisplacedFragmentClose = (code: string): string => {
            if (!code || typeof code !== 'string') return code;
            // </tag></>) newline </otherTag> → </tag> newline </otherTag> (stray </> and ) removed; ); will appear later)
            return code.replace(/(<\/\w+>)<\/>\)\s*(\n\s*)(<\/\w+>)/g, '$1$2$3');
          };

          // Fix "Invalid left-hand side in assignment": !x = {} / !x = [] → !x; x = {}.property → (x || {}).property
          // Fix AI typo in destructuring: product = {}s, → product = {}, (stray letter after {} or [] before , ) } or ])
          const sanitizeInvalidAssignment = (code: string): string => {
            if (!code || typeof code !== 'string') return code;
            return code
              .replace(/!\s*(\w+)\s*=\s*\{\s*\}/g, '!$1')
              .replace(/!\s*(\w+)\s*=\s*\[\s*\]/g, '!$1')
              .replace(/(\w+)\s*=\s*\{\s*\}\s*\./g, '($1 || {}).')
              .replace(/(\w+)\s*=\s*\[\s*\]\s*\./g, '($1 || []).')
              .replace(/=\s*\{\s*\}\s*([a-zA-Z])(?=\s*[,)\}\]])/g, '= {} ')
              .replace(/=\s*\[\s*\]\s*([a-zA-Z])(?=\s*[,)\}\]])/g, '= [] ');
          };
          
          // Check if we have component-based structure
          if (components && components.length > 0) {
            // Check if components use React (JSX) or vanilla JS
            const usesReact = components.some(c => 
              c.language === 'jsx' || 
              c.code.includes('import React') || 
              c.code.includes('from \'react\'') ||
              c.code.includes('<') && c.code.includes('className=')
            );
            
            if (usesReact) {
              // React components - use React CDN with Babel
              const styleCss = viteConfig?.styleCss || '';
              const mainJsx = viteConfig?.mainJsx || viteConfig?.mainJs || '';
              
              // Process component code - remove ES6 imports/exports and convert to global scope
              // Fix JSX ${expr} → {'$' + expr} so Babel doesn't treat ${ as template literal (Unterminated template)
              const sanitizeDollarInJsx = (code: string) =>
                code.replace(/>([^<]*?)\$\{([^}]+)\}([^<]*?)</g, (_m: string, before: string, expr: string, after: string) =>
                  `>${before}{'$' + ${expr}}${after}<`
                );

              const processedComponents = components
                .filter(c => c.language === 'jsx' || c.language === 'js' || c.language === 'tsx' || (!c.language && (/\\.(jsx|tsx)$/.test(c.path || '') || (c.code && (c.code.includes('from \'react\'') || c.code.includes('className'))))))
                .map(c => {
                  // ALL transforms BEFORE any escaping (template literals → concat, assignment fixes)
                  let code = sanitizeDollarInJsx(c.code);
                  code = transformJsxAttributeTemplateLiterals(code);
                  code = sanitizeInvalidAssignment(code);
                  code = wrapAdjacentJsxInFragment(code);
                  
                  // Remove import statements (we'll provide React and hooks in preamble - do NOT re-declare here to avoid "already been declared")
                  code = code.replace(/import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]react['"];?\s*/g, '');
                  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react['"];?\s*/g, () => '');
                  // Remove other import statements
                  code = code.replace(/import\s+[^;]+;?\s*/g, '');
                  // Strip 'use client' / 'use server' and duplicate "const { ... } = React;" so only our preamble declares hooks
                  code = code.replace(/\s*['"]use\s+(?:client|server)['"]\s*;?\s*/gi, '\n');
                  code = code.replace(/\s*const\s*\{[\s\S]*?\}\s*=\s*React\s*;?\s*/g, '\n');
                  
                  // Remove export default and make function available globally
                  // Must remove exports BEFORE Babel processes the code
                  // Pattern 1: export default function ComponentName() { ... }
                  // Handle with various whitespace patterns
                  code = code.replace(/export\s+default\s+function\s+(\w+)\s*\(/g, 'function $1(');
                  // Pattern 2: export default function() { ... } - need to add name
                  const componentName = c.name.replace(/\s+/g, '');
                  if (!code.includes(`function ${componentName}`)) {
                    code = code.replace(/export\s+default\s+function\s*\(/g, `function ${componentName}(`);
                  }
                  // Pattern 3: const Component = ...; export default Component;
                  code = code.replace(/export\s+default\s+(\w+)\s*;?\s*$/gm, '');
                  // Pattern 4: export default (arrow function or expression)
                  code = code.replace(/export\s+default\s+const\s+(\w+)\s*=/g, 'const $1 =');
                  // Pattern 5: Any remaining export default (catch-all) - be very aggressive
                  // This must catch ALL export default patterns
                  code = code.replace(/export\s+default\s+/g, '');
                  code = code.replace(/export\s+default/g, '');
                  // Also remove any standalone export statements
                  code = code.replace(/^\s*export\s+default\s*;?\s*$/gm, '');
                  // Remove any export statements at all (for safety)
                  code = code.replace(/^\s*export\s+/gm, '');
                  
                  // Add default props handling for components that might receive undefined props
                  // This prevents "Cannot read properties of undefined" errors
                  if (code.includes('function ')) {
                    const funcMatch = code.match(/function\s+(\w+)\s*\(([^)]*)\)/);
                    if (funcMatch) {
                      const funcName = funcMatch[1];
                      const params = funcMatch[2];
                      
                      // Handle destructured props like { product } or { product = {} }
                      if (params.includes('{') && params.includes('}')) {
                        // Destructured props - add defaults for common patterns
                        // Pattern: { product } -> { product = {} }
                        if (params.includes('product') && !params.includes('product =')) {
                          code = code.replace(
                            new RegExp(`function\\s+${funcName}\\s*\\(\\s*\\{[^}]*product[^}]*\\}\\s*\\)`, 'g'),
                            (match) => match.replace(/\{([^}]*product)([^}]*)\}/, '{$1 = {}$2}')
                          );
                        }
                        // Pattern: { product, ... } -> { product = {}, ... }
                        if (params.includes('product') && !params.includes('product =')) {
                          code = code.replace(/\{([^}]*)\bproduct\b([^}]*)\}/g, (match) => {
                            if (!match.includes('product =')) {
                              return match.replace(/\bproduct\b/, 'product = {}');
                            }
                            return match;
                          });
                        }
                      } else if (params.includes('props') && !params.includes('props =')) {
                        // Regular props parameter - add default
                        code = code.replace(
                          new RegExp(`function\\s+${funcName}\\s*\\(\\s*props\\s*\\)`, 'g'),
                          `function ${funcName}(props = {})`
                        );
                      }
                    }
                  }
                  
                  // Ensure component is exposed with schema name so App's <Header /> etc. resolve
                  const fnDecl = code.match(/function\s+(\w+)\s*\(/);
                  const constDecl = code.match(/const\s+(\w+)\s*=/);
                  const actualName = fnDecl?.[1] ?? constDecl?.[1];
                  const definesComponent = fnDecl != null || (constDecl != null && /(?:=>|function|createElement|<\/?\w+)/.test(code));
                  if (actualName && actualName !== componentName && definesComponent) {
                    code = code.replace(new RegExp(`\\bfunction\\s+${actualName}\\s*\\(`, 'g'), `function ${componentName}(`);
                    code = code.replace(new RegExp(`\\bconst\\s+${actualName}\\s*=`, 'g'), `const ${componentName}=`);
                  }
                  
                  return code;
                });
              
              // Extract App component from mainJsx or create it
              let appCode = '';
              let rootElement = 'app';
              
              if (mainJsx) {
                // Process mainJsx - transforms first, then import stripping, then one escape at the end
                let processedMain = sanitizeDollarInJsx(mainJsx);
                processedMain = transformJsxAttributeTemplateLiterals(processedMain);
                processedMain = sanitizeInvalidAssignment(processedMain);
                processedMain = wrapAdjacentJsxInFragment(processedMain);
                const componentNamesForImports = components
                  .filter(c => c.language === 'jsx' || c.language === 'js' || c.language === 'tsx')
                  .map(c => c.name.replace(/\s+/g, ''));
                // Case-insensitive set so "Header" and "header" both treated as component (avoid placeholder for either)
                const componentNamesLower = new Set(componentNamesForImports.map((n) => n.toLowerCase()));
                const isComponentName = (name: string) =>
                  componentNamesForImports.includes(name) || (name && componentNamesLower.has(name.toLowerCase()));

                // Remove ALL import statements (including component imports); replace data/utils imports with defaults so variables exist
                // Pattern: import React from 'react';
                processedMain = processedMain.replace(/import\s+React\s+from\s+['"]react['"];?\s*/gm, '');
                // Pattern: import ReactDOM from 'react-dom/client';
                processedMain = processedMain.replace(/import\s+ReactDOM\s+from\s+['"]react-dom\/client['"];?\s*/gm, '');
                // Pattern: import ReactDOM from 'react-dom';
                processedMain = processedMain.replace(/import\s+ReactDOM\s+from\s+['"]react-dom['"];?\s*/gm, '');
                // Pattern: import { useState } from 'react';
                processedMain = processedMain.replace(/import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*/gm, '');
                // Pattern: import X from '...' - if X is a component, remove; else define so App doesn't throw (fallback will define any used-but-not-declared)
                processedMain = processedMain.replace(/import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*/gm, (_, name) => {
                  if (isComponentName(name)) return '';
                  return `const ${name} = [];`;
                });
                // Pattern: import { a, b } from '...' (named non-React imports - define so not undefined)
                processedMain = processedMain.replace(/import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*/gm, (_, namesStr) => {
                  const bindings = namesStr.split(',').map((s: string) => {
                    const t = s.trim();
                    const asIdx = t.indexOf(' as ');
                    return asIdx >= 0 ? t.slice(asIdx + 4).trim() : t.split(/\s+/)[0] || t;
                  }).filter(Boolean);
                  if (bindings.length === 0) return '';
                  return bindings
                    .filter((b: string) => !isComponentName(b))
                    .map((b: string) => `const ${b} = [];`)
                    .join(' ') + (bindings.some((b: string) => !isComponentName(b)) ? '\n' : '');
                });
                // Pattern: import * as something from '...';
                processedMain = processedMain.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*/gm, (_, name) => `const ${name} = {};\n`);
                // Pattern: import './style.css' or any side-effect import
                processedMain = processedMain.replace(/import\s+['"][^'"]+['"];?\s*/gm, '');
                // Final catch-all: any remaining import (default binding) - define so variable exists
                processedMain = processedMain.replace(/import\s+(\w+)\s+from\s+[^;]+;?\s*/gm, (match, name) => {
                  if (isComponentName(name)) return '';
                  return `const ${name} = [];`;
                });
                // Strip any leftover import line but define default binding so we don't leave refs undefined
                processedMain = processedMain.replace(/^import\s+(\w+)\s+from\s+.*$/gm, (match, name) => {
                  if (isComponentName(name)) return '';
                  return `const ${name} = [];`;
                });
                processedMain = processedMain.replace(/^import\s+.*$/gm, '');
                // Remove any placeholder "const ComponentName = [];" that would shadow real component declarations
                // (avoids "Identifier 'Header' has already been declared" when componentDefinitions run)
                // Remove both exact and lowercase-first variant (e.g. Header and header)
                componentNamesForImports.forEach((name: string) => {
                  processedMain = processedMain.replace(new RegExp(`const\\s+${name}\\s*=\\s*\\[\\]\\s*;?\\s*`, 'g'), '');
                  const nameLowerFirst = name.charAt(0).toLowerCase() + name.slice(1);
                  if (nameLowerFirst !== name) {
                    processedMain = processedMain.replace(new RegExp(`const\\s+${nameLowerFirst}\\s*=\\s*\\[\\]\\s*;?\\s*`, 'g'), '');
                  }
                });
                // Remove all export statements
                processedMain = processedMain.replace(/export\s+default\s+/g, '');
                processedMain = processedMain.replace(/export\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*/g, '');
                processedMain = processedMain.replace(/export\s+/g, '');
                // Strip 'use client' and duplicate "const { ... } = React;" so only preamble declares hooks (preview isolation)
                processedMain = processedMain.replace(/\s*['"]use\s+(?:client|server)['"]\s*;?\s*/gi, '\n');
                processedMain = processedMain.replace(/\s*const\s*\{[\s\S]*?\}\s*=\s*React\s*;?\s*/g, '\n');
                
                // Always ensure App component is defined as a proper function
                // Get component names
                const componentNames = components
                  .filter(c => c.language === 'jsx' || c.language === 'js')
                  .map(c => c.name.replace(/\s+/g, ''));
                
                // Create App function definition
                const appDefinition = `function App() {
  return (
    <>
      ${componentNames.map(name => `<${name} />`).join('\n      ')}
    </>
  );
}`;
                
                // Preserve the App component from mainJsx if it exists (it has correct props)
                // Only replace if it's an arrow function or doesn't exist
                const hasFunctionApp = processedMain.includes('function App') || /function\s+App\s*\(/.test(processedMain);
                const hasConstApp = /const\s+App\s*=/.test(processedMain);
                
                if (hasConstApp) {
                  // Arrow function - need to extract and convert to function
                  // Find the const App = ... pattern and extract it
                  const constStart = processedMain.indexOf('const App');
                  if (constStart !== -1) {
                    // Try to find the end of the arrow function
                    // Look for semicolon or new statement
                    let constEnd = processedMain.indexOf(';', constStart);
                    if (constEnd === -1) {
                      // No semicolon, try to find next statement (ReactDOM or function)
                      const nextStatement = processedMain.search(/(ReactDOM|function|const|var)\s/, constStart + 10);
                      if (nextStatement !== -1) {
                        constEnd = nextStatement;
                      } else {
                        constEnd = processedMain.length;
                      }
                    } else {
                      constEnd++;
                    }
                    // Replace arrow function with proper function
                    processedMain = processedMain.substring(0, constStart) + appDefinition + '\n\n' + processedMain.substring(constEnd);
                  }
                } else if (!hasFunctionApp) {
                  // No App component - add it before ReactDOM calls
                  const renderIndex = processedMain.search(/ReactDOM\.(render|createRoot)/);
                  if (renderIndex !== -1) {
                    processedMain = processedMain.substring(0, renderIndex).trim() + '\n\n' + appDefinition + '\n\n' + processedMain.substring(renderIndex).trim();
                  } else {
                    // No ReactDOM call found, append at the end
                    processedMain = processedMain.trim() + '\n\n' + appDefinition;
                  }
                }
                // If function App exists, we keep it as-is (it should have correct props from backend)
                
                // Extract root element ID from getElementById calls
                const rootMatch = processedMain.match(/getElementById\(['"]([^'"]+)['"]\)/);
                if (rootMatch) {
                  rootElement = rootMatch[1];
                }
                
                // Keep React 18 createRoot (do not convert to deprecated render) - react-dom@18 UMD supports createRoot
                if (processedMain.includes('createRoot')) {
                  const rootIdMatch = processedMain.match(/getElementById\(['"]([^'"]+)['"]\)/);
                  if (rootIdMatch) {
                    rootElement = rootIdMatch[1];
                  }
                }
                
                // Final verification: Ensure App (or equivalent) exists after all processing
                const finalHasApp = /function\s+App\s*\(/.test(processedMain)
                  || processedMain.includes('function App(')
                  || /\bconst\s+App\s*=/.test(processedMain)
                  || /\blet\s+App\s*=/.test(processedMain);
                if (!finalHasApp) {
                  // Insert App definition before ReactDOM.render or createRoot
                  const renderIndex = processedMain.search(/ReactDOM\.(render|createRoot)/);
                  if (renderIndex !== -1) {
                    processedMain = processedMain.substring(0, renderIndex).trim() + '\n\n' + appDefinition + '\n\n' + processedMain.substring(renderIndex).trim();
                  } else {
                    processedMain = processedMain.trim() + '\n\n' + appDefinition;
                  }
                }
                
                // Wrap root render in error boundary so render errors (e.g. invalid element type) show a friendly message
                processedMain = processedMain.replace(/\.render\s*\(\s*<\s*App\s*\/?\s*>\s*\)\s*(,\s*[^)]+)?\s*\)/g, (_, rest) =>
                  '.render(React.createElement(PreviewErrorBoundary, null, React.createElement(App, null))' + (rest ? rest + ')' : ')'));

                // Debug: log processed main to spot duplicate declarations
                if (import.meta.env?.DEV) {
                  console.log('[WebsitePreview] Processed mainJsx (first 500):', processedMain.substring(0, 500));
                }

                appCode = escapeForEmbedInScript(processedMain);
              } else {
                // Create App component from individual components
                const componentNames = components
                  .filter(c => c.language === 'jsx' || c.language === 'js')
                  .map(c => c.name.replace(/\s+/g, ''));
                
                appCode = `
                  function App() {
                    return (
                      <>
                        ${componentNames.map(name => `<${name} />`).join('\n                        ')}
                      </>
                    );
                  }
                  
                  var rootEl = document.getElementById('${rootElement}');
                  if (rootEl && typeof ReactDOM.createRoot === 'function') {
                    ReactDOM.createRoot(rootEl).render(<PreviewErrorBoundary><App /></PreviewErrorBoundary>);
                  } else if (rootEl) {
                    ReactDOM.render(<PreviewErrorBoundary><App /></PreviewErrorBoundary>, rootEl);
                  }
                `;
              }
              
              // Component names in same order as processedComponents (for IIFE wrapper)
              const reactComponentNames = components
                .filter(c => c.language === 'jsx' || c.language === 'js' || c.language === 'tsx' || (!c.language && (/\\.(jsx|tsx)$/.test(c.path || '') || (c.code && (c.code.includes('from \'react\'') || c.code.includes('className'))))))
                .map(c => c.name.replace(/\s+/g, ''));
              // Escape once for embedding (code is already fully transformed above)
              // If a "component" chunk doesn't define that component (e.g. data-only file like const App = [] or const initialProducts = []), use side-effect IIFE only so we don't declare const App and then redeclare with function App() from mainJsx
              let componentDefinitions = processedComponents.map((code, i) => {
                const componentName = reactComponentNames[i] || 'Component' + i;
                const hasFunctionDecl = new RegExp(`\\bfunction\\s+${componentName}\\s*\\(`).test(code);
                const hasComponentConst = new RegExp(`\\bconst\\s+${componentName}\\s*=\\s*(?:function|\\([^)]*\\)\\s*=>)`).test(code);
                const definesThisComponent = hasFunctionDecl || hasComponentConst;
                if (definesThisComponent) {
                  return `const ${componentName} = (function() {\n${escapeForEmbedInScript(code)}\nreturn typeof ${componentName} === 'function' ? ${componentName} : (function() { return null; });\n})();`;
                }
                return `(function() {\n${escapeForEmbedInScript(code)}\n})();`;
              }).join('\n\n');
              // If a component chunk already defined App (const App = (function() {...})();), remove duplicate "function App() { ... }" from mainJsx so we don't redeclare
              if (componentDefinitions.includes('const App = (function()') && appCode.includes('function App')) {
                appCode = stripTopLevelFunctionApp(appCode);
              }
              if (import.meta.env?.DEV && processedComponents.length > 0) {
                const firstComponent = processedComponents[0];
                const fullScript = componentDefinitions + '\n\n' + appCode;
                console.log('[SANITIZE CHECK] Component after transforms:', firstComponent.substring(0, 200));
                console.log('[SANITIZE CHECK] Looking for patterns:', {
                  hasBacktickInBraces: /\{[^}]*`[^}]*\}/.test(firstComponent),
                  hasEqualsS: /=\s*\{\s*\}\s*s/.test(fullScript),
                });
              }
              // Dynamically find identifiers that are used but not declared (any data variable the generated code references)
              const reactUserCodeStr = componentDefinitions + '\n\n' + appCode;
              const reactComponentNamesList = components
                .filter(c => c.language === 'jsx' || c.language === 'js' || c.language === 'tsx')
                .map(c => c.name.replace(/\s+/g, ''));
              let usedButUndeclared = getUsedButUndeclaredIdentifiers(reactUserCodeStr, reactComponentNamesList);
              // Safety net: common data names that generated code often uses as globals - add fallback only when they appear in the script AND are not already declared (avoid "already been declared" when script has e.g. const mockProducts = [])
              const commonDataVars = ['products', 'initialProducts', 'items', 'cart', 'data', 'services', 'mockProducts', 'productList'];
              const usedSet = new Set(usedButUndeclared);
              const isDeclaredInScript = (name: string) => new RegExp('\\b(?:const|let|var)\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[=\\[{]').test(reactUserCodeStr);
              for (const name of commonDataVars) {
                if (!usedSet.has(name) && new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(reactUserCodeStr) && !isDeclaredInScript(name)) {
                  usedSet.add(name);
                }
              }
              usedButUndeclared = Array.from(usedSet);
              const reactFallbackLines = usedButUndeclared
                .map(name => {
                  // PascalCase names are used as components (<ProductCard />); must be a function, not []
                  if (/^[A-Z]/.test(name)) {
                    return `if (typeof ${name} === 'undefined') { var ${name} = function ${name}() { return null; }; }`;
                  }
                  return `if (typeof ${name} === 'undefined') { var ${name} = []; }`;
                })
                .join('\n        ');

              // React error boundary: catches render errors (e.g. invalid element type) and shows a friendly message
              const previewErrorBoundaryScript = `class PreviewErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error: error }; }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', { style: { padding: '20px', color: '#721c24', background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '4px', fontFamily: 'monospace', margin: '20px' } },
        React.createElement('h3', { style: { marginTop: 0 } }, 'Preview error'),
        React.createElement('p', null, this.state.error && this.state.error.message),
        this.state.error && this.state.error.stack ? React.createElement('pre', { style: { fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' } }, this.state.error.stack) : null
      );
    }
    return this.props.children;
  }
};`;

              // Debug: before doc.write, verify each component appears once as IIFE, not as placeholder
              if (import.meta.env?.DEV) {
                const scriptContent = componentDefinitions + '\n\n' + appCode;
                reactComponentNames.forEach((name: string) => {
                  const placeholderCount = (scriptContent.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[\\]`, 'g')) || []).length;
                  const iifeCount = (scriptContent.match(new RegExp(`const\\s+${name}\\s*=\\s*\\(function`, 'g')) || []).length;
                  if (placeholderCount > 0 || iifeCount !== 1) {
                    console.warn(`[WebsitePreview] Component "${name}": placeholder count=${placeholderCount}, IIFE count=${iifeCount} (expected 0 and 1)`);
                  }
                });
                console.log('[WebsitePreview] Final iframe script snippet (first 600 chars):', scriptContent.substring(0, 600));
              }

              content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeForEmbed(websiteName || 'Generated Website')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; }
    ${escapeForEmbed(styleCss)}
  </style>
</head>
<body>
  <div id="${rootElement}"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="text/babel" data-presets="react">
    (function() {
      try {
        // Check if React and ReactDOM are loaded
        if (typeof React === 'undefined') {
          throw new Error('React library not loaded');
        }
        if (typeof ReactDOM === 'undefined') {
          throw new Error('ReactDOM library not loaded');
        }
        
        // Make React hooks available
        const { useState, useEffect, useRef, useCallback, useMemo, useContext } = React;
        
        // Define common data variables only if user code does not declare them (avoids "already been declared" errors)
        ${escapeBackslashOnly(reactFallbackLines)}
        
        // React error boundary: catches render errors (e.g. invalid element type) so client sees a friendly message
        ${escapeBackslashOnly(previewErrorBoundaryScript)}
        
        // Each component in its own scope so duplicate names (PlayIcon, etc.) across files don't conflict
        // (componentDefinitions and appCode are already escaped via escapeForEmbedInScript — do NOT double-escape or apostrophes like Queen's become \\\\' and break parsing)
        ${componentDefinitions}
        
        // App initialization
        ${appCode}
        
        // Final check: Ensure App is defined
        if (typeof App === 'undefined') {
          throw new Error('App component is not defined. Available components: ' + Object.keys(window).filter(k => k.match(/^[A-Z]/)).join(', '));
        }
      } catch (error) {
        console.error('React compilation/execution error:', error);
        const container = document.getElementById('${rootElement}');
        if (container) {
          container.innerHTML = '<div style="padding: 20px; color: red; font-family: monospace; background: #fee; border: 2px solid red; margin: 20px;">' +
            '<h3 style="margin-top: 0;">React Error:</h3>' +
            '<p><strong>' + error.message + '</strong></p>' +
            '<pre style="overflow: auto; white-space: pre-wrap; background: #fff; padding: 10px; border-radius: 4px;">' + 
            (error.stack || error.toString()) + '</pre>' +
            '</div>';
        }
      }
    })();
  </script>
</body>
</html>`;
            } else {
              // Vanilla JS components
              const styleCss = viteConfig?.styleCss || '';
              
              // Convert component exports to functions that can be called
              const componentFunctions = components
                .filter(c => c.language === 'js')
                .map(c => {
                // Extract function name - use component name as function name
                const funcName = c.name.replace(/\s+/g, '');
                let funcCode = c.code.trim();
                
                // Handle different export patterns
                // Pattern 1: export default function ComponentName() { ... }
                if (funcCode.includes('export default function')) {
                  // Remove export default and keep function
                  funcCode = funcCode.replace(/export\s+default\s+function\s+(\w+)\s*\(/g, `function ${funcName}(`);
                  funcCode = funcCode.replace(/export\s+default\s+function\s*\(/g, `function ${funcName}(`);
                }
                // Pattern 2: const Component = () => { ... }; export default Component;
                else if (funcCode.includes('const') && funcCode.includes('export default')) {
                  // Extract arrow function or regular function
                  const arrowMatch = funcCode.match(/const\s+\w+\s*=\s*(\([^)]*\)\s*=>\s*\{[^}]*\})/);
                  const regularMatch = funcCode.match(/const\s+\w+\s*=\s*function\s*\([^)]*\)\s*\{[^}]*\}/);
                  
                  if (arrowMatch) {
                    funcCode = `function ${funcName}() { return ${arrowMatch[1]}; }`;
                  } else if (regularMatch) {
                    funcCode = funcCode.replace(/const\s+\w+\s*=\s*/, `function ${funcName}`);
                    funcCode = funcCode.replace(/export\s+default\s+\w+;?/g, '');
                  } else {
                    // Fallback: wrap in function
                    funcCode = `function ${funcName}() { ${funcCode.replace(/export\s+default\s+/g, '')} }`;
                  }
                }
                // Pattern 3: Already a function declaration
                else if (funcCode.startsWith('function') || funcCode.startsWith('export default')) {
                  funcCode = funcCode.replace(/export\s+default\s+/g, '');
                  // Ensure it has the right name
                  if (!funcCode.includes(`function ${funcName}`)) {
                    funcCode = funcCode.replace(/function\s+\w+/, `function ${funcName}`);
                  }
                }
                // Pattern 4: Arrow function or other - wrap it
                else {
                  // Try to extract the actual function body
                  const bodyMatch = funcCode.match(/\{[\s\S]*\}/);
                  if (bodyMatch) {
                    funcCode = `function ${funcName}() ${bodyMatch[0]}`;
                  } else {
                    funcCode = `function ${funcName}() { ${funcCode} }`;
                  }
                }
                
                return { name: funcName, code: funcCode };
              });
            
            // Build main execution code
            const mainJs = viteConfig?.mainJs || '';
            let executionCode = '';
            
            if (mainJs) {
              // Extract component names from main.js imports
              const importMatches = Array.from(mainJs.matchAll(/import\s+(\w+)\s+from\s+['"][^'"]+['"];?/g));
              const componentNames: string[] = [];
              importMatches.forEach(match => {
                componentNames.push(match[1]);
              });
              
              if (componentNames.length > 0) {
                // Build execution code using imported names
                executionCode = `
                  (function() {
                    const app = document.getElementById('app');
                    if (!app) return;
                    ${componentNames.map(name => {
                      // Find the corresponding function name
                      const func = componentFunctions.find(f => 
                        f.code.includes(`function ${name}`) || 
                        f.name.toLowerCase() === name.toLowerCase()
                      );
                      return func ? `app.appendChild(${func.name}());` : '';
                    }).filter(Boolean).join('\n                    ')}
                  })();
                `;
              } else {
                // Fallback: render all components in order
                executionCode = `
                  (function() {
                    const app = document.getElementById('app');
                    if (!app) return;
                    ${componentFunctions.map(c => `app.appendChild(${c.name}());`).join('\n                    ')}
                  })();
                `;
              }
            } else {
              // Fallback: render all components in order
              executionCode = `
                (function() {
                  const app = document.getElementById('app');
                  if (!app) return;
                  ${componentFunctions.map(c => `app.appendChild(${c.name}());`).join('\n                  ')}
                })();
              `;
            }
            
            // JSX helper function
            const jsxHelper = `function jsx(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  
  // Set attributes
  if (props) {
    Object.keys(props).forEach(key => {
      if (key === 'className') {
        element.className = props[key];
      } else if (key.startsWith('on') && typeof props[key] === 'function') {
        const eventName = key.slice(2).toLowerCase();
        element.addEventListener(eventName, props[key]);
      } else if (key !== 'children') {
        element.setAttribute(key, props[key]);
      }
    });
  }
  
  // Append children
  children.forEach(child => {
    if (child === null || child === undefined) return;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    } else if (Array.isArray(child)) {
      child.forEach(c => {
        if (c instanceof Node) {
          element.appendChild(c);
        } else if (typeof c === 'string' || typeof c === 'number') {
          element.appendChild(document.createTextNode(String(c)));
        }
      });
    }
  });
  
  return element;
}`;

            // Build complete HTML (escape generated code so backticks don't break our template)
            content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeForEmbed(websiteName || 'Generated Website')}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    }
    ${escapeForEmbed(styleCss)}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    ${jsxHelper}
    
    ${componentFunctions.map(c => {
      let code = c.code;
      code = code.replace(/import\s+\{[^}]*jsx[^}]*\}\s+from\s+['"][^'"]+['"];?\s*/g, '');
      code = code.replace(/import\s+jsx\s+from\s+['"][^'"]+['"];?\s*/g, '');
      return escapeForEmbedInScript(code);
    }).join('\n\n')}
    
    ${executionCode}
  </script>
</body>
</html>`;
            }
          } else {
            // Legacy HTML/CSS/JS format
            const hasFullHtml = html && (html.trim().toLowerCase().includes('<!doctype') || html.trim().toLowerCase().includes('<html'));
            
            if (hasFullHtml && html) {
            content = html;
            if (!html.includes('<style>') && css) {
              content = content.replace('</head>', `<style>${escapeForEmbed(css)}</style></head>`);
            }
            if (!html.includes('<script>') && js) {
              content = content.replace('</body>', `<script>${escapeForEmbedInScript(js)}</script></body>`);
            }
          } else {
            content = `<!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>${escapeForEmbed(websiteName || 'Generated Website')}</title>
              <style>
                * {
                  box-sizing: border-box;
                }
                body {
                  margin: 0;
                  padding: 0;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                }
                  ${escapeForEmbed(css || '')}
              </style>
            </head>
            <body>
                ${escapeForEmbed(html || '')}
              <script>
                  ${escapeForEmbedInScript(js || '')}
              </script>
            </body>
            </html>
          `;
            }
          }
          
          // Log image URLs in preview (before any replacements) so you can trace the flow
          if (import.meta.env?.DEV) {
            const imageUrlRegex = /https?:\/\/(?:images\.)?unsplash\.com\/[^\s"'<>)\]]+|https?:\/\/(?:i\.)?imgur\.com\/[^\s"'<>)\]]+|https?:\/\/picsum\.photos\/[^\s"'<>)\]]+/gi;
            const allImgUrls = content.match(imageUrlRegex) || [];
            const uniqueUrls = [...new Set(allImgUrls)];
            console.log('[IMAGE] URLs in preview (before imgur replace):', uniqueUrls.length, uniqueUrls.slice(0, 15));
            if (uniqueUrls.length > 0) {
              uniqueUrls.forEach((u, i) => console.log(`  [IMAGE] ${i + 1}. ${u.substring(0, 80)}${u.length > 80 ? '...' : ''}`));
            }
          }

          // Unsplash placeholder (single stable image, resized via params) so preview uses Unsplash not Picsum
          const unsplashPlaceholder = (w: number, h: number) =>
            `https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=${Math.min(1200, w)}&h=${Math.min(800, h)}&fit=crop`;
          // Replace imgur URLs with Unsplash placeholders sized by context
          let imgurReplaceCount = 0;
          content = content.replace(/https?:\/\/(?:i\.)?imgur\.com\/[^\s"'<>)\]]+/gi, (match, offset) => {
            const idx = typeof offset === 'number' ? offset : content.indexOf(match);
            const start = Math.max(0, idx - 500);
            const ctx = content.slice(start, idx + 100).toLowerCase();
            let w = 400, h = 300;
            if (/\b(hero|banner|header-bg|cover|jumbotron|full-width)\b/.test(ctx)) { w = 1200; h = 600; }
            else if (/\b(thumbnail|thumb|avatar|icon|logo|favicon|profile-pic|user-img)\b/.test(ctx)) { w = 96; h = 96; }
            else if (/\b(card|product|item-img|gallery|grid-item)\b/.test(ctx)) { w = 400; h = 300; }
            const widthMatch = ctx.match(/width\s*[=:]\s*["']?(\d+)/);
            const heightMatch = ctx.match(/height\s*[=:]\s*["']?(\d+)/);
            if (widthMatch) w = Math.min(1200, Math.max(48, parseInt(widthMatch[1], 10)));
            if (heightMatch) h = Math.min(800, Math.max(48, parseInt(heightMatch[1], 10)));
            const newUrl = unsplashPlaceholder(w, h);
            if (import.meta.env?.DEV) {
              imgurReplaceCount++;
              console.log(`[IMAGE] Imgur → Unsplash fallback #${imgurReplaceCount}:`, match.substring(0, 60) + '...', '→', newUrl);
            }
            return newUrl;
          });
          // Replace Picsum URLs (AI often generates these) with Unsplash so preview is consistently Unsplash
          content = content.replace(/https?:\/\/picsum\.photos\/[^\s"'<>)\]]+/gi, (match) => {
            const sizeMatch = match.match(/picsum\.photos\/(?:seed\/[^/]+\/)?(\d+)\/(\d+)/);
            const w = sizeMatch ? parseInt(sizeMatch[1], 10) : 400;
            const h = sizeMatch ? parseInt(sizeMatch[2], 10) : 300;
            return unsplashPlaceholder(w, h);
          });
          if (import.meta.env?.DEV && imgurReplaceCount > 0) {
            console.log('[IMAGE] Total imgur replacements:', imgurReplaceCount);
          }

          // Params for preview fallback: backend returns a HEAD-checked Unsplash URL (no 404)
          const placeholderParamsJson = JSON.stringify({
            apiBase: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3000',
            websiteName: websiteName || '',
            prompt: prompt || '',
          });
          const placeholderParamsEscaped = placeholderParamsJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c');
          // Inject script: replace broken images with a validated Unsplash URL from our API (HEAD-checked, no 404)
          const imageFallbackScript = `<script>
window.__PREVIEW_PARAMS__ = JSON.parse('${placeholderParamsEscaped}');
(function() {
  function fallback(e) {
    var img = e && e.target ? e.target : e;
    if (!img || img.tagName !== 'IMG' || img.dataset.fallbackDone) return;
    var oldSrc = img.src || '';
    img.dataset.fallbackDone = '1';
    img.onerror = null;
    var w = (img.getAttribute('width') && parseInt(img.getAttribute('width'), 10)) || 400;
    var h = (img.getAttribute('height') && parseInt(img.getAttribute('height'), 10)) || 300;
    if (w > 1200) w = 1200; if (h > 800) h = 800; if (w < 48) w = 400; if (h < 48) h = 300;
    var params = window.__PREVIEW_PARAMS__ || {};
    var apiBase = (params.apiBase || '').replace(/\\/$/, '');
    var q = '?websiteName=' + encodeURIComponent(params.websiteName || '') + '&prompt=' + encodeURIComponent(params.prompt || '') + '&width=' + w + '&height=' + h;
    fetch(apiBase + '/website/placeholder-image' + q).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
      if (data && data.url) {
        img.src = data.url;
        try { if (window.parent && window.parent.console) window.parent.console.log('[IMAGE FALLBACK] Replaced with validated Unsplash (no 404):', oldSrc.substring(0, 50) + '...', '→', data.url.substring(0, 55) + '...'); } catch (err) {}
      }
    }).catch(function() {
      try { if (window.parent && window.parent.console) window.parent.console.warn('[IMAGE FALLBACK] API failed for placeholder; image left broken (Unsplash only).'); } catch (err) {}
    });
  }
  function attach() {
    try {
      var imgs = document.querySelectorAll('img');
      imgs.forEach(function(img) {
        if (img.dataset.fallbackDone) return;
        img.addEventListener('error', fallback);
        if (img.complete && img.naturalWidth === 0) fallback({ target: img });
      });
    } catch (err) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
  setTimeout(attach, 1500);
  setTimeout(attach, 4000);
})();
</script>`;
          content = content.replace('</body>', imageFallbackScript + '\n</body>');
          if (import.meta.env?.DEV) {
            console.log('[IMAGE] Fallback script injected: broken images will be replaced with validated Unsplash only (API HEAD-checked, no 404).');
          }

          // Safety: convert any remaining {__WEBPREVIEW_BACKTICK__...${expr}...__WEBPREVIEW_BACKTICK__} to concatenation so we never restore backticks for template literals (fixes "Unterminated template")
          content = content.replace(/\{\s*__WEBPREVIEW_BACKTICK__([\s\S]*?)__WEBPREVIEW_BACKTICK__\s*\}/g, (_match, inner) => {
            if (!inner.includes('${')) return _match;
            const parts: { type: 'str'; value: string } | { type: 'expr'; value: string }[] = [];
            let rest = inner;
            while (rest.length > 0) {
              const i = rest.indexOf('${');
              if (i === -1) {
                if (rest.length > 0) parts.push({ type: 'str', value: rest });
                break;
              }
              if (i > 0) parts.push({ type: 'str', value: rest.slice(0, i) });
              let depth = 0, j = i + 2;
              for (; j < rest.length; j++) {
                const c = rest[j];
                if (c === '{') depth++;
                else if (c === '}') { if (depth === 0) break; depth--; }
              }
              parts.push({ type: 'expr', value: rest.slice(i + 2, j).trim() });
              rest = rest.slice(j + 1);
            }
            let out = '{';
            parts.forEach((p, idx) => {
              if (p.type === 'str') {
                const escaped = p.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                out += "'" + escaped + "'";
              } else {
                out += '(' + p.value + ')';
              }
              if (idx < parts.length - 1) out += ' + ';
            });
            out += '}';
            return out;
          });
          // Restore backtick placeholder for any remaining uses (non-template-literal backticks)
          content = content.replace(/__WEBPREVIEW_BACKTICK__/g, '`');

          // ONE final safety pass on the complete HTML: normalize quotes, fix JSX, transform, sanitize each script body (catches all sources)
          content = content.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (_m, attrs, body) => {
            const normalized = normalizeEscapedQuotes(body);
            const fixedJsx = fixMisplacedFragmentClose(normalized);
            return '<script' + attrs + '>' + sanitizeInvalidAssignment(transformJsxAttributeTemplateLiterals(fixedJsx)) + '</script>';
          });
          
          doc.open();
          doc.write(content);
          doc.close();
        } catch (error) {
          console.error('Error loading iframe content:', error);
        }
      };

      // If iframe is already loaded, write content immediately
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        loadContent();
      } else {
        // Wait for iframe to load
        iframe.onload = loadContent;
        // Also try immediately in case it's already loaded
        setTimeout(loadContent, 100);
      }
    }
  }, [html, css, js, components, viteConfig, websiteName, prompt]);

  // Load content when html, css, js, or websiteName changes
  useEffect(() => {
    loadIframeContent();
  }, [loadIframeContent]);

  // Reload content when fullscreen mode changes
  useEffect(() => {
    // Small delay to ensure iframe is mounted in new location
    const timer = setTimeout(() => {
      loadIframeContent();
    }, 100);
    return () => clearTimeout(timer);
  }, [isFullscreen, loadIframeContent]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-card">
          <h2 className="text-lg font-semibold">{websiteName || 'Website Preview'}</h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="gap-2"
            >
              <Minimize2 className="h-4 w-4" />
              Exit Fullscreen
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Close
              </Button>
            )}
          </div>
        </div>
        <iframe
          ref={iframeRef}
          className="flex-1 w-full border-0"
          title="Website Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={loadIframeContent}
        />
      </div>
    );
  }

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-card rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col m-4">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-semibold">{websiteName || 'Website Preview'}</h2>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullscreen}
                className="gap-2"
              >
                <Maximize2 className="h-4 w-4" />
                Fullscreen
              </Button>
              {onClose && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Close
                </Button>
              )}
            </div>
          </div>
          <iframe
            ref={iframeRef}
            className="flex-1 w-full border-0 rounded-b-lg"
            title="Website Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={loadIframeContent}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg overflow-hidden bg-card flex flex-col ${className || ''}`}>
      <div className="flex items-center justify-between p-3 border-b bg-muted/50 flex-shrink-0">
        <h3 className="text-sm font-medium">{websiteName || 'Preview'}</h3>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="h-7 px-2"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 px-2"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title="Website Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={loadIframeContent}
        />
      </div>
    </div>
  );
};

export default WebsitePreview;

