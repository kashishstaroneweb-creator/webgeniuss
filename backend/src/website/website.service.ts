import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Website } from '../entities/website.entity';
import { PromptHistory } from '../entities/prompt-history.entity';
import { ObjectId } from 'mongodb';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

@Injectable()
export class WebsiteService {
  private openai: OpenAI;

  constructor(
    @InjectRepository(Website)
    private websiteRepository: Repository<Website>,
    @InjectRepository(PromptHistory)
    private promptRepository: Repository<PromptHistory>,
  ) {
    // Configure OpenAI client to use v0 API endpoint
    // v0 API is OpenAI-compatible, so we can use the same SDK
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY, // Using OPENAI_API_KEY env var for v0 API key
      baseURL: 'https://api.v0.dev/v1', // v0 API endpoint
    });
  }

  async generateWebsite(userId: string, prompt: string, websiteName: string) {
    console.log('WebsiteService.generateWebsite - Starting:', { userId, websiteName, promptLength: prompt.length });
    try {
      console.log('WebsiteService.generateWebsite - Calling v0 API...');
      console.log('WebsiteService.generateWebsite - v0 API Key:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
      
      // Use v0 models: v0-1.5-lg for advanced thinking and production-quality output
      // v0-1.5-md is for everyday tasks, v0-1.5-lg is for advanced reasoning
      const model = process.env.V0_MODEL || 'v0-1.5-lg';
      
      // Enhanced system prompt optimized for v0 API - v0 specializes in production-ready React components
      const systemPrompt = `You are v0, an expert AI specialized in generating PRODUCTION-READY, enterprise-grade React components and websites. Your expertise is in creating stunning, modern web applications with Vite + React that look like they were built by top-tier agencies. Generate a component-based architecture following React and Vite best practices.

CRITICAL: You MUST return ONLY a valid JSON object. No explanations, no markdown, no code blocks, just pure JSON starting with { and ending with }.

Required JSON structure:
{
  "components": [
    {
      "name": "Header",
      "type": "component",
      "path": "src/components/Header.jsx",
      "code": "import React from 'react';\\n\\nexport default function Header() {\\n  return (\\n    <header className=\\\"header\\\">\\n      <div className=\\\"header__logo\\\">IT Company</div>\\n      <nav className=\\\"header__nav\\\">\\n        <ul>\\n          <li><a href=\\\"#home\\\">Home</a></li>\\n        </ul>\\n      </nav>\\n    </header>\\n  );\\n}",
      "language": "jsx"
    },
    {
      "name": "Hero",
      "type": "component", 
      "path": "src/components/Hero.jsx",
      "code": "import React from 'react';\\n\\nexport default function Hero() {\\n  return (\\n    <section className=\\\"hero\\\">\\n      <h1>Welcome</h1>\\n    </section>\\n  );\\n}",
      "language": "jsx"
    }
  ],
  "viteConfig": {
    "packageJson": "{ \\\"name\\\": \\\"website-name\\\", \\\"version\\\": \\\"1.0.0\\\", \\\"scripts\\\": { \\\"dev\\\": \\\"vite\\\", \\\"build\\\": \\\"vite build\\\" }, \\\"dependencies\\\": { \\\"react\\\": \\\"^18.2.0\\\", \\\"react-dom\\\": \\\"^18.2.0\\\" }, \\\"devDependencies\\\": { \\\"vite\\\": \\\"^4.0.0\\\", \\\"@vitejs/plugin-react\\\": \\\"^3.0.0\\\" } }",
    "viteConfig": "import { defineConfig } from 'vite';\\nimport react from '@vitejs/plugin-react';\\n\\nexport default defineConfig({\\n  plugins: [react()],\\n});",
    "indexHtml": "<!DOCTYPE html>\\n<html lang=\\\"en\\\">\\n<head>\\n  <meta charset=\\\"UTF-8\\\">\\n  <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1.0\\\">\\n  <title>Website Name</title>\\n</head>\\n<body>\\n  <div id=\\\"root\\\"></div>\\n  <script type=\\\"module\\\" src=\\\"/src/main.jsx\\\"></script>\\n</body>\\n</html>",
    "mainJsx": "import React from 'react';\\nimport ReactDOM from 'react-dom/client';\\nimport './style.css';\\nimport Header from './components/Header.jsx';\\nimport Hero from './components/Hero.jsx';\\n\\nfunction App() {\\n  return (\\n    <>\\n      <Header />\\n      <Hero />\\n    </>\\n  );\\n}\\n\\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    "styleCss": "/* CSS styles */"
  }
}

CRITICAL: The mainJsx MUST include:
1. Import React and ReactDOM
2. Import './style.css'
3. Import ALL components from './components/ComponentName.jsx'
4. Define an App function component that returns all components wrapped in <>...</>
5. Call ReactDOM.createRoot(document.getElementById('root')).render(<App />)

COMPONENT ARCHITECTURE REQUIREMENTS:
- Break down the UI into logical, reusable React functional components (Header, Hero, Services, About, Contact, Footer, etc.)
- Each component should be a self-contained React functional component in src/components/
- Components MUST use React functional component syntax with JSX
- Use semantic HTML5 elements in JSX
- Components should accept props for customization
- Separate concerns: one component per file
- Use React hooks (useState, useEffect) when needed for interactivity

JSX ATTRIBUTES - NO TEMPLATE LITERALS:
- In JSX attributes, NEVER use template literals (backticks). Always use string concatenation instead.
- BAD: className={\`header__nav \${isMenuOpen ? 'is-open' : ''}\`}
- GOOD: className={'header__nav ' + (isMenuOpen ? 'is-open' : '')}
- This applies to className, style, and any other attribute that takes a dynamic string.

VITE PROJECT STRUCTURE:
- index.html: Root HTML file that loads /src/main.jsx as ES module
- src/main.jsx: Entry point that MUST:
  * Import React and ReactDOM from 'react' and 'react-dom/client'
  * Import './style.css'
  * Import ALL components from './components/ComponentName.jsx'
  * Define an App function component that returns all components wrapped in React Fragment (<>...</>)
  * Call ReactDOM.createRoot(document.getElementById('root')).render(<App />)
- src/components/: Directory containing all React functional components (.jsx files)
- src/style.css: Global styles, CSS variables, and component styles
- vite.config.js: Standard Vite configuration with React plugin
- package.json: Dependencies including React, ReactDOM, and Vite with @vitejs/plugin-react

MANDATORY mainJsx STRUCTURE:
The mainJsx MUST include an App component. Follow this EXACT pattern:
\`\`\`javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Services from './components/Services.jsx';
// ... import all other components

function App() {
  return (
    <>
      <Header />
      <Hero />
      <Services />
      {/* ... all other components */}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
\`\`\`

CRITICAL: The App component MUST be defined as a function that returns all components. DO NOT skip the App component.

COMPONENT PATTERN:
Each component MUST be a React functional component with JSX syntax. Follow this EXACT pattern:
\`\`\`javascript
import React from 'react';

export default function ComponentName(props = {}) {
  return (
    <nav className="header">
      <div className="header__logo">IT Company</div>
      <ul className="header__nav">
        <li><a href="#home">Home</a></li>
        <li><a href="#services">Services</a></li>
      </ul>
    </nav>
  );
}
\`\`\`

CRITICAL REACT COMPONENT REQUIREMENTS:
- ALL components MUST be complete React functional components using JSX syntax - NEVER use placeholder arrays or stubs like "const Header = [];" or "const Hero = [];"
- Each component MUST be a full function (e.g. "export default function Header() { return (...); }") with real JSX content
- Use .jsx file extension for component files
- Import React at the top: import React from 'react';
- Use JSX syntax: <div className="...">content</div>
- Use className (not class) for CSS classes
- Return JSX directly, wrapped in parentheses for multi-line
- Use props for component parameters
- Use React hooks (useState, useEffect) for state and side effects
- NO document.createElement, NO innerHTML, NO manual DOM manipulation
- NO placeholder declarations: do not declare component names as empty arrays or empty objects; declare them only as function components
- Components must look exactly like React functional components

STYLING APPROACH:
- Use CSS classes with BEM-like naming (component-name, component-name__element)
- Define CSS variables in :root for colors, spacing, etc.
- Use mobile-first responsive design
- Import styles in main.js: import './style.css'

DESIGN REQUIREMENTS (MANDATORY):
- PRODUCTION-READY design that looks professional and expensive
- Rich color schemes: gradients, modern palettes, sophisticated combinations
- Extensive CSS: box-shadow, text-shadow, border-radius, gradients, transforms
- Smooth animations: @keyframes, CSS transitions (0.3s ease) on ALL interactive elements
- Modern trends: glassmorphism (backdrop-filter: blur), card layouts, depth effects
- Professional typography: Import Google Fonts via @import in CSS, proper hierarchy
- Visual elements: icons, decorative elements, proper spacing and whitespace
- Interactive feedback: hover effects on ALL buttons/links, active states, focus states
- Hero sections: Large, impressive sections with compelling visuals
- Navigation: Modern, styled with smooth scroll effects
- Cards/containers: Shadows, rounded corners, hover effects, transitions
- Buttons: Gradients or solid colors, hover effects, active states
- Forms: Styled inputs, focus states, validation feedback
- Responsive: Mobile-first, perfect on all screen sizes
- NO minimal designs - every element must be beautifully styled

FUNCTIONALITY REQUIREMENTS:
- Complete, working features - NO placeholders or incomplete code
- Smooth interactions with visual feedback
- Form validation with real-time feedback
- Interactive elements: modals, dropdowns, carousels where appropriate
- Data handling: localStorage for persistence
- Error handling: try-catch, validation, user-friendly messages
- All buttons and forms fully functional

TECHNICAL REQUIREMENTS:
- Vite: Use Vite with React plugin (@vitejs/plugin-react)
- React: Use React 18+ with functional components and hooks
- Components: Each component as separate .jsx file with React functional component
- HTML: Semantic HTML5, proper meta tags in index.html
- CSS: Custom Properties (variables), Grid, Flexbox, @media queries, @keyframes, Google Fonts
- JavaScript: ES6+ modules, JSX syntax, React hooks (useState, useEffect), event handling
- Responsive breakpoints: mobile (<768px), tablet (768-1024px), desktop (>1024px)
- Cross-browser compatible
- Dependencies: React, ReactDOM, Vite, @vitejs/plugin-react

COMPONENT BREAKDOWN GUIDELINES:
- Header/Navbar → Header component
- Hero section → Hero component
- Services/Features → Services component (can have sub-components)
- About section → About component
- Contact form → Contact component
- Footer → Footer component
- Utility functions → utils/ folder
- Each component should be 50-200 lines of code
- Components should be composable and reusable

RETURN FORMAT:
- Return ONLY the raw JSON object with components array and viteConfig object
- No markdown, no explanations, no code fences
- Valid JSON that can be parsed directly
- All code strings should be properly escaped JSON strings with \\n for newlines

CRITICAL: Every component MUST be a React functional component with JSX. Example:
\`\`\`javascript
import React from 'react';

export default function Header() {
  return (
    <header className="header">
      <div className="header__logo">IT Company</div>
      <nav className="header__nav">
        <ul>
          <li><a href="#home">Home</a></li>
          <li><a href="#services">Services</a></li>
        </ul>
      </nav>
    </header>
  );
}
\`\`\`

DO NOT use document.createElement, innerHTML, or jsx() helper. ONLY use React JSX syntax.

For dynamic class names use: className={'base-class ' + (condition ? 'active' : '')} never className={\`base-class \${expr}\`}.`;

      // Preserve the full user prompt - enhance it but keep all details
      const userPrompt = this.enhanceUserPrompt(prompt);

      console.log('WebsiteService.generateWebsite - Using model:', model);
      console.log('WebsiteService.generateWebsite - Original prompt length:', prompt.length);
      console.log('WebsiteService.generateWebsite - Enhanced prompt length:', userPrompt.length);

      const MAX_V0_ATTEMPTS = Number(process.env.V0_MAX_RETRIES) || 3;
      const RETRY_DELAY_MS = 1500;
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

      let responseContent: string = '{}';
      let websiteCode: any = null;

      for (let attempt = 1; attempt <= MAX_V0_ATTEMPTS; attempt++) {
        console.log('WebsiteService.generateWebsite - v0 API attempt', attempt, 'of', MAX_V0_ATTEMPTS);

        const completion = await this.openai.chat.completions.create({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 32768,
        });

        responseContent = completion.choices[0]?.message?.content || '{}';
        console.log('WebsiteService.generateWebsite - v0 API Response length:', responseContent.length, '| first 500 chars:', responseContent.substring(0, 500));

        if (this.isRefusalResponse(responseContent)) {
          console.warn('WebsiteService.generateWebsite - v0 API refusal on attempt', attempt);
          if (attempt < MAX_V0_ATTEMPTS) {
            console.log('WebsiteService.generateWebsite - Retrying in', RETRY_DELAY_MS, 'ms...');
            await delay(RETRY_DELAY_MS);
            continue;
          }
          const msg = 'The AI declined to generate this website after ' + MAX_V0_ATTEMPTS + ' attempts. Try rephrasing your prompt (e.g. avoid sensitive topics, use clearer wording, or break the request into smaller steps).';
          const err = new Error(msg) as Error & { status?: number };
          err.status = 422;
          throw err;
        }

        websiteCode = this.parseV0Response(responseContent);
        if (!websiteCode) {
          console.warn('WebsiteService.generateWebsite - Parse failed, trying code extraction');
          websiteCode = this.extractCodeFromResponse(responseContent);
        }
        if (websiteCode?.files && Array.isArray(websiteCode.files)) {
          websiteCode = this.convertV0FilesToStructure(websiteCode);
        }

        const hasValidCode =
          (websiteCode?.components?.length > 0) ||
          (websiteCode?.files?.length > 0) ||
          (websiteCode?.html && websiteCode.html !== '<div>Generated Website</div>');
        if (hasValidCode) {
          console.log('WebsiteService.generateWebsite - Valid code received on attempt', attempt);
          break;
        }

        console.warn('WebsiteService.generateWebsite - No valid code on attempt', attempt);
        if (attempt < MAX_V0_ATTEMPTS) {
          console.log('WebsiteService.generateWebsite - Retrying in', RETRY_DELAY_MS, 'ms...');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        const err = new Error(
          'The AI did not return valid website code after ' + MAX_V0_ATTEMPTS + ' attempts. Try rephrasing your prompt or simplifying the request.',
        ) as Error & { status?: number };
        err.status = 422;
        throw err;
      }

      // Sanitize JSX and fix images: validate image URLs (HEAD), replace 404s with a relevant image (Unsplash by site theme, else Picsum), then replace imgur
      const getPlaceholderUrl = await this.buildPlaceholderUrlGetter(websiteName || '', prompt);
      const sanitizeCode = (raw: string) =>
        this.sanitizeInvalidConditionAssignment(
          this.sanitizeJsxDollarInterpolation(this.transformJsxAttributeTemplateLiterals(raw)),
        );
      if (websiteCode?.components?.length) {
        for (let i = 0; i < websiteCode.components.length; i++) {
          let code = sanitizeCode(websiteCode.components[i].code || '');
          code = await this.validateAndReplaceBrokenImageUrls(code, getPlaceholderUrl);
          code = this.replaceBrokenImageUrls(code);
          websiteCode.components[i].code = this.wrapAdjacentJsxInFragment(code);
        }
      }
      if (websiteCode?.viteConfig?.mainJsx) {
        let main = sanitizeCode(websiteCode.viteConfig.mainJsx);
        main = await this.validateAndReplaceBrokenImageUrls(main, getPlaceholderUrl);
        main = this.replaceBrokenImageUrls(main);
        websiteCode.viteConfig.mainJsx = this.wrapAdjacentJsxInFragment(main);
      }
      if (websiteCode?.viteConfig?.mainJs) {
        let main = sanitizeCode(websiteCode.viteConfig.mainJs);
        main = await this.validateAndReplaceBrokenImageUrls(main, getPlaceholderUrl);
        main = this.replaceBrokenImageUrls(main);
        websiteCode.viteConfig.mainJs = this.wrapAdjacentJsxInFragment(main);
      }
      if (websiteCode?.html) {
        let html = await this.validateAndReplaceBrokenImageUrls(websiteCode.html, getPlaceholderUrl);
        websiteCode.html = this.replaceBrokenImageUrls(html);
      }
      if (websiteCode?.css) websiteCode.css = this.replaceBrokenImageUrls(websiteCode.css);
      if (websiteCode?.js) {
        let js = await this.validateAndReplaceBrokenImageUrls(websiteCode.js, getPlaceholderUrl);
        websiteCode.js = this.replaceBrokenImageUrls(js);
      }

      // Strip any placeholder "const ComponentName = [];" from mainJsx/mainJs so preview never sees duplicate declarations
      const componentNamesForStrip = (websiteCode?.components || []).map((c: any) => (c.name || '').replace(/\s+/g, ''));
      if (componentNamesForStrip.length > 0 && websiteCode?.viteConfig) {
        const stripPlaceholders = (code: string) => {
          let out = code;
          componentNamesForStrip.forEach((name: string) => {
            if (!name) return;
            out = out.replace(new RegExp(`const\\s+${name}\\s*=\\s*\\[\\]\\s*;?\\s*`, 'g'), '');
          });
          return out;
        };
        if (websiteCode.viteConfig.mainJsx) websiteCode.viteConfig.mainJsx = stripPlaceholders(websiteCode.viteConfig.mainJsx);
        if (websiteCode.viteConfig.mainJs) websiteCode.viteConfig.mainJs = stripPlaceholders(websiteCode.viteConfig.mainJs);
      }

      // Extract component-based structure or fallback to legacy format
      const components = websiteCode.components || [];
      const viteConfig = websiteCode.viteConfig || null;
      
      // Legacy fallback for backward compatibility
      const htmlCode = websiteCode.html || websiteCode.HTML || '<div>Generated Website</div>';
      const cssCode = websiteCode.css || websiteCode.CSS || 'body { margin: 0; padding: 0; }';
      const jsCode = websiteCode.js || websiteCode.JS || websiteCode.javascript || '// JavaScript code';

      // Debug: log after normalization to spot placeholder declarations
      const componentNames = components.map((c: any) => (c.name || '').replace(/\s+/g, ''));
      const mainJsxPreview = viteConfig?.mainJsx?.substring(0, 500) || viteConfig?.mainJs?.substring(0, 500) || '';
      console.log('WebsiteService.generateWebsite - After normalization:', {
        componentNames,
        mainJsxPreview: mainJsxPreview || '(none)',
      });
      const badPlaceholder = componentNames.find((name: string) => name && mainJsxPreview.includes(`const ${name} = []`));
      if (badPlaceholder) {
        console.warn('WebsiteService.generateWebsite - mainJsx still contains placeholder for component:', badPlaceholder);
      }
      
      console.log('WebsiteService.generateWebsite - Extracted structure:', {
        hasComponents: components.length > 0,
        componentCount: components.length,
        hasViteConfig: !!viteConfig,
        legacyMode: components.length === 0
      });
      
      if (components.length === 0 && htmlCode === '<div>Generated Website</div>' && cssCode === 'body { margin: 0; padding: 0; }') {
        console.error('WebsiteService.generateWebsite - No valid code from v0 API; refusing to save placeholder.');
        const err = new Error(
          'The AI did not return valid website code. You may have hit a content limit or the request may have been refused. Try rephrasing your prompt or simplifying the request.',
        ) as Error & { status?: number };
        err.status = 422;
        throw err;
      }

      // Save website to database
      const website = this.websiteRepository.create({
        userId,
        websiteName,
        prompt,
        htmlCode: components.length > 0 ? '' : htmlCode, // Keep legacy for backward compat
        cssCode: components.length > 0 ? '' : cssCode,
        jsCode: components.length > 0 ? '' : jsCode,
        components: components.length > 0 ? components : undefined,
        viteConfig: viteConfig || undefined,
      });

      const savedWebsite = await this.websiteRepository.save(website);

      // Save prompt history
      await this.promptRepository.save(
        this.promptRepository.create({
          userId,
          prompt,
          aiResponse: responseContent,
        }),
      );

      // Generate files in generated_sites folder
      const generatedPath = components.length > 0
        ? await this.saveViteProject(
            userId,
            savedWebsite.id.toString(),
            components,
            viteConfig,
            websiteName,
          )
        : await this.saveWebsiteFiles(
            userId,
            savedWebsite.id.toString(),
            htmlCode,
            cssCode,
            jsCode,
          );

      savedWebsite.generatedPath = generatedPath;
      await this.websiteRepository.save(savedWebsite);

      console.log('WebsiteService.generateWebsite - Success, saved website ID:', savedWebsite.id);
      return {
        ...savedWebsite,
        id: savedWebsite.id.toString(),
        components: components.length > 0 ? components : undefined,
        viteConfig: viteConfig || undefined,
        message: 'Website generated successfully',
      };
    } catch (error) {
      console.error('WebsiteService.generateWebsite - Error:', {
        message: error.message,
        stack: error.stack,
        userId,
        websiteName
      });
      
      // Provide more helpful error messages for v0 API
      if (error.message.includes('401') || error.message.includes('Incorrect API key')) {
        throw new Error(`Failed to generate website: Invalid v0 API key. Please check your OPENAI_API_KEY environment variable contains a valid v0 API key from https://v0.app`);
      }
      
      // Handle Premium/Team plan requirement
      if (error.message.includes('403') || error.message.includes('Premium or Team plan')) {
        throw new Error(`Failed to generate website: v0 API requires a Premium or Team plan. Your API key is valid, but your account needs to be upgraded. Please visit https://v0.app/chat/settings/billing to upgrade your plan.`);
      }
      
      throw new Error(`Failed to generate website: ${error.message}`);
    }
  }

  /**
   * Edit an existing website with an add-on prompt (same chat flow).
   * Loads current site, sends to v0 with edit instruction, parses and sanitizes, updates DB and files.
   */
  private static readonly DEFAULT_TEST_USER_ID = '691df5ddac69fc46beca44b3';

  async editWebsite(websiteId: string, userId: string, editPrompt: string) {
    console.log('WebsiteService.editWebsite - Starting:', { websiteId, userId, editPromptLength: editPrompt.length });
    const website = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    if (!website) {
      const err = new Error('Website not found or access denied') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    const isOwner = website.userId === userId;
    const isDefaultTestUserSite = website.userId === WebsiteService.DEFAULT_TEST_USER_ID;
    if (!isOwner && !isDefaultTestUserSite) {
      const err = new Error('Website not found or access denied') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    if (isDefaultTestUserSite && userId !== WebsiteService.DEFAULT_TEST_USER_ID) {
      website.userId = userId;
      await this.websiteRepository.save(website);
    }

    const isComponentBased = (website.components?.length ?? 0) > 0;
    const model = process.env.V0_MODEL || 'v0-1.5-lg';

    const editSystemPrompt = isComponentBased
      ? `You are an expert editor for React/Vite websites. You will receive the CURRENT website as a JSON object with "components" (array of { name, type, path, code, language }) and "viteConfig" (object with packageJson, viteConfig, indexHtml, mainJsx, styleCss). The user will give you ONE edit instruction. Your job is to return the COMPLETE updated website in the EXACT SAME JSON structure. Rules:
- Return ONLY valid JSON. No markdown, no explanation, no code blocks. Pure JSON starting with { and ending with }.
- Change ONLY what the user asked. Keep all other components and config identical.
- Preserve component names, paths, and file structure unless the user explicitly asks to add/rename/remove.
- If adding new components, add them to the components array and update mainJsx to import and render them.
- Keep the same code style and patterns. Do not strip or simplify existing code.
- Output the full JSON: { "components": [...], "viteConfig": { ... } }.`
      : `You are an expert editor for HTML/CSS/JS websites. You will receive the CURRENT website as HTML, CSS, and JS. The user will give you ONE edit instruction. Return a JSON object with "html", "css", "js" containing the FULL updated code. Rules:
- Return ONLY valid JSON: { "html": "...", "css": "...", "js": "..." }. No markdown, no explanation.
- Change ONLY what the user asked. Keep everything else identical.
- Escape strings for JSON (newlines as \\n, quotes escaped).`;

    const userMessage = isComponentBased
      ? `Current website (JSON):\n${JSON.stringify({ components: website.components || [], viteConfig: website.viteConfig || {} })}\n\nUser edit request: ${editPrompt}`
      : `Current HTML:\n${website.htmlCode || ''}\n\nCurrent CSS:\n${website.cssCode || ''}\n\nCurrent JS:\n${website.jsCode || ''}\n\nUser edit request: ${editPrompt}`;

    let responseContent: string = '{}';
    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: editSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.5,
      max_tokens: 32768,
    });
    responseContent = completion.choices[0]?.message?.content || '{}';

    let websiteCode = this.parseV0Response(responseContent);
    if (!websiteCode) {
      websiteCode = this.extractCodeFromResponse(responseContent);
    }
    if (websiteCode?.files && Array.isArray(websiteCode.files)) {
      websiteCode = this.convertV0FilesToStructure(websiteCode);
    }

    const getPlaceholderUrl = await this.buildPlaceholderUrlGetter(website.websiteName || '', website.prompt || editPrompt);
    const sanitizeCode = (raw: string) =>
      this.sanitizeInvalidConditionAssignment(
        this.sanitizeJsxDollarInterpolation(this.transformJsxAttributeTemplateLiterals(raw)),
      );

    if (websiteCode?.components?.length) {
      for (let i = 0; i < websiteCode.components.length; i++) {
        let code = sanitizeCode(websiteCode.components[i].code || '');
        code = await this.validateAndReplaceBrokenImageUrls(code, getPlaceholderUrl);
        code = this.replaceBrokenImageUrls(code);
        websiteCode.components[i].code = this.wrapAdjacentJsxInFragment(code);
      }
    }
    if (websiteCode?.viteConfig?.mainJsx) {
      let main = sanitizeCode(websiteCode.viteConfig.mainJsx);
      main = await this.validateAndReplaceBrokenImageUrls(main, getPlaceholderUrl);
      main = this.replaceBrokenImageUrls(main);
      websiteCode.viteConfig.mainJsx = this.wrapAdjacentJsxInFragment(main);
    }
    if (websiteCode?.viteConfig?.mainJs) {
      let main = sanitizeCode(websiteCode.viteConfig.mainJs);
      main = await this.validateAndReplaceBrokenImageUrls(main, getPlaceholderUrl);
      main = this.replaceBrokenImageUrls(main);
      websiteCode.viteConfig.mainJs = this.wrapAdjacentJsxInFragment(main);
    }
    if (websiteCode?.html) {
      websiteCode.html = await this.validateAndReplaceBrokenImageUrls(websiteCode.html, getPlaceholderUrl);
      websiteCode.html = this.replaceBrokenImageUrls(websiteCode.html);
    }
    if (websiteCode?.css) websiteCode.css = this.replaceBrokenImageUrls(websiteCode.css);
    if (websiteCode?.js) {
      websiteCode.js = await this.validateAndReplaceBrokenImageUrls(websiteCode.js, getPlaceholderUrl);
      websiteCode.js = this.replaceBrokenImageUrls(websiteCode.js);
    }

    const componentNamesForStrip = (websiteCode?.components || []).map((c: any) => (c.name || '').replace(/\s+/g, ''));
    if (componentNamesForStrip.length > 0 && websiteCode?.viteConfig) {
      const stripPlaceholders = (code: string) => {
        let out = code;
        componentNamesForStrip.forEach((name: string) => {
          if (!name) return;
          out = out.replace(new RegExp(`const\\s+${name}\\s*=\\s*\\[\\]\\s*;?\\s*`, 'g'), '');
        });
        return out;
      };
      if (websiteCode.viteConfig.mainJsx) websiteCode.viteConfig.mainJsx = stripPlaceholders(websiteCode.viteConfig.mainJsx);
      if (websiteCode.viteConfig.mainJs) websiteCode.viteConfig.mainJs = stripPlaceholders(websiteCode.viteConfig.mainJs);
    }

    const components = websiteCode.components || [];
    const viteConfig = websiteCode.viteConfig || null;
    const htmlCode = websiteCode.html || websiteCode.HTML || website.htmlCode || '<div>Generated Website</div>';
    const cssCode = websiteCode.css || websiteCode.CSS || website.cssCode || 'body { margin: 0; padding: 0; }';
    const jsCode = websiteCode.js || websiteCode.JS || websiteCode.javascript || website.jsCode || '// JavaScript code';

    const hasValidCode =
      components.length > 0 ||
      (htmlCode !== '<div>Generated Website</div>' || cssCode !== 'body { margin: 0; padding: 0; }');
    if (!hasValidCode) {
      const err = new Error('The AI did not return valid website code for the edit. Try rephrasing your request.') as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    if (components.length > 0) {
      website.components = components;
      website.viteConfig = viteConfig || website.viteConfig;
      website.htmlCode = '';
      website.cssCode = '';
      website.jsCode = '';
    } else {
      website.htmlCode = htmlCode;
      website.cssCode = cssCode;
      website.jsCode = jsCode;
    }
    website.prompt = (website.prompt || '') + '\n[Edit] ' + editPrompt;
    const savedWebsite = await this.websiteRepository.save(website);

    let previewUrl: string | undefined;
    if (components.length > 0) {
      const buildResult = await this.getPreviewUrl(websiteId, userId);
      if (buildResult.success === true) {
        previewUrl = buildResult.previewUrl;
      } else {
        console.warn('WebsiteService.editWebsite - Preview build failed after edit:', buildResult.error, buildResult.log);
      }
    } else {
      await this.saveWebsiteFiles(userId, websiteId, htmlCode, cssCode, jsCode);
    }

    console.log('WebsiteService.editWebsite - Success, website ID:', websiteId);
    return {
      ...savedWebsite,
      id: savedWebsite.id.toString(),
      components: components.length > 0 ? components : savedWebsite.components,
      viteConfig: components.length > 0 ? viteConfig : savedWebsite.viteConfig,
      htmlCode: savedWebsite.htmlCode,
      cssCode: savedWebsite.cssCode,
      jsCode: savedWebsite.jsCode,
      message: 'Website updated successfully',
      ...(previewUrl && { previewUrl }),
    };
  }

  /**
   * Enhances user prompts by automatically adding design and functionality requirements
   * If the prompt is already detailed, it preserves all details and adds production-ready requirements
   * If minimal, it's enhanced with comprehensive requirements
   */
  private enhanceUserPrompt(userPrompt: string): string {
    const lowerPrompt = userPrompt.toLowerCase();
    
    // If prompt is already detailed (user provided comprehensive requirements), preserve it and add emphasis
    if (userPrompt.length > 800) {
      return `Create a complete, production-ready Vite project with component-based architecture. Implement EVERYTHING mentioned below with stunning design and full functionality:\n\n${userPrompt}\n\nCRITICAL IMPLEMENTATION REQUIREMENTS:
- Break down the UI into logical, reusable components (Header, Hero, Services, About, Contact, Footer, etc.)
- Each component should be a separate ES module file in src/components/
- Use Vite project structure: index.html, src/main.js, src/style.css, vite.config.js, package.json
- Implement ALL features, pages, and design elements mentioned above
- Use extensive CSS styling: gradients, shadows, animations, modern layouts
- Add smooth animations and transitions throughout (@keyframes, CSS transitions)
- Make it production-ready with professional polish
- Ensure responsive design for all screen sizes
- Use Google Fonts for typography (import in CSS)
- Add interactive hover effects on all buttons, links, and cards
- Include proper form validation and error handling
- Make the design stunning and visually impressive
- Every element must be beautifully styled - NO minimal designs
- Return component-based JSON structure with components array and viteConfig object`;
    }
    
    // Base enhancement for minimal prompts
    let enhanced = `Create a ${userPrompt} as a Vite project with component-based architecture. Break down the UI into reusable components:\n\n`;
    
    // Add specific enhancements based on prompt type
    if (lowerPrompt.includes('shop') || lowerPrompt.includes('store') || lowerPrompt.includes('business') || lowerPrompt.includes('cake') || lowerPrompt.includes('bakery')) {
      enhanced += `FUNCTIONALITY:
- Complete product/service showcase with interactive elements
- Shopping cart functionality (add to cart, remove, update quantities, localStorage persistence)
- Product filtering and search functionality
- Image galleries with lightbox or modal views
- Contact form with full validation and submission handling
- Smooth scrolling navigation with active section highlighting
- Interactive product cards with hover effects and animations
- Price display and formatting
- Order/booking system if applicable
- Social media integration (icons and links)
- Newsletter signup with validation
- Testimonials/reviews section with carousel or grid
- Smooth page transitions and scroll animations
- Form validation with real-time feedback

DESIGN:
- STUNNING hero section with large, impressive visuals, compelling headline, and CTA buttons
- Modern navigation bar with glassmorphism or solid background, smooth scroll effects, active states
- Beautiful product/service cards with:
  * High-quality visual design with multiple box-shadows (0 4px 6px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.15))
  * Gradient overlays or modern color schemes
  * Smooth hover animations (transform: scale(1.05), shadow changes, color transitions)
  * Border-radius for modern rounded corners
  * Professional typography and spacing
- Eye-catching call-to-action buttons with gradients, shadows, and hover animations
- Beautiful color palette (warm tones for food/bakery, cool tones for tech)
- Professional typography using Google Fonts (import in CSS with @import)
- Smooth animations throughout: @keyframes for fade-ins, slide-ins, scale effects
- Modern layout with CSS Grid for product grids, Flexbox for components
- Responsive design that looks amazing on all devices
- Footer with social links, contact info, styled beautifully
- Loading states and smooth transitions
- Professional shadows and depth effects
- Background gradients or patterns that enhance the design
- Interactive elements that respond to user actions with visual feedback\n\n`;
    } else if (lowerPrompt.includes('calculator') || lowerPrompt.includes('calc')) {
      enhanced += `FUNCTIONALITY:
- Full calculator functionality with all basic operations (+, -, ×, ÷)
- Support for decimal numbers and negative numbers
- Clear button to reset
- Backspace/delete functionality
- Keyboard support for number and operation inputs
- Handle division by zero and other edge cases
- Display calculation history or previous result

DESIGN:
- Modern, sleek calculator interface with professional look
- Beautiful button design with hover and active states, smooth animations
- Gradient backgrounds or modern color schemes
- Large, readable display screen with proper typography
- Responsive grid layout for buttons
- Visual feedback for all interactions (transform, shadow changes)
- Professional typography for numbers and operations
- Glassmorphism or modern design aesthetic
- Smooth transitions and micro-interactions\n\n`;
    } else if (lowerPrompt.includes('todo') || lowerPrompt.includes('task')) {
      enhanced += `FUNCTIONALITY:
- Add, edit, delete, and mark tasks as complete
- Persist tasks in localStorage
- Filter tasks (all, active, completed)
- Clear completed tasks
- Task priority levels or categories
- Search/filter functionality

DESIGN:
- Clean, modern task management interface
- Beautiful card-based design for tasks with shadows and hover effects
- Smooth animations for adding/removing tasks
- Color-coded priorities or categories
- Checkbox animations and transitions
- Empty state with helpful messaging
- Responsive design for mobile task management
- Modern color palette
- Professional typography and spacing\n\n`;
    } else {
      // Generic enhancement
      enhanced += `FUNCTIONALITY:
- All features must be fully implemented and working - NO placeholders
- Smooth user interactions with immediate visual feedback
- Proper error handling and edge cases
- Complete input validation with real-time feedback
- Interactive elements: modals, dropdowns, tabs where appropriate
- Data persistence using localStorage where needed
- Smooth animations and transitions on all interactions
- Responsive behavior across all devices

DESIGN (MANDATORY - PRODUCTION-READY):
- STUNNING, modern design that looks professional and expensive
- Rich color schemes: gradients, modern palettes, sophisticated combinations
- Extensive CSS styling: multiple box-shadows, border-radius, gradients
- Smooth animations: @keyframes, CSS transitions on ALL interactive elements
- Modern design elements: glassmorphism, card layouts, depth effects
- Professional typography with Google Fonts
- Interactive feedback: hover effects on ALL buttons/links, active states
- Hero section: Large, impressive section with compelling visuals
- Navigation: Modern, styled with smooth scroll effects
- Responsive: Mobile-first design that adapts beautifully
- NO minimal designs - every element must be styled to perfection\n\n`;
    }
    
    // Add universal requirements
    enhanced += `CRITICAL PRODUCTION-READY REQUIREMENTS:
- This MUST be a production-ready Vite project with component-based architecture
- Break UI into components: Header, Hero, Services, About, Contact, Footer, etc.
- Each component as separate ES module file (e.g., src/components/Header.js)
- Vite structure: index.html loads /src/main.js, src/style.css for styles
- NO minimal or basic designs - every element must be beautifully styled
- Extensive CSS: Use gradients, shadows, animations, modern layouts extensively
- Rich visual design: Colors, typography, spacing must be impressive
- Complete functionality: All features must work perfectly
- Smooth animations: Add transitions and keyframe animations throughout
- Professional polish: The website should look like it cost thousands to build
- Modern CSS: Custom Properties, Grid, Flexbox, @keyframes, Google Fonts
- Interactive elements: Every button/link must have hover effects
- Responsive design: Must look perfect on mobile, tablet, and desktop
- Return JSON with components array and viteConfig object
- The final result should be STUNNING and make users say "wow"`;

    return enhanced;
  }

  /**
   * Infer placeholder dimensions from code context (hero, thumbnail, avatar, etc.)
   * so images match the intended use (banner = wide, icon = small, product = medium).
   */
  private inferImageDimensions(code: string, urlStartIndex: number): { width: number; height: number } {
    const contextStart = Math.max(0, urlStartIndex - 400);
    const contextEnd = Math.min(code.length, urlStartIndex + 400);
    const context = code.slice(contextStart, contextEnd).toLowerCase();
    // Hero / banner: wide
    if (/\b(hero|banner|header-bg|cover|jumbotron|full-width)\b/.test(context)) return { width: 1200, height: 600 };
    // Thumbnail / avatar / icon / logo: small square
    if (/\b(thumbnail|thumb|avatar|icon|logo|favicon|profile-pic|user-img)\b/.test(context)) return { width: 96, height: 96 };
    // Card / product: medium
    if (/\b(card|product|item-img|gallery|grid-item)\b/.test(context)) return { width: 400, height: 300 };
    // Default
    return { width: 400, height: 300 };
  }

  /**
   * Derive Unsplash search query from website name and prompt so fallback images match the site.
   * Uses a topic map for common themes, then falls back to dynamic extraction from prompt/name so any niche works.
   */
  private deriveImageSearchQuery(websiteName?: string, prompt?: string): string {
    const text = `${websiteName || ''} ${prompt || ''}`.toLowerCase();
    const topicMap: Array<{ keywords: RegExp; query: string }> = [
      { keywords: /\b(shoes?|sneakers?|kicks?|footwear|trainers?|boots|heels|sandals)\b/, query: 'sneakers shoes' },
      { keywords: /\b(clothing|fashion|apparel|tshirt|t-shirt|dress|jacket|wear)\b/, query: 'fashion clothing' },
      { keywords: /\b(food|restaurant|cafe|coffee|cuisine|meal)\b/, query: 'food restaurant' },
      { keywords: /\b(tech|laptop|gadget|electronics|phone)\b/, query: 'technology laptop' },
      { keywords: /\b(travel|mountain|hiking|nature|landscape)\b/, query: 'travel landscape' },
      { keywords: /\b(fitness|gym|workout|sport)\b/, query: 'fitness gym' },
      { keywords: /\b(book|reading|library)\b/, query: 'books' },
      { keywords: /\b(jewelry|watch|accessories)\b/, query: 'jewelry accessories' },
      { keywords: /\b(furniture|home|interior)\b/, query: 'furniture home' },
      { keywords: /\b(beauty|cosmetics|skincare)\b/, query: 'beauty cosmetics' },
    ];
    for (const { keywords, query } of topicMap) {
      if (keywords.test(text)) return query;
    }
    // Dynamic: extract meaningful words from prompt (any topic – yoga mats, pet food, bicycles, etc.)
    const stopwords = new Set([
      'create', 'build', 'website', 'make', 'for', 'the', 'an', 'a', 'my', 'with', 'and', 'that', 'this',
      'site', 'page', 'design', 'modern', 'beautiful', 'responsive', 'ecommerce', 'store', 'shop', 'sell', 'selling',
    ]);
    const promptWords = (prompt || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopwords.has(w));
    const fromPrompt = promptWords.slice(0, 5).join(' ').trim();
    if (fromPrompt.length > 0) return fromPrompt;
    // Fallback: website name as query (e.g. "ZenMats" → "zen mats", "KICKS" stays "kicks")
    const name = (websiteName || '').trim().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/gi, '').toLowerCase();
    if (name.length > 0) return name;
    return 'product';
  }

  /**
   * Fetch one relevant Unsplash image URL for the given search query (same theme as the site). Returns null if no key or API fail.
   */
  private async fetchRelevantUnsplashUrl(searchQuery: string, width: number, height: number): Promise<string | null> {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return null;
    try {
      const res = await axios.get<{ results: Array<{ urls: { regular: string; raw?: string } }> }>(
        'https://api.unsplash.com/search/photos',
        {
          params: { query: searchQuery, per_page: 1, client_id: key },
          timeout: 5000,
        },
      );
      const url = res.data?.results?.[0]?.urls?.regular || res.data?.results?.[0]?.urls?.raw;
      if (!url) return null;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}w=${width}&h=${height}&fit=crop`;
    } catch {
      return null;
    }
  }

  /**
   * Fetch multiple different Unsplash image URLs for the same topic, HEAD-check each; return only URLs that don't 404/redirect/timeout.
   */
  private async fetchMultipleValidatedUnsplashUrls(searchQuery: string, count: number): Promise<string[]> {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return [];
    try {
      const res = await axios.get<{ results: Array<{ urls: { regular: string; raw?: string } }> }>(
        'https://api.unsplash.com/search/photos',
        {
          params: { query: searchQuery, per_page: Math.min(count, 30), client_id: key },
          timeout: 8000,
        },
      );
      const results = res.data?.results || [];
      const validated: string[] = [];
      for (const r of results) {
        const base = r?.urls?.regular || r?.urls?.raw;
        if (!base) continue;
        if (await this.isImageUrlOk(base)) {
          validated.push(base);
          if (validated.length >= count) break;
        }
      }
      if (validated.length > 0) {
        console.log('[IMAGE] Fetched', validated.length, 'different validated Unsplash images for topic:', JSON.stringify(searchQuery));
      }
      return validated;
    } catch {
      return [];
    }
  }

  /**
   * Return a single Unsplash image URL for the given site context, HEAD-checked so it does not 404.
   * Used by the preview fallback: when an image fails in the iframe, the client calls this to get a validated Unsplash URL.
   */
  async getValidatedPlaceholderImage(
    websiteName: string,
    prompt: string,
    width: number,
    height: number,
  ): Promise<string | null> {
    const query = this.deriveImageSearchQuery(websiteName, prompt);
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return null;
    try {
      const res = await axios.get<{ results: Array<{ urls: { regular: string; raw?: string } }> }>(
        'https://api.unsplash.com/search/photos',
        {
          params: { query, per_page: 5, client_id: key },
          timeout: 5000,
        },
      );
      const results = res.data?.results || [];
      const w = Math.min(1200, Math.max(48, width));
      const h = Math.min(800, Math.max(48, height));
      for (const r of results) {
        const base = r?.urls?.regular || r?.urls?.raw;
        if (!base) continue;
        const url = this.setUnsplashDimensions(base, w, h);
        if (await this.isImageUrlOk(url)) {
          console.log('[IMAGE] Validated placeholder (no 404):', url.substring(0, 60) + '...');
          return url;
        }
      }
      const first = results[0]?.urls?.regular || results[0]?.urls?.raw;
      if (first) {
        const url = this.setUnsplashDimensions(first, w, h);
        console.log('[IMAGE] No HEAD-ok result; returning first Unsplash anyway:', url.substring(0, 60) + '...');
        return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if an image URL returns 2xx (HEAD request). Used to replace 404s (e.g. broken Unsplash) with a relevant fallback.
   */
  private async isImageUrlOk(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, {
        timeout: 4000,
        maxRedirects: 3,
        validateStatus: () => true,
        headers: { 'User-Agent': 'WebGenius/1.0' },
      });
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  }

  /**
   * Validate image URLs and replace 404/failed ones with relevant fallbacks: different Unsplash images per replacement (same topic), HEAD-checked so no 404/redirect/timeout.
   */
  private async validateAndReplaceBrokenImageUrls(
    code: string,
    getPlaceholderUrl: (width: number, height: number, index?: number) => Promise<string>,
  ): Promise<string> {
    if (!code || typeof code !== 'string') return code;
    const imageUrlRegex = /https?:\/\/[^\s"'<>)\]]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>)\]]*)?|https?:\/\/(?:images\.)?unsplash\.com\/[^\s"'<>)\]]+/gi;
    const allMatches = code.match(imageUrlRegex) || [];
    const unique = [...new Set(allMatches)];
    const toReplace = new Set<string>();
    for (const url of unique.slice(0, 25)) {
      const ok = await this.isImageUrlOk(url);
      const short = url.length > 60 ? url.substring(0, 60) + '...' : url;
      if (ok) {
        console.log('[IMAGE] URL OK:', short);
      } else {
        toReplace.add(url);
        console.log('[IMAGE] URL BROKEN (will replace):', short);
      }
    }
    if (toReplace.size === 0) return code;
    const replacementSpecs: { width: number; height: number }[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(imageUrlRegex.source, 'gi');
    while ((m = re.exec(code)) !== null) {
      if (toReplace.has(m[0])) {
        const { width, height } = this.inferImageDimensions(code, m.index);
        replacementSpecs.push({ width, height });
      }
    }
    const replacementUrls = await Promise.all(
      replacementSpecs.map(({ width, height }, i) => getPlaceholderUrl(width, height, i)),
    );
    let i = 0;
    const result = code.replace(imageUrlRegex, (match: string) => {
      if (!toReplace.has(match)) return match;
      const newUrl = replacementUrls[i++] ?? `https://picsum.photos/400/300`;
      const source = newUrl.includes('unsplash') ? 'Unsplash' : 'Picsum';
      console.log('[IMAGE] Replaced broken →', source + ':', (match.length > 50 ? match.substring(0, 50) + '...' : match), '→', newUrl.substring(0, 55) + (newUrl.length > 55 ? '...' : ''));
      return newUrl;
    });
    return result;
  }

  /** Set w/h on an Unsplash URL (replace existing or append). */
  private setUnsplashDimensions(url: string, w: number, h: number): string {
    const u = new URL(url);
    u.searchParams.set('w', String(w));
    u.searchParams.set('h', String(h));
    u.searchParams.set('fit', 'crop');
    return u.toString();
  }

  /** Build placeholder URL getter: multiple different Unsplash images for the site theme (each replacement gets a different image), or Picsum fallback. */
  private async buildPlaceholderUrlGetter(
    websiteName: string,
    prompt: string,
  ): Promise<(width: number, height: number, index?: number) => Promise<string>> {
    const query = this.deriveImageSearchQuery(websiteName, prompt);
    console.log('[IMAGE] Derived search query for fallback:', JSON.stringify(query), '| site:', websiteName || '(none)');
    const validatedUrls: string[] = [];
    try {
      const urls = await this.fetchMultipleValidatedUnsplashUrls(query, 20);
      validatedUrls.push(...urls);
      if (validatedUrls.length === 0) {
        console.log('[IMAGE] Fallback image source: Picsum (no Unsplash result or no key)');
      }
    } catch {
      console.log('[IMAGE] Fallback image source: Picsum (Unsplash API error)');
    }
    return async (width: number, height: number, index: number = 0) => {
      const w = Math.min(1200, Math.max(48, width));
      const h = Math.min(800, Math.max(48, height));
      if (validatedUrls.length > 0) {
        const base = validatedUrls[index % validatedUrls.length];
        return this.setUnsplashDimensions(base, w, h);
      }
      return `https://picsum.photos/${w}/${h}?random=${index}`;
    };
  }

  /** Unsplash placeholder URL (single stable image, resized) so generated code uses Unsplash not Picsum. */
  private unsplashPlaceholderUrl(width: number, height: number): string {
    const w = Math.min(1200, Math.max(48, width));
    const h = Math.min(800, Math.max(48, height));
    return `https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=${w}&h=${h}&fit=crop`;
  }

  /**
   * Replace imgur.com (and similar) image URLs with Unsplash placeholder images
   * sized according to context (hero, thumbnail, product, etc.).
   */
  private replaceBrokenImageUrls(code: string): string {
    if (!code || typeof code !== 'string') return code;
    const imgurRegex = /https?:\/\/(?:i\.)?imgur\.com\/[^\s"'<>)\]]+/gi;
    return code.replace(imgurRegex, (match) => {
      const idx = code.indexOf(match);
      const { width, height } = this.inferImageDimensions(code, idx >= 0 ? idx : 0);
      return this.unsplashPlaceholderUrl(width, height);
    });
  }

  /**
   * Wrap adjacent JSX elements in object values (e.g. icons map) in a React fragment
   * so "Adjacent JSX elements must be wrapped in an enclosing tag" is avoided.
   */
  private wrapAdjacentJsxInFragment(code: string): string {
    if (!code || typeof code !== 'string') return code;
    const adjacentJsxInObject = /:\s*((?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/>\s*){2,})(\s*)(,|\})/g;
    return code.replace(adjacentJsxInObject, ': <>$1</>$2$3');
  }

  /**
   * Fix invalid "invalid left-hand side in assignment" errors from AI-generated code.
   * e.g. "if (!isOpen || !product = {})" is invalid; replace with "if (!isOpen || !product)".
   * Also fix typo in destructuring: product = {}s, → product = {}, (stray letter after {} or []).
   */
  private sanitizeInvalidConditionAssignment(code: string): string {
    if (!code || typeof code !== 'string') return code;
    return code
      .replace(/!\s*(\w+)\s*=\s*\{\s*\}/g, '!$1')
      .replace(/!\s*(\w+)\s*=\s*\[\s*\]/g, '!$1')
      .replace(/=\s*\{\s*\}\s*([a-zA-Z])(?=\s*[,)\}\]])/g, '= {} ')
      .replace(/=\s*\[\s*\]\s*([a-zA-Z])(?=\s*[,)\}\]])/g, '= [] ');
  }

  /**
   * Rewrite JSX attribute template literals to string concatenation so preview never sees backticks
   * (avoids Babel/Unicode escape errors). e.g. className={`header__nav ${x}`} → className={'header__nav ' + (x)}
   */
  private transformJsxAttributeTemplateLiterals(code: string): string {
    if (!code || typeof code !== 'string') return code;
    return code.replace(/\{\s*`((?:[^`\\]|\\.)*)`\s*\}/g, (match, content) => {
      if (!content.includes('${')) return match;
      const parts: ({ type: 'str'; value: string } | { type: 'expr'; value: string })[] = [];
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

  /**
   * Fix JSX that uses ${expr} for "dollar + value". In-browser Babel treats ${ as start of a template
   * literal and throws "Unterminated template". Rewrite to {'$' + expr} (only in JSX text context).
   */
  private sanitizeJsxDollarInterpolation(code: string): string {
    // Replace ${expr} when it appears between > and < (JSX text content). Babel parses ${ as
    // template literal start → "Unterminated template". Rewrite to {'$' + expr}.
    return code.replace(/>([^<]*?)\$\{([^}]+)\}([^<]*?)</g, (_match, before, expr, after) =>
      `>${before}{'$' + ${expr}}${after}<`
    );
  }

  /**
   * Converts v0 API "files" format into our "components" + "viteConfig" structure
   * so the rest of the pipeline works (e.g. app/page.tsx + components/emi-calculator.tsx → components array + mainJsx).
   */
  private convertV0FilesToStructure(websiteCode: { files: Array<{ path: string; content: string }> }): any {
    const files = websiteCode.files || [];
    const componentFiles = files.filter((f: any) => /^components?\//i.test(f.path) && /\.(tsx|jsx)$/i.test(f.path));
    const pageFiles = files.filter((f: any) => /^app\//i.test(f.path) && /\.(tsx|jsx)$/i.test(f.path));
    const styleFiles = files.filter((f: any) => /\.(css|scss)$/i.test(f.path));

    const pathToComponentName = (filePath: string): string => {
      const base = path.basename(filePath, path.extname(filePath));
      return base.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('');
    };

    const components = componentFiles.map((f: any) => ({
      name: pathToComponentName(f.path),
      type: 'component',
      path: f.path.startsWith('src/') ? f.path : `src/${f.path}`,
      code: f.content || '',
      language: 'jsx',
    }));

    let mainJsx = '';
    if (pageFiles.length > 0) {
      let pageContent = pageFiles[0].content || '';
      pageContent = pageContent
        .replace(/import\s+[\w{}\s,*]+\s+from\s+['"][^'"]+['"]\s*;?\s*/gm, '')
        .replace(/export\s+default\s+function\s+(\w+)\s*\(/g, 'function App(')
        .replace(/export\s+default\s+function\s*\(/g, 'function App(');
      const defaultExportMatch = pageContent.match(/export\s+default\s+(\w+)\s*;?\s*$/m);
      if (defaultExportMatch) {
        const exportedName = defaultExportMatch[1];
        if (exportedName !== 'App') {
          pageContent = pageContent
            .replace(new RegExp(`\\bconst\\s+${exportedName}\\s*=`, 'g'), 'const App =')
            .replace(new RegExp(`\\bfunction\\s+${exportedName}\\s*\\(`, 'g'), 'function App(')
            .replace(/export\s+default\s+\w+\s*;?\s*$/m, '');
        } else {
          pageContent = pageContent.replace(/export\s+default\s+\w+\s*;?\s*$/m, '');
        }
      }
      pageContent = pageContent.replace(/export\s+default\s+/g, '');
      if (!pageContent.includes('ReactDOM.createRoot') && !pageContent.includes('ReactDOM.render')) {
        pageContent += "\n\nconst rootEl = document.getElementById('root');\nif (rootEl && typeof ReactDOM !== 'undefined') {\n  if (typeof ReactDOM.createRoot === 'function') {\n    ReactDOM.createRoot(rootEl).render(<App />);\n  } else {\n    ReactDOM.render(<App />, rootEl);\n  }\n}\n";
      }
      mainJsx = pageContent;
    } else if (components.length > 0) {
      const names = components.map((c: any) => c.name).join(', ');
      mainJsx = `function App() { return (<>${components.map((c: any) => `<${c.name} />`).join(' ')}</>); }\nconst rootEl = document.getElementById('root');\nif (rootEl && typeof ReactDOM !== 'undefined') {\n  if (typeof ReactDOM.createRoot === 'function') {\n    ReactDOM.createRoot(rootEl).render(<App />);\n  } else {\n    ReactDOM.render(<App />, rootEl);\n  }\n}\n`;
    }

    const styleCss = styleFiles.map((f: any) => f.content || '').join('\n\n') || '';

    const { files: _files, viteConfig: existingVite, ...rest } = websiteCode as { files: Array<{ path: string; content: string }>; viteConfig?: any; [k: string]: any };
    const result: { components: any[]; viteConfig: any; [k: string]: any } = {
      ...rest,
      components,
      viteConfig: {
        ...(existingVite || {}),
        mainJsx: mainJsx || existingVite?.mainJsx,
        mainJs: mainJsx || existingVite?.mainJs,
        styleCss: styleCss || existingVite?.styleCss,
      },
    };
    console.log('WebsiteService.convertV0FilesToStructure - Converted files to structure:', { componentCount: components.length, hasMainJsx: !!mainJsx, hasStyleCss: !!styleCss });
    return result;
  }

  /**
   * Attempts to repair JSON truncated mid-string (e.g. by max_tokens limit).
   * Appends a closing quote and then closes open objects/arrays.
   * (We don't skip when content ends with } or ] — that may be inside a string, e.g. CSS.)
   */
  private tryRepairTruncatedJson(content: string): string | null {
    const trimmed = content.trim();
    if (!trimmed) return null;
    // Shape: { "components": [ ... ], "viteConfig": { ... } }
    const suffixes = [
      '"\n}\n]\n}',           // truncated inside last component field → close string, component }, array ], root }
      '"\n}\n}',              // truncated inside viteConfig (e.g. styleCss) → close string, viteConfig }, root }
      '"\n]\n}',              // truncated after last component object → close string, array ], root }
    ];
    for (const suffix of suffixes) {
      try {
        const repaired = trimmed + suffix;
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === 'object') return repaired;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Detect if the v0 API returned a refusal/safety message instead of code (e.g. "I'm sorry. I'm not able to assist with that.").
   */
  private isRefusalResponse(response: string): boolean {
    if (!response || typeof response !== 'string') return false;
    const trimmed = response.trim();
    if (trimmed.length > 500) return false;
    const lower = trimmed.toLowerCase();
    const refusalPhrases = [
      "i'm sorry",
      "i am sorry",
      "not able to assist",
      "cannot assist",
      "can't assist",
      "i cannot",
      "i can't",
      "unable to assist",
      "refuse",
      "decline",
      "cannot fulfill",
      "cannot help",
      "not able to help",
      "against my",
      "policy",
      "inappropriate",
      "cannot generate",
      "won't be able",
    ];
    return refusalPhrases.some((phrase) => lower.includes(phrase));
  }

  /**
   * Parses v0 API response which may be raw JSON or wrapped in markdown code fences (```json ... ```).
   * Strips fences without using a greedy regex that could truncate on backticks inside code strings.
   * On "Unterminated string" (truncation), attempts to repair and re-parse.
   */
  private parseV0Response(response: string): any {
    if (!response || typeof response !== 'string') {
      console.log('WebsiteService.parseV0Response - Invalid response (empty or not string)');
      return null;
    }
    let content = response.trim();
    console.log('WebsiteService.parseV0Response - Response length:', response.length, 'starts with:', JSON.stringify(content.substring(0, 20)), 'ends with:', JSON.stringify(content.substring(Math.max(0, content.length - 30))));

    // Strip leading markdown fence: ```json or ``` (with optional newline)
    content = content.replace(/^\s*```(?:json)?\s*\n?/i, '');
    content = content.replace(/\n?\s*```\s*$/m, '');
    content = content.trim();
    console.log('WebsiteService.parseV0Response - After strip: length=', content.length, 'starts with:', JSON.stringify(content.substring(0, 80)), 'ends with:', JSON.stringify(content.substring(Math.max(0, content.length - 80))));

    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        console.log('WebsiteService.parseV0Response - Parsed JSON (fence-stripped)', {
          hasComponents: Array.isArray(parsed.components),
          componentCount: Array.isArray(parsed.components) ? parsed.components.length : 0,
        });
        return parsed;
      }
    } catch (e: any) {
      const isTruncation = /Unterminated string|Unexpected end of JSON input|position \d+/.test(e?.message || '');
      if (isTruncation) {
        console.warn('WebsiteService.parseV0Response - JSON likely truncated, attempting repair:', e?.message);
        const repaired = this.tryRepairTruncatedJson(content);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired);
            if (parsed && typeof parsed === 'object') {
              console.log('WebsiteService.parseV0Response - Parsed after truncation repair', {
                hasComponents: Array.isArray(parsed.components),
                componentCount: Array.isArray(parsed.components) ? parsed.components.length : 0,
              });
              return parsed;
            }
          } catch (e2: any) {
            console.warn('WebsiteService.parseV0Response - Repair parse failed:', e2?.message);
          }
        }
      }
      console.warn('WebsiteService.parseV0Response - Fence-stripped JSON parse failed:', e?.message);
      console.log('WebsiteService.parseV0Response - Parse error at/content sample (chars 0-400):', content.substring(0, 400));
    }

    // Try parsing the original response as raw JSON (no fences)
    try {
      const parsed = JSON.parse(response.trim());
      if (parsed && typeof parsed === 'object') {
        console.log('WebsiteService.parseV0Response - Parsed JSON (raw)');
        return parsed;
      }
    } catch (e: any) {
      console.warn('WebsiteService.parseV0Response - Raw JSON parse failed:', e?.message);
    }

    console.log('WebsiteService.parseV0Response - Returning null (all parse attempts failed)');
    return null;
  }

  private extractCodeFromResponse(response: string): any {
    console.log('WebsiteService.extractCodeFromResponse - Extracting from response');
    
    // Try fence-stripped parse first (same logic as parseV0Response but we need component/legacy shape)
    const parsed = this.parseV0Response(response);
    if (parsed) {
      console.log('WebsiteService.extractCodeFromResponse - Using parseV0Response result');
      return parsed;
    }
    
    // Try to find component-based JSON object in the response (fallback for malformed output)
    const componentJsonMatch = response.match(/\{[\s\S]*"components"[\s\S]*\}/);
    if (componentJsonMatch) {
      let matched = componentJsonMatch[0];
      console.log('WebsiteService.extractCodeFromResponse - Component JSON match: length=', matched.length, 'starts:', matched.substring(0, 60), '... ends:', matched.substring(Math.max(0, matched.length - 60)));
      try {
        const parsed = JSON.parse(matched);
        console.log('WebsiteService.extractCodeFromResponse - Found component-based JSON object');
        return parsed;
      } catch (e: any) {
        const isTruncation = /Unterminated string|Unexpected end of JSON input|position \d+/.test(e?.message || '');
        if (isTruncation) {
          const repaired = this.tryRepairTruncatedJson(matched);
          if (repaired) {
            try {
              const parsed = JSON.parse(repaired);
              console.log('WebsiteService.extractCodeFromResponse - Parsed after truncation repair');
              return parsed;
            } catch (e2: any) {
              console.warn('WebsiteService.extractCodeFromResponse - Repair parse failed:', e2?.message);
            }
          }
        }
        console.warn('WebsiteService.extractCodeFromResponse - Component JSON match found but parse failed:', e?.message);
        console.log('WebsiteService.extractCodeFromResponse - Matched string last 200 chars:', matched.substring(Math.max(0, matched.length - 200)));
      }
    }
    
    // Try to find legacy JSON object in the response
    const legacyJsonMatch = response.match(/\{[\s\S]*"html"[\s\S]*"css"[\s\S]*"js"[\s\S]*\}/);
    if (legacyJsonMatch) {
      try {
        const parsed = JSON.parse(legacyJsonMatch[0]);
        console.log('WebsiteService.extractCodeFromResponse - Found legacy JSON object in response');
        return parsed;
      } catch (e: any) {
        console.warn('WebsiteService.extractCodeFromResponse - Legacy JSON match found but parse failed:', e?.message);
      }
    }
    
    // Extract code blocks (legacy fallback)
    const htmlMatch = response.match(/```html\s*\n([\s\S]*?)```/) || 
                     response.match(/```HTML\s*\n([\s\S]*?)```/) ||
                     response.match(/<html>([\s\S]*?)<\/html>/i);
    const cssMatch = response.match(/```css\s*\n([\s\S]*?)```/) || 
                    response.match(/```CSS\s*\n([\s\S]*?)```/) ||
                    response.match(/<style>([\s\S]*?)<\/style>/i);
    const jsMatch = response.match(/```javascript\s*\n([\s\S]*?)```/) || 
                   response.match(/```js\s*\n([\s\S]*?)```/) ||
                   response.match(/```JS\s*\n([\s\S]*?)```/) ||
                   response.match(/<script>([\s\S]*?)<\/script>/i);

    const result = {
      html: htmlMatch ? htmlMatch[1].trim() : '<div>Generated Website</div>',
      css: cssMatch ? cssMatch[1].trim() : 'body { margin: 0; padding: 0; }',
      js: jsMatch ? jsMatch[1].trim() : '// JavaScript code',
    };
    
    console.log('WebsiteService.extractCodeFromResponse - Extracted (legacy mode):', {
      hasHtml: result.html !== '<div>Generated Website</div>',
      hasCss: result.css !== 'body { margin: 0; padding: 0; }',
      hasJs: result.js !== '// JavaScript code'
    });
    
    return result;
  }

  private async saveViteProject(
    userId: string,
    websiteId: string,
    components: Array<{
      name: string;
      type: string;
      path: string;
      code: string;
      language: string;
    }>,
    viteConfig: any,
    websiteName: string,
  ): Promise<string> {
    const baseDir = path.join(process.cwd(), 'generated_sites', userId, websiteId);
    
    // Create directory structure
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const srcDir = path.join(baseDir, 'src');
    const componentsDir = path.join(srcDir, 'components');
    const utilsDir = path.join(srcDir, 'utils');

    // Create subdirectories
    [srcDir, componentsDir, utilsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

            // Save index.html
            const indexHtml = viteConfig?.indexHtml || this.generateDefaultIndexHtml(websiteName);
            // Normalize script src to /src/main.jsx (fix AI typos like main.jsxx or main.js)
            const updatedIndexHtml = indexHtml.replace(
              /src=["']([^"']*\/main)\.(js|jsx|jsxx|tsx)["']/gi,
              'src="/src/main.jsx"',
            );
            fs.writeFileSync(path.join(baseDir, 'index.html'), updatedIndexHtml);

    // Save package.json
    const packageJson = viteConfig?.packageJson || this.generateDefaultPackageJson(websiteName);
    fs.writeFileSync(path.join(baseDir, 'package.json'), packageJson);

    // Save vite.config.js
    const viteConfigJs = viteConfig?.viteConfig || this.generateDefaultViteConfig();
    fs.writeFileSync(path.join(baseDir, 'vite.config.js'), viteConfigJs);

            // Save src/main.jsx
            const mainJsx = viteConfig?.mainJs || viteConfig?.mainJsx || this.generateDefaultMainJs(components);
            fs.writeFileSync(path.join(srcDir, 'main.jsx'), mainJsx);

            // Save src/style.css
            const styleCss = viteConfig?.styleCss || this.generateDefaultStyleCss();
            fs.writeFileSync(path.join(srcDir, 'style.css'), styleCss);


            // Save components
            components.forEach(component => {
              let componentPath = component.path.startsWith('src/')
                ? path.join(baseDir, component.path)
                : path.join(baseDir, 'src', component.path);
              
              // Ensure .jsx extension for React components
              if (!componentPath.endsWith('.jsx') && component.language === 'jsx') {
                componentPath = componentPath.replace(/\.js$/, '.jsx');
              }

              // Ensure directory exists
              const componentDir = path.dirname(componentPath);
              if (!fs.existsSync(componentDir)) {
                fs.mkdirSync(componentDir, { recursive: true });
              }

              fs.writeFileSync(componentPath, component.code);
            });

    // Create .gitignore
    const gitignore = `node_modules
dist
.DS_Store
*.log
.env
.env.local
`;
    fs.writeFileSync(path.join(baseDir, '.gitignore'), gitignore);

    return baseDir;
  }

  private generateDefaultIndexHtml(websiteName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${websiteName} - Generated Website">
    <title>${websiteName}</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
</body>
</html>`;
  }

  private generateDefaultPackageJson(websiteName: string): string {
    return JSON.stringify({
      name: websiteName.toLowerCase().replace(/\s+/g, '-'),
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview'
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0'
      },
      devDependencies: {
        vite: '^5.0.0',
        '@vitejs/plugin-react': '^4.2.0'
      }
    }, null, 2);
  }

  private generateDefaultViteConfig(): string {
    return this.generateViteConfigWithBase('/');
  }

  /**
   * Vite config with a base path (for preview serving at /website/preview/:userId/:websiteId/)
   */
  private generateViteConfigWithBase(basePath: string): string {
    const base = basePath.endsWith('/') ? basePath : basePath + '/';
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '${base.replace(/'/g, "\\'")}',
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});`;
  }

  private generateDefaultMainJs(components: any[]): string {
    const componentImports = components
      .filter(c => c.type === 'component' && (c.language === 'js' || c.language === 'jsx'))
      .map(c => {
        const importPath = c.path.startsWith('src/') 
          ? `/${c.path.replace(/\.(js|jsx)$/, '')}`
          : `/src/${c.path.replace(/\.(js|jsx)$/, '')}`;
        const componentName = c.name.replace(/\s+/g, '');
        return `import ${componentName} from '${importPath}';`;
      })
      .join('\n');

    const componentRenders = components
      .filter(c => c.type === 'component' && (c.language === 'js' || c.language === 'jsx'))
      .map(c => {
        const componentName = c.name.replace(/\s+/g, '');
        return `    <${componentName} />`;
      })
      .join('\n');

    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';

${componentImports}

function App() {
  return (
    <>
${componentRenders}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`;
  }

  private generateDefaultStyleCss(): string {
    return `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --primary-color: #1e3a8a;
  --secondary-color: #64748b;
  --accent-color: #fbbf24;
  --bg-color: #f1f5f9;
  --text-color: #1f2937;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--text-color);
  background: var(--bg-color);
  line-height: 1.6;
}

#app {
  min-height: 100vh;
}`;
  }

  private async saveWebsiteFiles(
    userId: string,
    websiteId: string,
    html: string,
    css: string,
    js: string,
  ): Promise<string> {
    const baseDir = path.join(process.cwd(), 'generated_sites', userId, websiteId);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Save HTML file
    fs.writeFileSync(path.join(baseDir, 'index.html'), html);

    // Save CSS file
    fs.writeFileSync(path.join(baseDir, 'styles.css'), css);

    // Save JS file
    fs.writeFileSync(path.join(baseDir, 'app.js'), js);

    return baseDir;
  }

  async getUserWebsites(userId: string) {
    const websites = await this.websiteRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    
    // Convert ObjectId to string for frontend compatibility
    return websites.map((website) => ({
      ...website,
      id: website.id.toString(),
    }));
  }

  async getWebsiteById(websiteId: string, userId: string) {
    const website = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });

    if (!website || website.userId !== userId) {
      throw new Error('Website not found or access denied');
    }

    // Convert ObjectId to string for frontend compatibility
    return {
      ...website,
      id: website.id.toString(),
    };
  }

  /** Build timeout in ms (install + build) */
  private static readonly PREVIEW_BUILD_TIMEOUT_MS = 180000;

  /**
   * Runs npm install and npm run build in baseDir. Writes vite.config with basePath before building.
   */
  private async buildProjectForPreview(
    baseDir: string,
    basePath: string,
  ): Promise<{ success: true } | { success: false; log: string }> {
    const distPath = path.join(baseDir, 'dist');
    const viteConfigPath = path.join(baseDir, 'vite.config.js');
    const viteConfigWithBase = this.generateViteConfigWithBase(basePath);
    fs.writeFileSync(viteConfigPath, viteConfigWithBase);

    const opts = {
      cwd: baseDir,
      timeout: WebsiteService.PREVIEW_BUILD_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    };

    try {
      await execAsync('npm install', opts);
    } catch (err: any) {
      const log = [err.stdout, err.stderr].filter(Boolean).join('\n') || err.message;
      return { success: false, log: `npm install failed: ${log}` };
    }

    try {
      await execAsync('npm run build', opts);
    } catch (err: any) {
      const log = [err.stdout, err.stderr].filter(Boolean).join('\n') || err.message;
      return { success: false, log: `npm run build failed: ${log}` };
    }

    if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, 'index.html'))) {
      return { success: false, log: 'Build completed but dist/index.html not found.' };
    }

    return { success: true };
  }

  /**
   * Ensures the Vite project is on disk, builds it for preview, returns the URL to serve it.
   * Only for component-based (Vite) websites.
   */
  async getPreviewUrl(websiteId: string, userId: string): Promise<
    { success: true; previewUrl: string } | { success: false; error: string; log?: string }
  > {
    const website = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });

    if (!website || website.userId !== userId) {
      return { success: false, error: 'Website not found or access denied' };
    }

    const components = website.components || [];
    const viteConfig = website.viteConfig;

    if (components.length === 0 || !viteConfig) {
      return { success: false, error: 'Real-build preview is only available for component-based (Vite) websites.' };
    }

    const baseDir = path.join(process.cwd(), 'generated_sites', userId, websiteId);

    if (!fs.existsSync(baseDir)) {
      await this.saveViteProject(
        userId,
        websiteId,
        components,
        viteConfig,
        website.websiteName,
      );
    } else {
      // Ensure files are up to date (e.g. user may have edited and we only have in DB)
      await this.saveViteProject(
        userId,
        websiteId,
        components,
        viteConfig,
        website.websiteName,
      );
    }

    const basePath = `/website/preview/${userId}/${websiteId}`;
    const buildResult = await this.buildProjectForPreview(baseDir, basePath);

    if (buildResult.success === false) {
      return { success: false, error: 'Preview build failed', log: buildResult.log };
    }

    const apiBase = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const previewUrl = `${apiBase.replace(/\/$/, '')}${basePath}/`;
    return { success: true, previewUrl };
  }

  async deleteWebsite(websiteId: string, userId: string) {
    const website = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });

    if (!website || website.userId !== userId) {
      throw new Error('Website not found or access denied');
    }

    // Delete files if they exist
    if (website.generatedPath && fs.existsSync(website.generatedPath)) {
      try {
        fs.rmSync(website.generatedPath, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to delete website files:', error);
      }
    }

    await this.websiteRepository.remove(website);
    return { message: 'Website deleted successfully' };
  }
}

