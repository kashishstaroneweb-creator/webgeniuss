import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Website } from '../entities/website.entity';
import { PromptHistory } from '../entities/prompt-history.entity';
import { User } from '../entities/user.entity';
import { CreditLedger } from '../entities/credit-ledger.entity';
import { GenerationUsage } from '../entities/generation-usage.entity';
import { WebsiteTemplate } from '../entities/website-template.entity';
import { ObjectId } from 'mongodb';
import { createClient, type ChatDetail, type ChatsCreateRequest, type ChatsSendMessageRequest } from 'v0-sdk';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import type { Response } from 'express';
import axios, { type AxiosResponse } from 'axios';
import { CodeSanitizer } from './code-sanitizer';
import { ReactPreviewBuildService } from './react-preview-build.service';

type WebsiteFramework = 'next' | 'react' | 'html';
type V0MessageAttachment = { url: string };

@Injectable()
export class WebsiteService {
  /** Official v0 Platform client — same as `import { v0 } from 'v0-sdk'` but honors `V0_API_URL` and explicit `apiKey` (default `v0` only reads `V0_API_KEY`). */
  private readonly v0Platform: ReturnType<typeof createClient>;

  /**
   * Trim, strip BOM/quotes, remove accidental `Bearer ` prefix, and strip invisible /
   * line-break characters (common when copying from the v0 key UI or PDF).
   */
  private static normalizeV0ApiKey(raw: string | undefined): string | undefined {
    if (raw == null) return undefined;
    let s = raw.replace(/^\uFEFF/, '');
    s = s.replace(/\r/g, '');
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '');
    s = s.trim();
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      s = s.slice(1, -1).trim();
    }
    if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim();
    return s || undefined;
  }

  private normalizeFramework(framework?: string): WebsiteFramework {
    if (framework === 'react') return 'react';
    if (framework === 'html') return 'html';
    return 'next';
  }

  private normalizeV0Attachments(attachments?: V0MessageAttachment[]): V0MessageAttachment[] | undefined {
    if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
    const maxCount = Number(process.env.V0_MAX_IMAGE_ATTACHMENTS) || 4;
    const maxUrlChars = Number(process.env.V0_MAX_ATTACHMENT_URL_CHARS) || 8_000_000;
    const normalized = attachments
      .map((item) => ({ url: typeof item?.url === 'string' ? item.url.trim() : '' }))
      .filter((item) => {
        if (!item.url || item.url.length > maxUrlChars) return false;
        return /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(item.url) || /^https?:\/\//i.test(item.url);
      })
      .slice(0, maxCount);
    return normalized.length > 0 ? normalized : undefined;
  }

  private getCreditCost(kind: 'generate' | 'edit', framework: WebsiteFramework, attachments?: V0MessageAttachment[]): number {
    const imageSurcharge = this.normalizeV0Attachments(attachments)?.length ? Number(process.env.CREDIT_COST_IMAGE_REFERENCE) || 1 : 0;
    if (kind === 'edit') return (Number(process.env.CREDIT_COST_EDIT) || 1) + imageSurcharge;
    if (framework === 'next') return (Number(process.env.CREDIT_COST_GENERATE_NEXT) || 3) + imageSurcharge;
    if (framework === 'react') return (Number(process.env.CREDIT_COST_GENERATE_REACT) || 2) + imageSurcharge;
    return (Number(process.env.CREDIT_COST_GENERATE_HTML) || 1) + imageSurcharge;
  }

  private promptPreview(prompt: string): string {
    const clean = (prompt || '').replace(/\s+/g, ' ').trim();
    return clean.length > 220 ? `${clean.slice(0, 220)}...` : clean;
  }

  private isCreditBypassEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.TEST_BYPASS_CREDITS === 'true';
  }

  private async beginUsage(args: {
    userId: string;
    kind: 'generate' | 'edit';
    framework: WebsiteFramework;
    prompt: string;
    credits: number;
    attachments?: V0MessageAttachment[];
    websiteId?: string;
  }) {
    const user = await this.userRepository.findOne({ where: { _id: new ObjectId(args.userId) } as any });
    if (!user) {
      const err = new Error('User not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    if ((user.accountStatus || 'active') === 'suspended') {
      const err = new Error('Your account is suspended. Contact support.') as Error & { status?: number };
      err.status = 403;
      throw err;
    }
    const balance = Number(user.creditsBalance ?? (Number(process.env.DEFAULT_USER_CREDITS) || 5));
    if (!this.isCreditBypassEnabled() && balance < args.credits) {
      const err = new Error(`Not enough credits. Required ${args.credits}, available ${balance}.`) as Error & { status?: number };
      err.status = 402;
      throw err;
    }
    return this.generationUsageRepository.save(
      this.generationUsageRepository.create({
        userId: args.userId,
        websiteId: args.websiteId,
        kind: args.kind,
        promptPreview: this.promptPreview(args.prompt),
        framework: args.framework,
        imageAttached: !!this.normalizeV0Attachments(args.attachments)?.length,
        status: 'started',
        estimatedCostCredits: args.credits,
      }),
    );
  }

  private async completeUsageSuccess(
    usage: GenerationUsage | undefined,
    userId: string,
    credits: number,
    details: { websiteId?: string; v0ChatId?: string; v0DemoUrl?: string },
  ) {
    if (!usage) return;
    const now = new Date();
    const bypassCredits = this.isCreditBypassEnabled();
    if (!bypassCredits) {
      const user = await this.userRepository.findOne({ where: { _id: new ObjectId(userId) } as any });
      const before = Number(user?.creditsBalance || 0);
      const after = Math.max(0, before - credits);
      if (user) {
        user.creditsBalance = after;
        user.creditsUsed = Number(user.creditsUsed || 0) + credits;
        await this.userRepository.save(user);
        await this.creditLedgerRepository.save(
          this.creditLedgerRepository.create({
            userId,
            type: 'generation',
            amount: -credits,
            balanceBefore: before,
            balanceAfter: after,
            reason: `${usage.kind} ${usage.framework || ''}`.trim(),
            referenceId: details.websiteId || (usage as any)._id?.toString() || usage.id?.toString(),
            createdBy: 'system',
          }),
        );
      }
    }
    usage.status = 'success';
    usage.actualCostCredits = bypassCredits ? 0 : credits;
    usage.websiteId = details.websiteId || usage.websiteId;
    usage.v0ChatId = details.v0ChatId;
    usage.v0DemoUrl = details.v0DemoUrl;
    usage.finishedAt = now;
    usage.durationMs = now.getTime() - new Date(usage.startedAt || now).getTime();
    await this.generationUsageRepository.save(usage);
  }

  private async completeUsageFailed(usage: GenerationUsage | undefined, error: unknown) {
    if (!usage) return;
    const now = new Date();
    usage.status = 'failed';
    usage.errorMessage = ((error as Error)?.message || String(error)).slice(0, 4000);
    usage.finishedAt = now;
    usage.durationMs = now.getTime() - new Date(usage.startedAt || now).getTime();
    await this.generationUsageRepository.save(usage);
  }

  constructor(
    @InjectRepository(Website)
    private websiteRepository: Repository<Website>,
    @InjectRepository(PromptHistory)
    private promptRepository: Repository<PromptHistory>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(CreditLedger)
    private creditLedgerRepository: Repository<CreditLedger>,
    @InjectRepository(GenerationUsage)
    private generationUsageRepository: Repository<GenerationUsage>,
    @InjectRepository(WebsiteTemplate)
    private templateRepository: Repository<WebsiteTemplate>,
    private reactPreviewBuildService: ReactPreviewBuildService,
  ) {
    const v0Key = WebsiteService.normalizeV0ApiKey(process.env.V0_API_KEY);
    const apiKey = v0Key;
    if (apiKey) process.env.V0_API_KEY = apiKey;
    const baseUrl = (process.env.V0_API_URL || 'https://api.v0.dev/v1').replace(/\/+$/, '');
    this.v0Platform = createClient({
      apiKey: apiKey || undefined,
      baseUrl,
    });
    if (process.env.V0_DEBUG_AUTH === '1') {
      console.log('WebsiteService - V0_DEBUG_AUTH: key length=', apiKey?.length ?? 0, 'baseUrl=', baseUrl);
    }
  }

  private objectIdString(entity: any): string {
    return (entity?._id || entity?.id)?.toString();
  }

  private serializeTemplate(template: WebsiteTemplate) {
    return {
      ...template,
      id: this.objectIdString(template),
    };
  }

  async listPublishedTemplates() {
    const templates = await this.templateRepository.find({
      where: { status: 'published' } as any,
      order: { sortOrder: 'ASC', createdAt: 'DESC' } as any,
    });
    return templates.map((template) => this.serializeTemplate(template));
  }

  async getPublishedTemplateById(templateId: string) {
    if (!ObjectId.isValid(templateId)) {
      const err = new Error('Template not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    const template = await this.templateRepository.findOne({ where: { _id: new ObjectId(templateId) } as any });
    if (!template || template.status !== 'published') {
      const err = new Error('Template not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    return this.serializeTemplate(template);
  }

  private async resolveTemplateForGeneration(templateId?: string) {
    if (!templateId) return null;
    if (!ObjectId.isValid(templateId)) {
      const err = new Error('Template not found or not published') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    const template = await this.templateRepository.findOne({ where: { _id: new ObjectId(templateId) } as any });
    if (!template || template.status !== 'published') {
      const err = new Error('Template not found or not published') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    return template;
  }

  private summarizeTemplateForPrompt(template: WebsiteTemplate) {
    const componentList = (template.components || [])
      .slice(0, 16)
      .map((item) => `${item.type}: ${item.path || item.name}`)
      .join('\n');
    const codeSource =
      template.viteConfig?.mainJsx ||
      template.viteConfig?.mainJs ||
      template.htmlCode ||
      '';
    const codeExcerpt = codeSource.slice(0, 18000);

    return [
      `Template name: ${template.name}`,
      `Template category: ${template.category || 'General'}`,
      `Template framework: ${template.framework || 'react'}`,
      template.description ? `Template description: ${template.description}` : '',
      template.tags?.length ? `Template tags: ${template.tags.join(', ')}` : '',
      template.basePrompt ? `Template design brief:\n${template.basePrompt.slice(0, 4000)}` : '',
      componentList ? `Template files/sections:\n${componentList}` : '',
      codeExcerpt ? `Template code excerpt to preserve visual structure from:\n${codeExcerpt}` : '',
    ].filter(Boolean).join('\n\n');
  }

  private buildPromptWithTemplate(prompt: string, websiteName: string, template: WebsiteTemplate | null) {
    if (!template) return prompt;
    return [
      `The user selected a reusable WebGenius template. Use it as the design foundation for "${websiteName}".`,
      this.summarizeTemplateForPrompt(template),
      'Generation rules for template use:',
      '- Preserve the template layout rhythm, section order, component density, spacing quality, and interaction style unless the user asks otherwise.',
      '- Replace all placeholder content with business-specific content from the user request.',
      '- Adapt colors, images, copy, and calls to action to the user request.',
      '- Do not mention that a template was used in the rendered website.',
      `User customization request:\n${prompt}`,
    ].join('\n\n');
  }

  async getV0Health() {
    const key = WebsiteService.normalizeV0ApiKey(process.env.V0_API_KEY);
    const baseUrl = (process.env.V0_API_URL || 'https://api.v0.dev/v1').replace(/\/+$/, '');
    const keyPreview = key ? `${key.slice(0, 4)}...${key.slice(-4)}` : null;

    try {
      const [user, plan] = await Promise.all([
        this.v0Platform.user.get(),
        this.v0Platform.user.getPlan(),
      ]);
      return {
        ok: true,
        statusCode: 200,
        baseUrl,
        keyConfigured: !!key,
        keyPreview,
        user: {
          id: user.id,
          email: user.email,
        },
        plan,
      };
    } catch (error: any) {
      const msg = String(error?.message || error || '');
      const m = msg.match(/HTTP\s+(\d{3})/i);
      const statusCode = m ? Number(m[1]) : 500;
      return {
        ok: false,
        statusCode,
        baseUrl,
        keyConfigured: !!key,
        keyPreview,
        error: msg,
      };
    }
  }

  /** Shared v0 system instruction (framework-aware). */
  private getV0WebsiteSystemPrompt(framework: WebsiteFramework): string {
    if (framework === 'next') {
      return `You are v0, an expert AI for production-ready Next.js websites.

Generate complete, modern Next.js applications using App Router patterns and real project files.

Rules:
- Return only code output artifacts (no markdown explanations).
- Prefer App Router structure (app/layout.tsx, app/page.tsx, components/*).
- Keep UI responsive, polished, and fully functional.
- Use clean component architecture and modern styling.
- Avoid placeholder stubs; return complete, runnable code.`;
    }
    if (framework === 'html') {
      return `You are v0, an expert AI for production-ready static websites.

Generate complete, polished static websites using ONLY HTML, CSS, and vanilla JavaScript. Treat this like a real handoff to a developer who will publish index.html, styles.css, and script.js directly.

CRITICAL: You MUST return ONLY a valid JSON object. No explanations, no markdown, no code blocks, just pure JSON starting with { and ending with }.

Required JSON structure. The top-level object MUST contain exactly these three string fields:
{
  "html": "<!doctype html>\\n<html lang=\\\"en\\\">\\n<head>\\n  <meta charset=\\\"UTF-8\\\" />\\n  <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1.0\\\" />\\n  <title>Website Name</title>\\n  <link rel=\\\"stylesheet\\\" href=\\\"./styles.css\\\" />\\n</head>\\n<body>\\n  <main>...</main>\\n  <script src=\\\"./script.js\\\"></script>\\n</body>\\n</html>",
  "css": "/* complete responsive CSS, at least 150 lines for a full landing page */",
  "js": "// complete vanilla JavaScript for interactions"
}

STATIC FILE CONTRACT:
- "html", "css", and "js" MUST all be present and MUST be non-empty strings.
- The HTML string MUST be a complete document: <!doctype html>, <html>, <head>, <body>.
- The HTML MUST link to ./styles.css exactly once and ./script.js exactly once.
- Put ALL styling in the "css" field, not inline style attributes or <style> tags.
- Put ALL behavior in the "js" field, not inline onclick attributes or <script> tags except the script.js include.
- Do NOT use React, Next.js, JSX, TypeScript, package.json, Vite, npm, Tailwind build steps, or framework imports.
- Do NOT return "components", "viteConfig", "files", markdown, prose, comments outside JSON, or empty placeholders.

HTML REQUIREMENTS:
- Use semantic sections: header/nav, main, sections, forms when relevant, footer.
- Include real content for the requested website, not lorem ipsum unless the user explicitly asks for placeholders.
- Include accessible labels, alt text, aria-expanded/aria-controls where needed, and keyboard-friendly controls.
- Use data-* attributes or class hooks for JavaScript behavior.

CSS REQUIREMENTS:
- Production-ready custom CSS with :root variables, responsive layout, Grid/Flexbox, media queries, focus states, hover states, transitions, and polished spacing.
- Add strong visual design: typography hierarchy, buttons, cards/sections, forms, nav, footer, mobile menu styles when relevant.
- Make it mobile-first and responsive across mobile, tablet, and desktop.

JAVASCRIPT REQUIREMENTS:
- Vanilla browser-safe JavaScript only. Use addEventListener and DOM APIs.
- Implement expected interactions for the page: mobile nav, smooth scrolling, form validation, tabs/modals/carousels/cart/filtering when the prompt implies them.
- Wrap initialization in DOMContentLoaded.
- Guard DOM queries so missing optional elements do not throw.

QUALITY BAR:
- Complete, runnable code. No TODOs, no stubs, no empty arrays/objects, no "add your code here".
- If the user asks for a simple static page, still include enough CSS/JS to make the page polished and functional.
- Return valid JSON with escaped newlines as \\n and escaped quotes inside strings.`;
    }
    return `You are v0, an expert AI specialized in generating PRODUCTION-READY, enterprise-grade React components and websites. Your expertise is in creating stunning, modern web applications with Vite + React that look like they were built by top-tier agencies. Generate a component-based architecture following React and Vite best practices.

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
    },
    {
      "name": "Home",
      "type": "page",
      "path": "src/pages/Home.jsx",
      "code": "import React from 'react';\\nimport Header from '../components/Header.jsx';\\nimport Hero from '../components/Hero.jsx';\\n\\nexport default function Home() {\\n  return (\\n    <>\\n      <Header />\\n      <Hero />\\n    </>\\n  );\\n}",
      "language": "jsx"
    }
  ],
  "viteConfig": {
    "packageJson": "{ \\\"name\\\": \\\"website-name\\\", \\\"version\\\": \\\"1.0.0\\\", \\\"scripts\\\": { \\\"dev\\\": \\\"vite\\\", \\\"build\\\": \\\"vite build\\\" }, \\\"dependencies\\\": { \\\"react\\\": \\\"^18.2.0\\\", \\\"react-dom\\\": \\\"^18.2.0\\\", \\\"react-router-dom\\\": \\\"^6.20.0\\\" }, \\\"devDependencies\\\": { \\\"vite\\\": \\\"^4.0.0\\\", \\\"@vitejs/plugin-react\\\": \\\"^3.0.0\\\" } }",
    "viteConfig": "import { defineConfig } from 'vite';\\nimport react from '@vitejs/plugin-react';\\n\\nexport default defineConfig({\\n  plugins: [react()],\\n});",
    "indexHtml": "<!DOCTYPE html>\\n<html lang=\\\"en\\\">\\n<head>\\n  <meta charset=\\\"UTF-8\\\">\\n  <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1.0\\\">\\n  <title>Website Name</title>\\n</head>\\n<body>\\n  <div id=\\\"root\\\"></div>\\n  <script type=\\\"module\\\" src=\\\"/src/main.jsx\\\"></script>\\n</body>\\n</html>",
    "mainJsx": "import React from 'react';\\nimport ReactDOM from 'react-dom/client';\\nimport { BrowserRouter, Routes, Route } from 'react-router-dom';\\nimport './style.css';\\nimport Home from './pages/Home.jsx';\\n\\nfunction App() {\\n  return (\\n    <BrowserRouter>\\n      <Routes>\\n        <Route path=\\\"/\\\" element={<Home />} />\\n      </Routes>\\n    </BrowserRouter>\\n  );\\n}\\n\\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
    "styleCss": "/* CSS styles */"
  }
}

CRITICAL: The mainJsx MUST include:
1. Import React and ReactDOM
2. Import BrowserRouter, Routes, Route from 'react-router-dom'
3. Import './style.css'
4. Import ALL page components from './pages/PageName.jsx'
5. Define an App function component that returns a BrowserRouter containing Routes and all Pages
6. Call ReactDOM.createRoot(document.getElementById('root')).render(<App />)

COMPONENT ARCHITECTURE REQUIREMENTS:
- You MUST create a MULTI-PAGE APPLICATION (MPA) using react-router-dom.
- Break down the UI into logical, reusable React functional components (Header, Hero, Services, Footer, etc.) in src/components/
- Create separate Page components (Home, About, Contact, etc.) in src/pages/
- Components and Pages MUST use React functional component syntax with JSX
- Use Link from react-router-dom for all navigation between pages
- Use semantic HTML5 elements in JSX
- Components should accept props for customization
- Separate concerns: one component/page per file
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
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './style.css';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        {/* ... all other page routes */}
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
\`\`\`

CRITICAL: The App component MUST be defined as a function that returns the routing setup. DO NOT skip the App component.

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
- Router: ALWAYS use react-router-dom 6+ for navigation
- Components: Each component/page as separate .jsx file with React functional component
- HTML: Semantic HTML5, proper meta tags in index.html
- CSS: Custom Properties (variables), Grid, Flexbox, @media queries, @keyframes, Google Fonts
- JavaScript: ES6+ modules, JSX syntax, React hooks (useState, useEffect), event handling
- Responsive breakpoints: mobile (<768px), tablet (768-1024px), desktop (>1024px)
- Cross-browser compatible
- Dependencies: React, ReactDOM, react-router-dom, Vite, @vitejs/plugin-react

COMPONENT BREAKDOWN GUIDELINES:
- Layouts/Structural → Header, Footer, Navbar in src/components/
- Features → Hero, Services, Contact Form in src/components/
- Pages → Home, About, Dashboard in src/pages/
- Utility functions → utils/ folder
- Each file should be 50-200 lines of code
- Components should be composable and reusable
- Pages should compose multiple components to build the view

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
  }

  /** Sanitize, persist DB + disk — same path as POST /website/generate after v0 content is known. */
  private tryRecoverStructuredProjectFromMain(main: string): { components: any[]; viteConfig: any } | null {
    if (!main || typeof main !== 'string') return null;
    if (!/projectData\s*=\s*\{/.test(main)) return null;

    const components: Array<{
      name: string;
      type: 'component' | 'page' | 'util';
      path: string;
      code: string;
      language: 'html' | 'css' | 'js' | 'jsx';
    }> = [];

    const componentsBlockMatch = main.match(/components\s*:\s*\[([\s\S]*?)\]\s*,\s*viteConfig\s*:/);
    if (componentsBlockMatch?.[1]) {
      const block = componentsBlockMatch[1];
      const itemRegex =
        /name\s*:\s*"([^"]+)"[\s\S]*?type\s*:\s*"([^"]+)"[\s\S]*?path\s*:\s*"([^"]+)"[\s\S]*?language\s*:\s*"([^"]+)"[\s\S]*?code\s*:\s*`([\s\S]*?)`/g;
      let m: RegExpExecArray | null;
      while ((m = itemRegex.exec(block)) !== null) {
        const typeRaw = (m[2] || 'component').toLowerCase();
        const langRaw = (m[4] || 'jsx').toLowerCase();
        components.push({
          name: m[1] || 'Component',
          type: typeRaw === 'page' || typeRaw === 'util' ? (typeRaw as any) : 'component',
          path: m[3] || `src/components/${m[1] || 'Component'}.jsx`,
          code: m[5] || '',
          language: langRaw === 'html' || langRaw === 'css' || langRaw === 'js' || langRaw === 'jsx' ? (langRaw as any) : 'jsx',
        });
      }
    }

    const viteConfig: Record<string, string> = {};
    const viteBlockMatch = main.match(/viteConfig\s*:\s*\{([\s\S]*?)\}\s*[,}]/);
    if (viteBlockMatch?.[1]) {
      const vb = viteBlockMatch[1];
      const fieldRegex = /(packageJson|viteConfig|indexHtml|mainJsx|mainJs|styleCss)\s*:\s*`([\s\S]*?)`/g;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRegex.exec(vb)) !== null) {
        viteConfig[fm[1]] = fm[2] || '';
      }
    }

    if (components.length === 0 && !viteConfig.mainJsx && !viteConfig.mainJs) {
      return null;
    }
    return { components, viteConfig };
  }

  private normalizeWebsiteCodeShape(raw: any): any {
    if (raw == null) return raw;

    if (typeof raw === 'string') {
      const parsed = this.parseV0Response(raw) || this.extractCodeFromResponse(raw);
      return parsed || { html: raw, css: '', js: '' };
    }

    if (typeof raw !== 'object') return raw;

    const candidateStrings = [
      raw.html,
      raw.HTML,
      raw.code,
      raw.content,
      raw.text,
    ].filter((v) => typeof v === 'string') as string[];

    for (const value of candidateStrings) {
      const trimmed = value.trim();
      if (!trimmed.startsWith('{') || !/"(?:html|HTML|css|CSS|js|JS|javascript)"/.test(trimmed)) continue;
      const parsed = this.parseV0Response(trimmed) || this.extractCodeFromResponse(trimmed);
      const hasStaticCode =
        typeof parsed?.html === 'string' ||
        typeof parsed?.HTML === 'string' ||
        typeof parsed?.css === 'string' ||
        typeof parsed?.CSS === 'string' ||
        typeof parsed?.js === 'string' ||
        typeof parsed?.JS === 'string' ||
        typeof parsed?.javascript === 'string';
      if (hasStaticCode) {
        return {
          ...raw,
          ...parsed,
        };
      }
    }

    return raw;
  }

  private async persistWebsiteAfterV0Generation(args: {
    userId: string;
    websiteName: string;
    prompt: string;
    displayPrompt?: string;
    framework: WebsiteFramework;
    responseContent: string;
    websiteCode: any;
    v0ChatId?: string;
    v0DemoUrl?: string;
    templateId?: string;
    templateName?: string;
  }) {
    const { userId, websiteName, prompt, framework, responseContent, v0ChatId, v0DemoUrl } = args;
    const promptForHistory = args.displayPrompt?.trim() || prompt;
    const websiteCode = this.normalizeWebsiteCodeShape(args.websiteCode);

    // Sanitize JSX and fix images: validate image URLs (HEAD), replace 404s with a relevant image (Unsplash by site theme, else Picsum), then replace imgur
    const getPlaceholderUrl = await this.buildPlaceholderUrlGetter(websiteName || '', prompt);
    const sanitizeCode = (raw: string) =>
      this.sanitizeInvalidConditionAssignment(
        this.sanitizeJsxDollarInterpolation(
          this.transformJsxAttributeTemplateLiterals(CodeSanitizer.stripNextJsMetadataBlocks(raw)),
        ),
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

    // Recovery path: some model outputs wrap the whole project as `const projectData = { components, viteConfig }` inside mainJsx.
    // Extract and normalize it back into our expected top-level shape before persistence/build.
    if ((websiteCode?.components?.length ?? 0) === 0 && websiteCode?.viteConfig?.mainJsx) {
      const recovered = this.tryRecoverStructuredProjectFromMain(websiteCode.viteConfig.mainJsx);
      if (recovered) {
        websiteCode.components = recovered.components;
        websiteCode.viteConfig = { ...(websiteCode.viteConfig || {}), ...(recovered.viteConfig || {}) };
        console.log('WebsiteService.persistWebsiteAfterV0Generation - Recovered wrapped projectData shape:', {
          recoveredComponents: recovered.components.length,
          hasRecoveredMain: !!(recovered.viteConfig?.mainJsx || recovered.viteConfig?.mainJs),
        });
      }
    }

    // Extract component-based structure; legacy html/css/js only when the model returns them (no placeholder masking)
    const components = websiteCode.components || [];
    const viteConfig = websiteCode.viteConfig || null;
    const hasViteAppCode = !!(viteConfig?.mainJsx || viteConfig?.mainJs);

    const htmlCode = websiteCode.html || websiteCode.HTML || '';
    const cssCode = websiteCode.css || websiteCode.CSS || '';
    const jsCode = websiteCode.js || websiteCode.JS || websiteCode.javascript || '';

    // Debug: log after normalization to spot placeholder declarations
    const componentNames = components.map((c: any) => (c.name || '').replace(/\s+/g, ''));
    const mainJsxPreview = viteConfig?.mainJsx?.substring(0, 500) || viteConfig?.mainJs?.substring(0, 500) || '';
    console.log('WebsiteService.persistWebsiteAfterV0Generation - After normalization:', {
      componentNames,
      mainJsxPreview: mainJsxPreview || '(none)',
    });
    const badPlaceholder = componentNames.find((name: string) => name && mainJsxPreview.includes(`const ${name} = []`));
    if (badPlaceholder) {
      console.warn(
        'WebsiteService.persistWebsiteAfterV0Generation - mainJsx still contains placeholder for component:',
        badPlaceholder,
      );
    }

    console.log('WebsiteService.persistWebsiteAfterV0Generation - Extracted structure:', {
      hasComponents: components.length > 0,
      componentCount: components.length,
      hasViteConfig: !!viteConfig,
      legacyMode: components.length === 0,
    });

    const hasLegacySnippet =
      (typeof htmlCode === 'string' && htmlCode.trim().length > 0) ||
      (typeof jsCode === 'string' && jsCode.trim().length > 0) ||
      (typeof cssCode === 'string' && cssCode.trim().length > 0);
    if (components.length === 0 && !hasViteAppCode && !hasLegacySnippet) {
      console.error(
        'WebsiteService.persistWebsiteAfterV0Generation - No valid code from v0 API (no components, vite entry, or legacy html/css/js).',
      );
      const err = new Error(
        'The AI did not return valid website code. You may have hit a content limit or the request may have been refused. Try rephrasing your prompt or simplifying the request.',
      ) as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    const storeAsVite = framework !== 'html' && (components.length > 0 || hasViteAppCode);
    const website = this.websiteRepository.create({
      userId,
      websiteName,
      framework,
      prompt: promptForHistory,
      templateId: args.templateId,
      templateName: args.templateName,
      htmlCode: storeAsVite ? '' : htmlCode,
      cssCode: storeAsVite ? '' : cssCode,
      jsCode: storeAsVite ? '' : jsCode,
      components: storeAsVite && components.length > 0 ? components : undefined,
      viteConfig: storeAsVite ? viteConfig || undefined : undefined,
      v0ChatId,
      v0DemoUrl: v0DemoUrl || undefined,
      reactBuildStatus: framework === 'react' || framework === 'html' ? 'queued' : undefined,
    });

    let savedWebsite = await this.websiteRepository.save(website);

    await this.promptRepository.save(
      this.promptRepository.create({
        userId,
        prompt: promptForHistory,
        aiResponse: responseContent,
      }),
    );

    // Preview: v0 hosted URL when present, else client-side WebsitePreview from DB payload — no server disk.

    if (framework === 'react') {
      console.log('WebsiteService.persistWebsiteAfterV0Generation - queueing React build:', {
        websiteId: savedWebsite.id.toString(),
        framework,
      });
      void this.reactPreviewBuildService.enqueue(savedWebsite.id.toString());
    } else if (framework === 'html') {
      console.log('WebsiteService.persistWebsiteAfterV0Generation - publishing static HTML preview:', {
        websiteId: savedWebsite.id.toString(),
        framework,
      });
      const published = await this.reactPreviewBuildService.publishStaticPreview(savedWebsite.id.toString());
      if (published) savedWebsite = published;
    }
    console.log('WebsiteService.persistWebsiteAfterV0Generation - Success, saved website ID:', savedWebsite.id);
    return {
      ...savedWebsite,
      id: savedWebsite.id.toString(),
      components: storeAsVite && components.length > 0 ? components : undefined,
      viteConfig: storeAsVite ? viteConfig || undefined : undefined,
      message: 'Website generated successfully',
    };
  }

  async generateWebsite(
    userId: string,
    prompt: string,
    websiteName: string,
    framework?: string,
    attachments?: V0MessageAttachment[],
    displayPrompt?: string,
    templateId?: string,
    skipUsageValidation = false,
  ) {
    const resolvedFramework = this.normalizeFramework(framework);
    const creditCost = this.getCreditCost('generate', resolvedFramework, attachments);
    let usage: GenerationUsage | undefined;
    console.log('WebsiteService.generateWebsite - Starting:', { userId, websiteName, promptLength: prompt.length });
    try {
      const template = await this.resolveTemplateForGeneration(templateId);
      const promptForModel = this.buildPromptWithTemplate(prompt, websiteName, template);
      if (!skipUsageValidation) {
        usage = await this.beginUsage({
          userId,
          kind: 'generate',
          framework: resolvedFramework,
          prompt: displayPrompt?.trim() || prompt,
          credits: creditCost,
          attachments,
        });
      }
      console.log('WebsiteService.generateWebsite - Calling v0 Platform API...');
      console.log(
        'WebsiteService.generateWebsite - v0 API Key:',
        WebsiteService.normalizeV0ApiKey(process.env.V0_API_KEY) ? 'SET' : 'NOT SET',
      );
      console.log(
        'WebsiteService.generateWebsite - v0 model config:',
        JSON.stringify(this.getV0ModelConfiguration() ?? '(platform default)'),
      );
      console.log(
        'WebsiteService.generateWebsite - v0 chats.create: async+poll (or sync on retry). Use POST /website/generate-stream for experimental_stream + SSE.',
      );

      const systemPrompt = this.getV0WebsiteSystemPrompt(resolvedFramework);

      const userPrompt = this.buildV0GenerationUserMessage(promptForModel, websiteName, resolvedFramework);
      console.log('WebsiteService.generateWebsite - outbound v0 payload preview:', {
        framework: resolvedFramework,
        systemLength: systemPrompt.length,
        messageLength: userPrompt.length,
        messagePreview: userPrompt.substring(0, 1200),
      });

      console.log('WebsiteService.generateWebsite - Original prompt length:', prompt.length);
      console.log('WebsiteService.generateWebsite - Final message length:', userPrompt.length);

      let { responseContent, websiteCode, v0ChatId, v0DemoUrl } = await this.fetchWebsiteCodeFromV0(
        systemPrompt,
        userPrompt,
        attachments,
      );
      console.log('WebsiteService.generateWebsite - demoUrl from fetchWebsiteCodeFromV0:', {
        chatId: v0ChatId || null,
        demoUrl: v0DemoUrl || null,
      });
      if (v0ChatId && !v0DemoUrl) {
        v0DemoUrl = await this.fetchV0DemoUrlByChatId(v0ChatId);
        console.log('WebsiteService.generateWebsite - demoUrl after fetchV0DemoUrlByChatId:', {
          chatId: v0ChatId,
          demoUrl: v0DemoUrl || null,
        });
      }

      const saved = await this.persistWebsiteAfterV0Generation({
        userId,
        websiteName,
        prompt: promptForModel,
        displayPrompt: displayPrompt?.trim() || prompt,
        framework: resolvedFramework,
        responseContent,
        websiteCode,
        v0ChatId,
        v0DemoUrl,
        templateId: template ? template.id.toString() : undefined,
        templateName: template?.name,
      });
      await this.completeUsageSuccess(usage, userId, creditCost, {
        websiteId: saved.id,
        v0ChatId,
        v0DemoUrl,
      });
      return saved;
    } catch (error) {
      await this.completeUsageFailed(usage, error);
      console.error('WebsiteService.generateWebsite - Error:', {
        message: error.message,
        stack: error.stack,
        userId,
        websiteName
      });
      
      // Provide more helpful error messages for v0 API
      if (error.message.includes('401') || error.message.includes('Incorrect API key')) {
        const err = new Error(
          `Failed to generate website: v0 Platform API returned 401 (Unauthorized). Use an active V0_API_KEY from https://v0.app/chat/settings/keys (Platform API access; paid plan may be required). Paste the full secret once, no quotes or "Bearer ". If the key was shared publicly, revoke it and create a new one.`,
        ) as Error & { status?: number };
        err.status = 401;
        throw err;
      }
      if (error.message.includes('404')) {
        const isChatNotFound = /chat_not_found/i.test(error.message);
        const err = new Error(
          isChatNotFound
            ? `Failed to generate website: v0 returned chat_not_found while polling async generation. This is usually transient; retry once, or set V0_RESPONSE_MODE=sync if it keeps happening.`
            : `Failed to generate website: v0 API returned 404. Confirm V0_API_URL (default https://api.v0.dev/v1) and that your account has Platform API access — see https://v0.app/docs/api/platform/quickstart`,
        ) as Error & { status?: number };
        err.status = isChatNotFound ? 502 : 404;
        throw err;
      }
      
      // Handle Premium/Team plan requirement
      if (error.message.includes('403') || error.message.includes('Premium or Team plan')) {
        const err = new Error(
          `Failed to generate website: v0 API requires a Premium or Team plan. Your API key is valid, but your account needs to be upgraded. Please visit https://v0.app/chat/settings/billing to upgrade your plan.`,
        ) as Error & { status?: number };
        err.status = 403;
        throw err;
      }
      if (error.message.includes('UND_ERR_HEADERS_TIMEOUT') || error.message.includes('Headers Timeout Error')) {
        const err = new Error(
          `Failed to generate website: v0 HTTP client timed out waiting for response headers. Default is now V0_RESPONSE_MODE=async with polling; if you set V0_RESPONSE_MODE=sync, increase V0_CREATE_TIMEOUT_MS or set V0_CREATE_USE_AXIOS_FIRST=1.`,
        ) as Error & { status?: number };
        err.status = 504;
        throw err;
      }
      if (
        error.message.includes('ENOTFOUND') ||
        error.message.includes('UND_ERR_CONNECT_TIMEOUT') ||
        error.message.includes('ETIMEDOUT')
      ) {
        const err = new Error(
          `Failed to generate website: network/DNS issue while connecting to api.v0.dev. Your machine can reach the v0 IP, but DNS resolution appears unstable. Switch system DNS to a public resolver (1.1.1.1 or 8.8.8.8), restart your network adapter, then restart backend and retry.`,
        ) as Error & { status?: number };
        err.status = 503;
        throw err;
      }
      
      throw new Error(`Failed to generate website: ${error.message}`);
    }
  }

  /**
   * v0 experimental_stream uses SSE `data: <json>` lines (see v0-sdk `parseStreamingResponse`).
   * Chat id appears inside JSON objects with `object: "chat"` (not necessarily at a fixed path).
   */
  private findChatIdInV0StreamJson(val: unknown, depth = 0): string | null {
    if (depth > 12 || val == null) return null;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      const idStr = typeof o.id === 'string' ? o.id : null;
      if (idStr && (o.object === 'chat' || o.type === 'chat')) {
        return idStr;
      }
      for (const k of Object.keys(o)) {
        const found = this.findChatIdInV0StreamJson(o[k], depth + 1);
        if (found) return found;
      }
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = this.findChatIdInV0StreamJson(item, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  /** Parse one SSE `data:` payload (or raw JSON line) and return chat id if present. */
  private tryChatIdFromV0StreamDataPayload(raw: string): string | null {
    const s = raw.trim();
    if (!s || s === '[DONE]') return null;
    try {
      return this.findChatIdInV0StreamJson(JSON.parse(s));
    } catch {
      return null;
    }
  }

  /** Regex fallback when JSON is truncated or shape differs (bounded scan). */
  private tryExtractV0ChatIdFromStreamBuffer(buffer: string): string | null {
    const patterns: RegExp[] = [
      /"object"\s*:\s*"chat"[\s\S]{0,400}?"id"\s*:\s*"([^"]+)"/,
      /"id"\s*:\s*"([^"]+)"[\s\S]{0,200}?"object"\s*:\s*"chat"/,
      /"chat"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/,
      /"chatId"\s*:\s*"([^"]+)"/,
      /\bid"\s*:\s*"(chat_[a-zA-Z0-9_-]+)"/,
      /\bid"\s*:\s*"(cm[a-zA-Z0-9_-]{10,})"/,
    ];
    for (const re of patterns) {
      const m = buffer.match(re);
      if (m?.[1]) return m[1];
    }
    return null;
  }

  /**
   * Load finalized v0 chat by id, then run the same sanitize → persist path as POST /website/generate.
   */
  async finalizeWebsiteFromV0Chat(
    userId: string,
    chatId: string,
    websiteName: string,
    prompt: string,
    framework?: string,
    templateId?: string,
    templateName?: string,
  ) {
    const resolvedFramework = this.normalizeFramework(framework);
    let chat = await this.getV0ChatByIdRest(chatId);
    const r = chat as ChatDetail & { chat?: { id?: string } };
    if (!chat.id && r.chat?.id) {
      chat = { ...chat, id: r.chat.id } as ChatDetail;
    }
    chat = await this.waitForV0ChatReady(chat, true);
    const resolvedChatId = (chat.id || chatId || '').trim();
    if (!resolvedChatId) {
      const err = new Error(
        'v0 returned a chat without an id after generation; edits cannot continue the thread. Try generating again.',
      ) as Error & { status?: number };
      err.status = 502;
      throw err;
    }
    if (!chat.id) {
      chat = { ...chat, id: resolvedChatId } as ChatDetail;
    }
    const refusalText = (chat.text || this.getLastAssistantContent(chat) || '').trim();
    if (this.isRefusalResponse(refusalText)) {
      const err = new Error(
        'The AI declined to generate this website. Try rephrasing your prompt.',
      ) as Error & { status?: number };
      err.status = 422;
      throw err;
    }
    let websiteCode = this.websiteCodeFromChatDetail(chat);
    if (websiteCode?.files && Array.isArray(websiteCode.files)) {
      websiteCode = this.convertV0FilesToStructure(websiteCode);
    }
    const responseContent = this.serializeChatForHistory(chat);
    let v0DemoUrl = this.extractV0DemoFromChatDetail(chat);
    console.log('WebsiteService.finalizeWebsiteFromV0Chat - extracted demoUrl:', {
      chatId: resolvedChatId,
      demoUrl: v0DemoUrl || null,
    });
    if (!v0DemoUrl) {
      v0DemoUrl = await this.fetchV0DemoUrlByChatId(resolvedChatId);
      console.log('WebsiteService.finalizeWebsiteFromV0Chat - extracted demoUrl after refetch:', {
        chatId: resolvedChatId,
        demoUrl: v0DemoUrl || null,
      });
    }
    return this.persistWebsiteAfterV0Generation({
      userId,
      websiteName,
      prompt,
      framework: resolvedFramework,
      responseContent,
      websiteCode,
      v0ChatId: resolvedChatId,
      v0DemoUrl,
      templateId,
      templateName,
    });
  }

  /**
   * v0 `experimental_stream`: proxy raw stream to the client, then GET /chats/:id and persist (same pipeline as generate).
   */
  async pipeV0GenerationStream(
    res: Response,
    userId: string,
    prompt: string,
    websiteName: string,
    framework?: string,
    attachments?: V0MessageAttachment[],
    displayPrompt?: string,
    templateId?: string,
  ): Promise<void> {
    const resolvedFramework = this.normalizeFramework(framework);
    const creditCost = this.getCreditCost('generate', resolvedFramework, attachments);
    let usage: GenerationUsage | undefined;
    let template: WebsiteTemplate | null = null;
    try {
      template = await this.resolveTemplateForGeneration(templateId);
      usage = await this.beginUsage({
        userId,
        kind: 'generate',
        framework: resolvedFramework,
        prompt: displayPrompt?.trim() || prompt,
        credits: creditCost,
        attachments,
      });
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(e?.status || 500).json({ message: e?.message || 'Credit check failed' });
      }
      return;
    }
    const systemPrompt = this.getV0WebsiteSystemPrompt(resolvedFramework);
    const promptForModel = this.buildPromptWithTemplate(prompt, websiteName, template);
    const userMessage = this.buildV0GenerationUserMessage(promptForModel, websiteName, resolvedFramework);
    console.log('WebsiteService.pipeV0GenerationStream - outbound v0 payload preview:', {
      framework: resolvedFramework,
      systemLength: systemPrompt.length,
      messageLength: userMessage.length,
      messagePreview: userMessage.substring(0, 1200),
    });
    const modelConfiguration = this.getV0ModelConfiguration();
    const body: Record<string, unknown> = {
      message: userMessage,
      system: systemPrompt,
      responseMode: 'experimental_stream',
    };
    const normalizedAttachments = this.normalizeV0Attachments(attachments);
    if (normalizedAttachments) body.attachments = normalizedAttachments;
    if (modelConfiguration) body.modelConfiguration = modelConfiguration;

    const timeout = Number(process.env.V0_STREAM_TIMEOUT_MS) || 600_000;
    let axiosRes: AxiosResponse<NodeJS.ReadableStream>;
    try {
      axiosRes = await axios.post<NodeJS.ReadableStream>(`${this.getV0BaseUrl()}/chats`, body, {
        responseType: 'stream',
        timeout,
        headers: {
          Authorization: `Bearer ${this.getV0ApiKeyOrThrow()}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        validateStatus: () => true,
      });
    } catch (e: unknown) {
      await this.completeUsageFailed(usage, e);
      if (!res.headersSent) {
        res.status(502).json({ message: this.formatV0NetworkError(e) });
      }
      return;
    }

    if (axiosRes.status >= 400) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const s = axiosRes.data as NodeJS.ReadableStream;
        s.on('data', (c: Buffer) => chunks.push(c));
        s.on('end', () => resolve());
        s.on('error', reject);
      });
      const text = Buffer.concat(chunks).toString('utf8').slice(0, 8000);
      if (!res.headersSent) {
        await this.completeUsageFailed(usage, new Error(this.formatV0HttpError(axiosRes.status, text)));
        res.status(axiosRes.status).json({
          message: this.formatV0HttpError(axiosRes.status, text),
          providerError: text || null,
        });
      }
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

    let sniffBuffer = '';
    const maxSniffFallback = 2_097_152;
    let sseLineCarry = '';
    const h = axiosRes.headers;
    const chatIdFromHeader = (h['x-chat-id'] || h['x-v0-chat-id']) as string | undefined;
    let chatIdCaptured = (chatIdFromHeader && String(chatIdFromHeader).trim()) || null;

    const forward = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        const text = chunk.toString('utf8');
        if (!chatIdCaptured && sniffBuffer.length < maxSniffFallback) {
          const take = maxSniffFallback - sniffBuffer.length;
          sniffBuffer += take >= text.length ? text : text.slice(0, take);
        }

        if (!chatIdCaptured) {
          sseLineCarry += text;
          const lines = sseLineCarry.split('\n');
          sseLineCarry = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const raw = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
              chatIdCaptured = this.tryChatIdFromV0StreamDataPayload(raw);
              if (chatIdCaptured) break;
            } else {
              const t = line.trim();
              if (t.startsWith('{')) {
                chatIdCaptured = this.tryChatIdFromV0StreamDataPayload(t);
                if (chatIdCaptured) break;
              }
            }
          }
        }
        cb(null, chunk);
      },
    });

    const upstream = axiosRes.data as NodeJS.ReadableStream;
    upstream.pipe(forward);
    forward.pipe(res, { end: false });

    const writeSseAndEnd = (event: string, payload: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* ignore */
      }
    };

    const finishWithSse = async () => {
      if (res.writableEnded) return;
      try {
        if (!chatIdCaptured && sseLineCarry.trim()) {
          for (const line of sseLineCarry.split('\n')) {
            if (line.startsWith('data:')) {
              const raw = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
              chatIdCaptured = this.tryChatIdFromV0StreamDataPayload(raw);
              if (chatIdCaptured) break;
            }
          }
        }
        if (!chatIdCaptured && sniffBuffer.length > 0) {
          chatIdCaptured = this.tryExtractV0ChatIdFromStreamBuffer(sniffBuffer);
        }
        if (!chatIdCaptured) {
          writeSseAndEnd('finalize-required', {
            message:
              'Could not detect v0 chat id from stream; call POST /website/finalize-v0-chat with chatId once generation completes.',
          });
          res.end();
          return;
        }
        const saved = await this.finalizeWebsiteFromV0Chat(
          userId,
          chatIdCaptured,
          websiteName,
          displayPrompt?.trim() || prompt,
          resolvedFramework,
          template ? template.id.toString() : undefined,
          template?.name,
        );
        await this.completeUsageSuccess(usage, userId, creditCost, {
          websiteId: saved.id,
          v0ChatId: saved.v0ChatId || chatIdCaptured,
          v0DemoUrl: saved.v0DemoUrl,
        });
        writeSseAndEnd('website-saved', saved);
        res.end();
      } catch (e: unknown) {
        await this.completeUsageFailed(usage, e);
        const msg = (e as Error)?.message || String(e);
        writeSseAndEnd('website-error', { message: msg });
        res.end();
      }
    };

    forward.on('end', () => {
      void finishWithSse();
    });
    forward.on('error', (err: Error) => {
      console.error('WebsiteService.pipeV0GenerationStream - forward error:', err);
      writeSseAndEnd('website-error', { message: err.message });
      if (!res.writableEnded) res.end();
    });
    upstream.on('error', (err: Error) => {
      console.error('WebsiteService.pipeV0GenerationStream - upstream error:', err);
      forward.destroy(err);
    });
  }

  /**
   * v0 experimental_stream on an existing chat: POST /chats/:id/messages, proxy SSE, then GET chat and persist edit (same as v0-clone).
   */
  async pipeV0EditStream(
    res: Response,
    userId: string,
    websiteId: string,
    editPrompt: string,
    framework?: string,
    attachments?: V0MessageAttachment[],
    displayEditPrompt?: string,
  ): Promise<void> {
    const website = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    if (!website) {
      if (!res.headersSent) res.status(404).json({ message: 'Website not found or access denied' });
      return;
    }
    const isOwner = website.userId === userId;
    const isDefaultTestUserSite = website.userId === WebsiteService.DEFAULT_TEST_USER_ID;
    if (!isOwner && !isDefaultTestUserSite) {
      if (!res.headersSent) res.status(404).json({ message: 'Website not found or access denied' });
      return;
    }
    if (isDefaultTestUserSite && userId !== WebsiteService.DEFAULT_TEST_USER_ID) {
      website.userId = userId;
      await this.websiteRepository.save(website);
    }

    const chatId = website.v0ChatId?.trim();
    if (!chatId) {
      if (!res.headersSent) {
        res.status(422).json({
          message:
            'This website has no v0 chat id (e.g. created before streaming). Use POST /website/:id/edit or regenerate once.',
        });
      }
      return;
    }

    const resolvedFramework = this.normalizeFramework(framework);
    const creditCost = this.getCreditCost('edit', resolvedFramework, attachments);
    let usage: GenerationUsage | undefined;
    try {
      usage = await this.beginUsage({
        userId,
        kind: 'edit',
        framework: resolvedFramework,
        prompt: displayEditPrompt?.trim() || editPrompt,
        credits: creditCost,
        attachments,
        websiteId,
      });
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(e?.status || 500).json({ message: e?.message || 'Credit check failed' });
      }
      return;
    }

    let streamEditBaseline:
      | {
          contentSig: string;
          versionId?: string;
          chatUpdatedAt?: string;
          latestVersionUpdatedAt?: string;
          assistantTail?: { id?: string; updatedAt?: string };
        }
      | undefined;
    try {
      const preStream = await this.getV0ChatByIdRest(chatId);
      const asst0 = this.getLastAssistantTail(preStream);
      streamEditBaseline = {
        contentSig: this.v0FilesContentSignature(preStream),
        versionId: preStream.latestVersion?.id,
        chatUpdatedAt: preStream.updatedAt,
        latestVersionUpdatedAt: preStream.latestVersion?.updatedAt,
        assistantTail: asst0.id ? asst0 : undefined,
      };
    } catch (e: unknown) {
      console.warn(
        'WebsiteService.pipeV0EditStream - pre-stream baseline GET failed:',
        this.formatV0NetworkError(e),
      );
      streamEditBaseline = undefined;
    }

    const modelConfiguration = this.getV0ModelConfiguration();
    const body: Record<string, unknown> = {
      message: this.buildFrameworkScopedEditMessage((editPrompt || '').trim(), resolvedFramework),
      responseMode: 'experimental_stream',
    };
    const normalizedAttachments = this.normalizeV0Attachments(attachments);
    if (normalizedAttachments) body.attachments = normalizedAttachments;
    if (modelConfiguration) body.modelConfiguration = modelConfiguration;

    const timeout = Number(process.env.V0_STREAM_TIMEOUT_MS) || 600_000;
    let axiosRes: AxiosResponse<NodeJS.ReadableStream>;
    try {
      axiosRes = await axios.post<NodeJS.ReadableStream>(
        `${this.getV0BaseUrl()}/chats/${encodeURIComponent(chatId)}/messages`,
        body,
        {
          responseType: 'stream',
          timeout,
          headers: {
            Authorization: `Bearer ${this.getV0ApiKeyOrThrow()}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          validateStatus: () => true,
        },
      );
    } catch (e: unknown) {
      await this.completeUsageFailed(usage, e);
      if (!res.headersSent) {
        res.status(502).json({ message: this.formatV0NetworkError(e) });
      }
      return;
    }

    if (axiosRes.status >= 400) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        const s = axiosRes.data as NodeJS.ReadableStream;
        s.on('data', (c: Buffer) => chunks.push(c));
        s.on('end', () => resolve());
        s.on('error', reject);
      });
      const text = Buffer.concat(chunks).toString('utf8').slice(0, 8000);
      if (!res.headersSent) {
        await this.completeUsageFailed(usage, new Error(this.formatV0HttpError(axiosRes.status, text)));
        res.status(axiosRes.status).json({
          message: this.formatV0HttpError(axiosRes.status, text),
          providerError: text || null,
        });
      }
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

    /** Known thread id from DB; sendMessage does not create a new chat. */
    const effectiveChatId = chatId;

    const upstream = axiosRes.data as NodeJS.ReadableStream;
    upstream.pipe(res, { end: false });

    const writeSseAndEnd = (event: string, payload: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        /* ignore */
      }
    };

    const finishWithSse = async () => {
      if (res.writableEnded) return;
      try {
        const fresh = await this.websiteRepository.findOne({
          where: { _id: new ObjectId(websiteId) } as any,
        });
        if (!fresh) {
          writeSseAndEnd('website-error', { message: 'Website not found after stream' });
          res.end();
          return;
        }
        const own = fresh.userId === userId || fresh.userId === WebsiteService.DEFAULT_TEST_USER_ID;
        if (!own) {
          writeSseAndEnd('website-error', { message: 'Access denied' });
          res.end();
          return;
        }

        let chat = await this.getV0ChatByIdRest(effectiveChatId);
        const r = chat as ChatDetail & { chat?: { id?: string } };
        if (!chat.id && r.chat?.id) {
          chat = { ...chat, id: r.chat.id } as ChatDetail;
        }
        let priorSig = streamEditBaseline?.contentSig;
        let priorVid = streamEditBaseline?.versionId;
        let priorChatUpd = streamEditBaseline?.chatUpdatedAt;
        let priorLatestVerUpd = streamEditBaseline?.latestVersionUpdatedAt;
        let priorAsstTail = streamEditBaseline?.assistantTail;
        if (priorSig === undefined) {
          priorSig = this.v0FilesContentSignature(chat);
          priorVid = chat.latestVersion?.id;
          priorChatUpd = chat.updatedAt;
          priorLatestVerUpd = chat.latestVersion?.updatedAt;
          const t0 = this.getLastAssistantTail(chat);
          priorAsstTail = t0.id ? t0 : undefined;
        }
        chat = await this.waitForV0ChatReady(chat, true, {
          followUpMessage: true,
          priorFilesContentSig: priorSig,
          priorVersionId: priorVid,
          priorChatUpdatedAt: priorChatUpd,
          priorLatestVersionUpdatedAt: priorLatestVerUpd,
          priorAssistantTail: priorAsstTail?.id != null ? priorAsstTail : undefined,
        });
        const refusalText = (chat.text || this.getLastAssistantContent(chat) || '').trim();
        if (this.isRefusalResponse(refusalText)) {
          writeSseAndEnd('website-error', {
            message: 'The AI declined to apply this edit. Try rephrasing your request.',
          });
          res.end();
          return;
        }
        let websiteCode = this.websiteCodeFromChatDetail(chat);
        if (websiteCode?.files && Array.isArray(websiteCode.files)) {
          websiteCode = this.convertV0FilesToStructure(websiteCode);
        }
        let v0DemoUrl = this.extractV0DemoFromChatDetail(chat);
        console.log('WebsiteService.pipeV0EditStream - extracted demoUrl:', {
          chatId: chat.id || effectiveChatId,
          demoUrl: v0DemoUrl || null,
        });
        if (chat.id && !v0DemoUrl) {
          v0DemoUrl = await this.fetchV0DemoUrlByChatId(chat.id);
          console.log('WebsiteService.pipeV0EditStream - extracted demoUrl after refetch:', {
            chatId: chat.id,
            demoUrl: v0DemoUrl || null,
          });
        }
        const resolvedChatId = chat.id || effectiveChatId;

        fresh.framework = resolvedFramework;
        const saved = await this.saveWebsiteEditFromFetchedCode(
          fresh,
          websiteId,
          websiteCode,
          displayEditPrompt?.trim() || editPrompt.trim(),
          resolvedChatId,
          v0DemoUrl,
        );
        await this.completeUsageSuccess(usage, userId, creditCost, {
          websiteId: saved.id || websiteId,
          v0ChatId: resolvedChatId,
          v0DemoUrl,
        });
        writeSseAndEnd('website-saved', { ...saved, editV0Path: 'sendMessage' as const });
        res.end();
      } catch (e: unknown) {
        await this.completeUsageFailed(usage, e);
        const msg = (e as Error)?.message || String(e);
        writeSseAndEnd('website-error', { message: msg });
        res.end();
      }
    };

    upstream.on('end', () => {
      void finishWithSse();
    });
    upstream.on('error', (err: Error) => {
      console.error('WebsiteService.pipeV0EditStream - upstream error:', err);
      writeSseAndEnd('website-error', { message: err.message });
      if (!res.writableEnded) res.end();
    });
  }

  private static readonly DEFAULT_TEST_USER_ID = '691df5ddac69fc46beca44b3';

  /**
   * Sanitize v0 edit output and persist on the given website row (used by sync edit and edit-stream finalize).
   */
  private async saveWebsiteEditFromFetchedCode(
    website: Website,
    websiteId: string,
    websiteCodeRaw: any,
    editPrompt: string,
    newV0ChatId: string,
    newV0DemoUrl?: string,
  ) {
    let v0DemoUrl = newV0DemoUrl;
    console.log('WebsiteService.saveWebsiteEditFromFetchedCode - incoming demoUrl:', {
      chatId: newV0ChatId || null,
      demoUrl: v0DemoUrl || null,
    });
    if (newV0ChatId && !v0DemoUrl) {
      v0DemoUrl = await this.fetchV0DemoUrlByChatId(newV0ChatId);
      console.log('WebsiteService.saveWebsiteEditFromFetchedCode - demo after chat refetch:', {
        chatId: newV0ChatId,
        demoUrl: v0DemoUrl || null,
      });
    }
    let websiteCode = this.normalizeWebsiteCodeShape(websiteCodeRaw);

    const getPlaceholderUrl = await this.buildPlaceholderUrlGetter(website.websiteName || '', website.prompt || editPrompt);
    const sanitizeCode = (raw: string) =>
      this.sanitizeInvalidConditionAssignment(
        this.sanitizeJsxDollarInterpolation(
          this.transformJsxAttributeTemplateLiterals(CodeSanitizer.stripNextJsMetadataBlocks(raw)),
        ),
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

    // Same recovery path as initial generation: v0 can wrap the full project in `projectData`
    // inside mainJsx during follow-up edits.
    if ((websiteCode?.components?.length ?? 0) === 0 && websiteCode?.viteConfig?.mainJsx) {
      const recovered = this.tryRecoverStructuredProjectFromMain(websiteCode.viteConfig.mainJsx);
      if (recovered) {
        websiteCode.components = recovered.components;
        websiteCode.viteConfig = { ...(websiteCode.viteConfig || {}), ...(recovered.viteConfig || {}) };
        console.log('WebsiteService.saveWebsiteEditFromFetchedCode - Recovered wrapped projectData shape:', {
          recoveredComponents: recovered.components.length,
          hasRecoveredMain: !!(recovered.viteConfig?.mainJsx || recovered.viteConfig?.mainJs),
        });
      }
    }

    let usedHostedOnlyFallback = false;
    const returnedSourceCode =
      (websiteCode?.components?.length ?? 0) > 0 ||
      !!(websiteCode?.viteConfig?.mainJsx || websiteCode?.viteConfig?.mainJs) ||
      !!(websiteCode?.html || websiteCode?.HTML || websiteCode?.js || websiteCode?.css);
    if (!returnedSourceCode && v0DemoUrl) {
      // Some v0 follow-up turns update latestVersion/demoUrl without including files in the
      // terminal chat payload. Preserve the last downloadable source rather than rejecting
      // an otherwise successful hosted edit.
      usedHostedOnlyFallback = true;
      websiteCode = {
        ...websiteCode,
        components: website.components || [],
        viteConfig: website.viteConfig || null,
        html: website.htmlCode || '',
        css: website.cssCode || '',
        js: website.jsCode || '',
      };
      console.warn(
        'WebsiteService.saveWebsiteEditFromFetchedCode - v0 returned an updated hosted demo without files; preserving saved source',
        { websiteId, v0DemoUrl },
      );
    }

    const components = websiteCode.components || [];
    const viteConfig = websiteCode.viteConfig || null;
    const hasViteAppCode = !!(viteConfig?.mainJsx || viteConfig?.mainJs);
    const htmlCode = websiteCode.html || websiteCode.HTML || website.htmlCode || '';
    const cssCode = websiteCode.css || websiteCode.CSS || website.cssCode || '';
    const jsCode = websiteCode.js || websiteCode.JS || websiteCode.javascript || website.jsCode || '';

    const componentNames = components.map((c: any) => (c.name || '').replace(/\s+/g, ''));
    const mainJsxPreview = viteConfig?.mainJsx?.substring(0, 500) || viteConfig?.mainJs?.substring(0, 500) || '';
    console.log('WebsiteService.saveWebsiteEditFromFetchedCode - After normalization:', {
      componentNames,
      mainJsxPreview: mainJsxPreview || '(none)',
    });
    const badPlaceholder = componentNames.find((name: string) => name && mainJsxPreview.includes(`const ${name} = []`));
    if (badPlaceholder) {
      console.warn(
        'WebsiteService.saveWebsiteEditFromFetchedCode - mainJsx still contains placeholder for component:',
        badPlaceholder,
      );
    }

    console.log('WebsiteService.saveWebsiteEditFromFetchedCode - Extracted structure:', {
      hasComponents: components.length > 0,
      componentCount: components.length,
      hasViteConfig: !!viteConfig,
      legacyMode: components.length === 0,
    });

    const hasLegacySnippet =
      (typeof htmlCode === 'string' && htmlCode.trim().length > 0) ||
      (typeof jsCode === 'string' && jsCode.trim().length > 0) ||
      (typeof cssCode === 'string' && cssCode.trim().length > 0);
    const hasValidCode = components.length > 0 || hasViteAppCode || hasLegacySnippet || usedHostedOnlyFallback;
    if (!hasValidCode) {
      const err = new Error('The AI did not return valid website code for the edit. Try rephrasing your request.') as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    const storeAsVite = website.framework !== 'html' && (components.length > 0 || hasViteAppCode);
    if (storeAsVite) {
      website.components = components.length > 0 ? components : website.components;
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
    website.v0ChatId = newV0ChatId;
    website.v0DemoUrl = v0DemoUrl || undefined;
    if (!usedHostedOnlyFallback && (website.framework === 'react' || website.framework === 'html')) {
      website.reactBuildStatus = 'queued';
      website.reactBuildLog = undefined;
      website.reactArtifactUrl = undefined;
      website.reactBuildId = undefined;
      website.reactBuildStartedAt = undefined;
      website.reactBuildFinishedAt = undefined;
    }
    let savedWebsite = await this.websiteRepository.save(website);
    if (!usedHostedOnlyFallback && savedWebsite.framework === 'react') {
      console.log('WebsiteService.saveWebsiteEditFromFetchedCode - re-queueing React build after edit:', {
        websiteId: savedWebsite.id.toString(),
        status: savedWebsite.reactBuildStatus || null,
      });
      void this.reactPreviewBuildService.enqueue(savedWebsite.id.toString());
    } else if (!usedHostedOnlyFallback && savedWebsite.framework === 'html') {
      console.log('WebsiteService.saveWebsiteEditFromFetchedCode - publishing static HTML preview after edit:', {
        websiteId: savedWebsite.id.toString(),
      });
      const published = await this.reactPreviewBuildService.publishStaticPreview(savedWebsite.id.toString());
      if (published) savedWebsite = published;
    }

    console.log('WebsiteService.saveWebsiteEditFromFetchedCode - Success, website ID:', websiteId);
    return {
      ...savedWebsite,
      id: savedWebsite.id.toString(),
      components: storeAsVite ? (components.length > 0 ? components : savedWebsite.components) : savedWebsite.components,
      viteConfig: storeAsVite ? (viteConfig ?? savedWebsite.viteConfig) : savedWebsite.viteConfig,
      htmlCode: savedWebsite.htmlCode,
      cssCode: savedWebsite.cssCode,
      jsCode: savedWebsite.jsCode,
      message: 'Website updated successfully',
    };
  }

  /**
   * Edit: prefer `chats.sendMessage` + stored `v0ChatId` (v0-clone). Fallback: `chats.create` with inlined site JSON when no chat id.
   */
  async editWebsite(
    websiteId: string,
    userId: string,
    editPrompt: string,
    framework?: string,
    attachments?: V0MessageAttachment[],
    displayEditPrompt?: string,
  ) {
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
    const resolvedFramework = this.normalizeFramework(framework);
    website.framework = resolvedFramework;
    const creditCost = this.getCreditCost('edit', resolvedFramework, attachments);
    const usage = await this.beginUsage({
      userId,
      kind: 'edit',
      framework: resolvedFramework,
      prompt: displayEditPrompt?.trim() || editPrompt,
      credits: creditCost,
      attachments,
      websiteId,
    });

    try {
      const v0ChatIdTrimmed = website.v0ChatId?.trim();
      const editV0Path = v0ChatIdTrimmed ? ('sendMessage' as const) : ('create_fallback' as const);
      let websiteCodeRaw: any;
      let newV0ChatId: string;
      let newV0DemoUrl: string | undefined;

      if (v0ChatIdTrimmed) {
        console.log('WebsiteService.editWebsite - Continuing v0 chat via sendMessage:', v0ChatIdTrimmed);
        const r = await this.fetchWebsiteCodeFromV0SendMessage(
          v0ChatIdTrimmed,
          this.buildFrameworkScopedEditMessage(editPrompt.trim(), resolvedFramework),
          attachments,
        );
        websiteCodeRaw = r.websiteCode;
        newV0ChatId = r.v0ChatId;
        newV0DemoUrl = r.v0DemoUrl;
      } else {
        console.log('WebsiteService.editWebsite - No v0ChatId; fallback chats.create + inlined site payload');
        const isComponentBased =
          resolvedFramework !== 'html' &&
          ((website.components?.length ?? 0) > 0 ||
            !!(website.viteConfig?.mainJsx || website.viteConfig?.mainJs));

        const editSystemPrompt = isComponentBased
          ? `You are an expert editor for React/Vite websites. You will receive the CURRENT website as a JSON object with "components" (array of { name, type, path, code, language }) and "viteConfig" (object with packageJson, viteConfig, indexHtml, mainJsx, styleCss). The user will give you ONE edit instruction. Your job is to return the COMPLETE updated website in the EXACT SAME JSON structure. Rules:
- Return ONLY valid JSON. No markdown, no explanation, no code blocks. Pure JSON starting with { and ending with }.
- Change ONLY what the user asked. Keep all other components and config identical.
- Preserve component names, paths, and file structure unless the user explicitly asks to add/rename/remove.
- If adding new components, add them to the components array and update mainJsx to import and render them.
- Keep the same code style and patterns. Do not strip or simplify existing code.
- Output the full JSON: { "components": [...], "viteConfig": { ... } }.`
          : `You are an expert editor for HTML/CSS/JS websites. You will receive the CURRENT website as HTML, CSS, and JS. The user will give you ONE edit instruction. Return a JSON object with "html", "css", "js" containing the FULL updated code. Rules:
- Return ONLY valid JSON: { "html": "...", "css": "...", "js": "..." }. No markdown, no explanation, no code fences.
- "html", "css", and "js" must all be present and non-empty strings.
- Change ONLY what the user asked. Keep everything else identical.
- Keep it static HTML/CSS/JS only. Do NOT add React, Next.js, JSX, TypeScript, package.json, Vite, npm, or framework imports.
- HTML must remain a complete document and must link ./styles.css and ./script.js.
- Put all styling in "css" and all behavior in "js".
- Escape strings for JSON (newlines as \\n, quotes escaped).`;

        const userMessage = isComponentBased
          ? `Target framework: ${resolvedFramework === 'react' ? 'React (Vite)' : 'Next.js'}\nCurrent website (JSON):\n${JSON.stringify({ components: website.components || [], viteConfig: website.viteConfig || {} })}\n\nUser edit request: ${editPrompt}`
          : `Target framework: ${resolvedFramework === 'html' ? 'static HTML/CSS/JS' : 'HTML/CSS/JS'}\nCurrent HTML:\n${website.htmlCode || ''}\n\nCurrent CSS:\n${website.cssCode || ''}\n\nCurrent JS:\n${website.jsCode || ''}\n\nUser edit request: ${editPrompt}`;

        const r = await this.fetchWebsiteCodeFromV0(editSystemPrompt, userMessage, attachments);
        websiteCodeRaw = r.websiteCode;
        newV0ChatId = r.v0ChatId;
        newV0DemoUrl = r.v0DemoUrl;
      }

      const saved = await this.saveWebsiteEditFromFetchedCode(
        website,
        websiteId,
        websiteCodeRaw,
        displayEditPrompt?.trim() || editPrompt,
        newV0ChatId,
        newV0DemoUrl,
      );
      await this.completeUsageSuccess(usage, userId, creditCost, {
        websiteId: saved.id || websiteId,
        v0ChatId: newV0ChatId,
        v0DemoUrl: newV0DemoUrl,
      });
      return { ...saved, editV0Path };
    } catch (error) {
      await this.completeUsageFailed(usage, error);
      throw error;
    }
  }

  /**
   * v0 only receives `message` on chat create — the model never saw `websiteName` unless we inline it.
   * Skip auto placeholders like `Website 1739…` so we do not force a fake brand name.
   */
  private buildV0GenerationUserMessage(
    prompt: string,
    websiteName: string,
    framework: WebsiteFramework,
  ): string {
    const p = (prompt || '').trim();
    const boundedPrompt =
      framework === 'react'
        ? this.buildReactBoundedPrompt(p)
        : framework === 'html'
          ? this.buildHtmlBoundedPrompt(p)
          : p;
    const raw = (websiteName || '').trim();
    const looksAutoPlaceholder = /^Website\s+\d{10,}$/i.test(raw);
    const name = looksAutoPlaceholder ? '' : raw;
    const frameworkHeader =
      framework === 'react'
        ? 'Target framework: React (Vite).'
        : framework === 'html'
          ? 'Target framework: static HTML/CSS/JS.'
          : 'Target framework: Next.js.';
    if (!name) return `${frameworkHeader}\n\nRequirements:\n${boundedPrompt}`;
    return (
      `${frameworkHeader}\n\n` +
      `Site name (use for <title>, document/branding text, header/logo label, and package.json "name" where applicable - keep this exact name, do not substitute a different product title):\n` +
      `${JSON.stringify(name)}\n\n` +
      `Requirements:\n${boundedPrompt}`
    );
  }

  private buildReactBoundedPrompt(prompt: string): string {
    return `${prompt}

STRICT REACT/VITE BOUNDARY (must follow):
- Build ONLY a React + Vite project. Do NOT generate Next.js files (no app/layout.tsx, no next/* imports, no metadata export).
- Return component-based JSON structure with "components" and "viteConfig".
- Keep routing with react-router-dom when multiple pages are requested.
- Ensure viteConfig.mainJsx imports React, ReactDOM, BrowserRouter/Routes/Route, and mounts App via createRoot.
- Use only browser-safe client-side React code.`;
  }

  private buildHtmlBoundedPrompt(prompt: string): string {
    return `${prompt}

STRICT STATIC HTML/CSS/JS BOUNDARY (must follow):
- Build ONLY a static website with HTML, CSS, and vanilla JavaScript.
- Return ONLY valid JSON. No markdown, no prose, no code fences.
- Return exactly three non-empty top-level string fields: "html", "css", and "js".
- Do NOT generate React, Next.js, JSX, TypeScript, package.json, Vite, npm scripts, Tailwind build steps, or framework imports.
- The HTML must be a complete document and must link to ./styles.css and ./script.js exactly once.
- Put all styles in "css"; put all behavior in "js"; no inline style attributes, onclick attributes, or inline <script> logic.
- CSS must be polished, responsive, mobile-first, and include :root variables, media queries, hover/focus states, layout, typography, forms/buttons/cards/nav/footer styling.
- JavaScript must be browser-safe vanilla JavaScript, initialized on DOMContentLoaded, with guarded DOM queries and real interactions relevant to the prompt.
- No TODOs, no placeholders, no empty strings, no stubs.`;
  }

  private buildFrameworkScopedEditMessage(editPrompt: string, framework: WebsiteFramework): string {
    const target =
      framework === 'react'
        ? 'React (Vite)'
        : framework === 'html'
          ? 'static HTML/CSS/JS'
          : 'Next.js';
    if (framework === 'react') {
      return `Target framework: ${target}. Keep this framework while applying the edit.

Edit request:
${editPrompt}

STRICT REACT/VITE EDIT BOUNDARY (must follow):
- Build ONLY a React + Vite project. Do NOT generate Next.js files (no app/layout.tsx, no next/* imports, no metadata export).
- Return ONLY the complete updated project JSON. No markdown, no prose, no explanation, no code fences.
- The response must start with { and end with }.
- Return component-based JSON structure with exactly the same top-level shape: { "components": [...], "viteConfig": { ... } }.
- Preserve all existing component names, paths, languages, packageJson, viteConfig, indexHtml, mainJsx/mainJs, and styleCss unless the edit explicitly requires changing them.
- Change ONLY what the edit request asks for.
- Ensure viteConfig.mainJsx imports React, ReactDOM from react-dom/client, BrowserRouter/Routes/Route when routing is used, and mounts App via createRoot.
- Keep routing with react-router-dom when multiple pages/routes exist.
- Use only browser-safe client-side React code.
- All code fields must be valid escaped JSON strings with \\n for newlines.`;
    }
    if (framework === 'html') {
      return `Target framework: ${target}. Keep this framework while applying the edit.

Edit request:
${editPrompt}

STRICT STATIC HTML/CSS/JS EDIT BOUNDARY (must follow):
- Build ONLY a static website with HTML, CSS, and vanilla JavaScript.
- Return ONLY valid JSON. No markdown, no prose, no explanation, no code fences.
- The response must start with { and end with }.
- Return JSON with exactly "html", "css", and "js" string fields.
- "html", "css", and "js" must all be non-empty strings.
- Do NOT generate React, Next.js, JSX, TypeScript, package.json, Vite, npm scripts, or framework imports.
- Change ONLY what the edit request asks for.
- The HTML must remain a complete document and link to ./styles.css and ./script.js exactly once.
- Put all styling in "css"; put all behavior in "js"; no inline onclick handlers.
- The JavaScript must be browser-safe vanilla JavaScript, initialized on DOMContentLoaded where needed, with guarded DOM queries.
- All code fields must be valid escaped JSON strings with \\n for newlines.`;
    }
    return `Target framework: ${target}. Keep this framework while applying the edit.

Edit request:
${editPrompt}

STRICT EDIT BOUNDARY:
- Return only code output artifacts. No markdown explanations.
- Change ONLY what the edit request asks for.
- Keep the existing project structure unless the edit explicitly requires changing it.`;
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
      const bases = results
        .map((r) => r?.urls?.regular || r?.urls?.raw)
        .filter((b): b is string => !!b);
      const validated: string[] = [];
      const batchSize = 12;
      for (let i = 0; i < bases.length && validated.length < count; i += batchSize) {
        const batch = bases.slice(i, i + batchSize);
        const checks = await Promise.all(
          batch.map(async (base) => ({ base, ok: await this.isImageUrlOk(base) })),
        );
        for (const { base, ok } of checks) {
          if (ok) validated.push(base);
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
        timeout: Number(process.env.IMAGE_HEAD_TIMEOUT_MS) || 2800,
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
    /** Faster saves: skip per-URL HEAD checks (regex/imgur fixes only). Set WEBGENIUS_SKIP_IMAGE_HEAD=1 if v0 slugs are trusted. */
    if (process.env.WEBGENIUS_SKIP_IMAGE_HEAD === '1') {
      return this.replaceBrokenImageUrls(code);
    }
    const imageUrlRegex = /https?:\/\/[^\s"'<>)\]]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>)\]]*)?|https?:\/\/(?:images\.)?unsplash\.com\/[^\s"'<>)\]]+/gi;
    const allMatches = code.match(imageUrlRegex) || [];
    const unique = [...new Set(allMatches)];
    const toCheck = unique.slice(0, 25);
    const concurrency = Math.max(1, Math.min(20, Number(process.env.IMAGE_HEAD_CONCURRENCY) || 10));
    const toReplace = new Set<string>();
    for (let i = 0; i < toCheck.length; i += concurrency) {
      const batch = toCheck.slice(i, i + concurrency);
      const outcomes = await Promise.all(
        batch.map(async (url) => ({ url, ok: await this.isImageUrlOk(url) })),
      );
      for (const { url, ok } of outcomes) {
        const short = url.length > 60 ? url.substring(0, 60) + '...' : url;
        if (ok) console.log('[IMAGE] URL OK:', short);
        else {
          toReplace.add(url);
          console.log('[IMAGE] URL BROKEN (will replace):', short);
        }
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

  /** Optional; omit to use v0 platform default. Set V0_PLATFORM_MODEL_ID to v0-auto | v0-mini | v0-pro | v0-max | v0-max-fast. */
  private getV0ModelConfiguration(): ChatsCreateRequest['modelConfiguration'] | undefined {
    const explicit = (process.env.V0_PLATFORM_MODEL_ID || '').trim();
    const allowed = ['v0-auto', 'v0-mini', 'v0-pro', 'v0-max', 'v0-max-fast'] as const;
    if (allowed.includes(explicit as (typeof allowed)[number])) {
      return { modelId: explicit as (typeof allowed)[number] };
    }
    return undefined;
  }

  /**
   * For **diagnostics only** (`GET /website/v0-chat-check`). Website generate/edit **always** uses `async` + poll — see `invokeV0ChatCreate`.
   */
  private getV0ResponseMode(): 'sync' | 'async' {
    return (process.env.V0_RESPONSE_MODE || 'async').toLowerCase() === 'sync' ? 'sync' : 'async';
  }

  private getV0ApiKeyOrThrow(): string {
    const key = WebsiteService.normalizeV0ApiKey(process.env.V0_API_KEY);
    if (!key) {
      throw new Error('V0_API_KEY is not configured.');
    }
    return key;
  }

  private getV0BaseUrl(): string {
    return (process.env.V0_API_URL || 'https://api.v0.dev/v1').replace(/\/+$/, '');
  }

  private createChatAxiosTimeoutMs(body: ChatsCreateRequest): number {
    if (body.responseMode === 'async') {
      return Number(process.env.V0_CREATE_ASYNC_TIMEOUT_MS) || 180000;
    }
    return Number(process.env.V0_CREATE_TIMEOUT_MS) || 600000;
  }

  private async createV0ChatWithAxios(
    body: ChatsCreateRequest,
    timeoutMs?: number,
  ): Promise<ChatDetail> {
    const ms = timeoutMs ?? this.createChatAxiosTimeoutMs(body);
    const res = await axios.post<ChatDetail>(`${this.getV0BaseUrl()}/chats`, body, {
      headers: {
        Authorization: `Bearer ${this.getV0ApiKeyOrThrow()}`,
        'Content-Type': 'application/json',
      },
      timeout: ms,
    });
    return res.data;
  }

  private sendMessageAxiosTimeoutMs(body: ChatsSendMessageRequest): number {
    if (body.responseMode === 'async') {
      return Number(process.env.V0_CREATE_ASYNC_TIMEOUT_MS) || 180000;
    }
    return Number(process.env.V0_CREATE_TIMEOUT_MS) || 600000;
  }

  private async sendV0MessageWithAxios(
    chatId: string,
    body: ChatsSendMessageRequest,
    timeoutMs?: number,
  ): Promise<ChatDetail> {
    const ms = timeoutMs ?? this.sendMessageAxiosTimeoutMs(body);
    const res = await axios.post<ChatDetail>(
      `${this.getV0BaseUrl()}/chats/${encodeURIComponent(chatId)}/messages`,
      body,
      {
        headers: {
          Authorization: `Bearer ${this.getV0ApiKeyOrThrow()}`,
          'Content-Type': 'application/json',
        },
        timeout: ms,
      },
    );
    return res.data;
  }

  /** Same HTTP stack as create; avoids SDK/getById mismatch. v0 may return 404 until the chat is indexed (race after async create). */
  private async getV0ChatByIdRest(chatId: string): Promise<ChatDetail> {
    const url = `${this.getV0BaseUrl()}/chats/${encodeURIComponent(chatId)}`;
    const timeout = Number(process.env.V0_GET_CHAT_TIMEOUT_MS) || 60_000;
    const res = await axios.get<ChatDetail>(url, {
      headers: { Authorization: `Bearer ${this.getV0ApiKeyOrThrow()}` },
      timeout,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }

  async runV0ChatCheck(message: string, system?: string) {
    const startedAt = Date.now();
    const body: ChatsCreateRequest = {
      message: message || 'make a red button',
      responseMode: this.getV0ResponseMode(),
    };
    if (system) body.system = system;

    try {
      const chat = await this.createV0ChatWithAxios(body);
      return {
        ok: true,
        statusCode: 200,
        elapsedMs: Date.now() - startedAt,
        mode: body.responseMode,
        chatId: chat.id,
        fileCount: chat.latestVersion?.files?.length ?? 0,
      };
    } catch (error: any) {
      const msg = String(error?.response?.data ? JSON.stringify(error.response.data) : (error?.message || error));
      const statusCode = Number(error?.response?.status) || Number((msg.match(/HTTP\s+(\d{3})/i) || [])[1]) || 500;
      return {
        ok: false,
        statusCode,
        elapsedMs: Date.now() - startedAt,
        mode: body.responseMode,
        error: msg,
      };
    }
  }

  private normalizeV0SdkFiles(
    files: { name: string; content: string }[],
  ): { path: string; content: string }[] {
    return files.map((f) => {
      let p = (f.name || '').trim().replace(/^\/+/, '');
      if (p.startsWith('src/')) p = p.slice(4);
      return { path: p, content: f.content || '' };
    });
  }

  /** Auth / wrong URL / plan errors will not succeed on retry — fail fast. */
  private isV0NonRetryableHttpError(err: unknown): boolean {
    const msg = String((err as Error)?.message || err);
    if (/\bHTTP 401\b/.test(msg) || /unauthorized_error/i.test(msg)) return true;
    if (/\bHTTP 403\b/.test(msg) || /forbidden_error/i.test(msg)) return true;
    // chat_not_found can happen transiently when polling async chats; allow retry.
    if (/chat_not_found/i.test(msg)) return false;
    if (/\bHTTP 404\b/.test(msg) || /not_found_error/i.test(msg)) return true;
    return false;
  }

  /** v0-hosted preview URL from create/get chat payload (official v0-clone uses `demo` or `latestVersion.demoUrl`). */
  private extractV0DemoFromChatDetail(chat: ChatDetail): string | undefined {
    const c = chat as ChatDetail & { demo?: string; latestVersion?: { demoUrl?: string } };
    const u = c.demo || c.latestVersion?.demoUrl;
    return typeof u === 'string' && u.trim().length > 0 ? u.trim() : undefined;
  }

  /** When create response has no demo yet, refetch chat (matches v0-clone flow after stream completes). */
  private async fetchV0DemoUrlByChatId(chatId: string): Promise<string | undefined> {
    try {
      const detail = await this.getV0ChatByIdRest(chatId);
      return this.extractV0DemoFromChatDetail(detail);
    } catch (e: unknown) {
      console.warn('WebsiteService - get chat for demo URL failed:', this.formatV0NetworkError(e));
      return undefined;
    }
  }

  private formatV0NetworkError(err: unknown): string {
    const e = err as Error & { cause?: unknown; code?: string };
    const parts = [e?.message || String(err)];
    const c = e?.cause as NodeJS.ErrnoException | undefined;
    if (c?.code) parts.push(`cause.code=${c.code}`);
    if (c?.message && c.message !== e?.message) parts.push(`cause.message=${c.message}`);
    if (e?.code) parts.push(`code=${e.code}`);
    return parts.filter(Boolean).join(' | ');
  }

  private formatV0HttpError(status: number, rawBody: string): string {
    const raw = (rawBody || '').trim();
    let providerType = '';
    let providerMessage = '';
    try {
      const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string }; message?: string };
      providerType = parsed.error?.type || '';
      providerMessage = parsed.error?.message || parsed.message || '';
    } catch {
      providerMessage = raw;
    }

    if (status === 401) {
      return 'v0 rejected the API key (401). Add a valid V0_API_KEY from v0 settings and restart the backend.';
    }

    if (status === 403 || /forbidden_error/i.test(providerType)) {
      return `v0 refused this generation request (403 Forbidden${providerMessage ? `: ${providerMessage}` : ''}). Check that V0_API_KEY is a v0 Platform API key with access enabled, the account plan/credits allow Platform API usage, and V0_PLATFORM_MODEL_ID is allowed for that key.`;
    }

    return providerMessage
      ? `v0 returned HTTP ${status}: ${providerMessage}`
      : `v0 returned HTTP ${status}`;
  }

  /** Generated source files: Platform API returns them on `latestVersion.files` (name + content). */
  private getV0GeneratedFileRecords(chat: ChatDetail): { name: string; content: string }[] {
    const list = chat.latestVersion?.files ?? [];
    return list.map((f) => ({ name: f.name, content: f.content || '' }));
  }

  private getLastAssistantContent(chat: ChatDetail): string | undefined {
    const msgs = chat.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].content) return msgs[i].content;
    }
    return undefined;
  }

  /** Last assistant message identity (for follow-up: detect a new reply even if file hash lags). */
  private getLastAssistantTail(chat: ChatDetail): { id?: string; updatedAt?: string } {
    const msgs = chat.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        return { id: msgs[i].id, updatedAt: msgs[i].updatedAt };
      }
    }
    return {};
  }

  private serializeChatForHistory(chat: ChatDetail): string {
    try {
      const files = (chat.latestVersion?.files || []).map((f) => ({
        name: f.name,
        contentLength: (f.content || '').length,
      }));
      const payload = { chatId: chat.id, text: chat.text, files };
      const s = JSON.stringify(payload);
      return s.length > 500_000 ? s.slice(0, 500_000) + '…' : s;
    } catch {
      return chat.text || '';
    }
  }

  /** Stable hash of latestVersion file names + contents (order-independent) for detecting real edits after sendMessage. */
  private v0FilesContentSignature(chat: ChatDetail): string {
    const files = this.getV0GeneratedFileRecords(chat)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const h = crypto.createHash('sha256');
    for (const f of files) {
      h.update(f.name);
      h.update('\0');
      h.update(f.content || '');
      h.update('\0');
    }
    return h.digest('hex');
  }

  /**
   * After async create, v0 may return before the chat is readable (`chat_not_found`) or before files exist — poll with backoff.
   * For `chats.sendMessage`, the chat often **already** has files from the previous turn; we must poll until those files change
   * (or version advances), otherwise we persist stale code while still appending [Edit] to the prompt.
   */
  private async waitForV0ChatReady(
    chat: ChatDetail,
    usedAsyncCreate: boolean,
    opts?: {
      followUpMessage?: boolean;
      priorFilesContentSig?: string;
      priorVersionId?: string;
      /** From GET /chats/:id before sendMessage — detect completion when v0 bumps chat.updatedAt but file hash lags. */
      priorChatUpdatedAt?: string;
      priorLatestVersionUpdatedAt?: string;
      priorAssistantTail?: { id?: string; updatedAt?: string };
    },
  ): Promise<ChatDetail> {
    const followUp = opts?.followUpMessage === true;
    const priorSig = opts?.priorFilesContentSig;
    const priorVid = opts?.priorVersionId;
    const priorChatUpdatedAt = opts?.priorChatUpdatedAt;
    const priorLatestVersionUpdatedAt = opts?.priorLatestVersionUpdatedAt;
    const priorAssistantTail = opts?.priorAssistantTail;

    if (!usedAsyncCreate && !followUp) {
      return chat;
    }
    if (!followUp && (this.getV0GeneratedFileRecords(chat).length > 0 || this.websiteCodeFromChatDetail(chat) != null)) {
      return chat;
    }
    const raw = chat as ChatDetail & { chatId?: string };
    const chatId = chat.id || raw.chatId;
    if (!chatId) {
      return chat;
    }
    const baseInterval = Number(process.env.V0_POLL_INTERVAL_MS) || 2500;
    /** Shorter default than 12s: stream/async often has a ready chat sooner; still override with V0_POLL_INITIAL_DELAY_MS. */
    const initialDelay = Number(process.env.V0_POLL_INITIAL_DELAY_MS) || 4000;
    const maxMs = Number(process.env.V0_POLL_MAX_MS) || 600_000;
    const maxBackoff = Number(process.env.V0_POLL_MAX_BACKOFF_MS) || 45_000;
    /** Stop hammering GET when id never becomes visible (v0 flakiness); outer loop retries with sync create. */
    const maxNotFoundWallMs = Number(process.env.V0_POLL_MAX_NOT_FOUND_MS) || 180_000;
    const deadline = Date.now() + maxMs;
    let last = chat;
    let notFoundBackoff = baseInterval;
    let notFoundWallMs = 0;
    console.log(
      followUp
        ? 'WebsiteService - follow-up mode: wait for NEW artifact (file hash or version id change)'
        : 'WebsiteService - async mode: wait',
      initialDelay,
      'ms then poll GET /chats/:id (chatId=',
      chatId,
      'maxMs=',
      maxMs,
      ')',
    );
    await new Promise((r) => setTimeout(r, initialDelay));
    const followUpLoopStart = Date.now();
    while (Date.now() < deadline) {
      try {
        last = await this.getV0ChatByIdRest(chatId);
        notFoundBackoff = baseInterval;
        notFoundWallMs = 0;
      } catch (e: unknown) {
        const msg = this.formatV0NetworkError(e);
        const isNotFound = /chat_not_found|HTTP 404/i.test(msg);
        if (isNotFound) {
          const wait = Math.min(notFoundBackoff, maxBackoff);
          if (notFoundWallMs + wait > maxNotFoundWallMs) {
            console.warn(
              'WebsiteService - poll gave up after ~',
              maxNotFoundWallMs,
              'ms of chat_not_found (id may never index); will retry with sync if configured',
            );
            break;
          }
          console.warn(
            'WebsiteService - poll GET /chats/:id not ready (chat_not_found / 404); backing off',
            wait,
            'ms —',
            msg.substring(0, 120),
          );
          await new Promise((r) => setTimeout(r, wait));
          notFoundWallMs += wait;
          notFoundBackoff = Math.min(notFoundBackoff * 2, maxBackoff);
          continue;
        }
        console.warn('WebsiteService - poll GET /chats/:id:', msg);
        await new Promise((r) => setTimeout(r, baseInterval));
        continue;
      }
      const files = this.getV0GeneratedFileRecords(last);
      const status = last.latestVersion?.status;
      const sigNow = this.v0FilesContentSignature(last);
      const vidNow = last.latestVersion?.id;

      if (followUp && priorSig !== undefined) {
        const parsedWebsiteCode = this.websiteCodeFromChatDetail(last);
        const filesReady = files.length > 0 || parsedWebsiteCode != null;
        const sigChanged = sigNow !== priorSig;
        const vidChanged = priorVid != null && vidNow != null && vidNow !== priorVid;
        const chatMetaChanged =
          priorChatUpdatedAt != null &&
          last.updatedAt != null &&
          last.updatedAt !== priorChatUpdatedAt;
        const verUpdNow = last.latestVersion?.updatedAt;
        const verUpdChanged =
          priorLatestVersionUpdatedAt != null &&
          verUpdNow != null &&
          verUpdNow !== priorLatestVersionUpdatedAt;
        const tailNow = this.getLastAssistantTail(last);
        const assistantChanged =
          priorAssistantTail?.id != null &&
          tailNow.id != null &&
          (tailNow.id !== priorAssistantTail.id ||
            (tailNow.updatedAt != null &&
              priorAssistantTail.updatedAt != null &&
              tailNow.updatedAt !== priorAssistantTail.updatedAt));
        if (status === 'failed') {
          console.warn('WebsiteService - follow-up poll: latestVersion failed');
          return last;
        }

        if (parsedWebsiteCode && assistantChanged) {
          console.log('WebsiteService - follow-up poll complete (new assistant project JSON)', {
            fileCount: files.length,
            status,
          });
          return last;
        }

        // New file bytes visible (status may still be pending on the platform)
        if (filesReady && sigChanged && (status === 'completed' || status === 'pending')) {
          console.log('WebsiteService - follow-up poll complete (file hash changed)', {
            fileCount: files.length,
            status,
          });
          return last;
        }

        // Prefer file hash; also accept version id / chat / latestVersion timestamps (v0 bumps these when publishing)
        if (
          status === 'completed' &&
          filesReady &&
          (vidChanged || chatMetaChanged || sigChanged || verUpdChanged)
        ) {
          console.log('WebsiteService - follow-up poll complete', {
            fileCount: files.length,
            sigChanged,
            vidChanged,
            chatMetaChanged,
            verUpdChanged,
          });
          return last;
        }

        await new Promise((r) => setTimeout(r, baseInterval));
        continue;
      }

      if (files.length > 0 || this.websiteCodeFromChatDetail(last) != null) {
        console.log('WebsiteService - poll complete, fileCount=', files.length);
        return last;
      }
      await new Promise((r) => setTimeout(r, baseInterval));
    }
    console.warn('WebsiteService - poll stopped; using last chat state (may be empty → triggers retry/sync)');
    if (followUp && priorSig !== undefined) {
      const finalSig = this.v0FilesContentSignature(last);
      const finalVid = last.latestVersion?.id;
      const vidOk = priorVid != null && finalVid != null && finalVid !== priorVid;
      const verUpdOk =
        priorLatestVersionUpdatedAt != null &&
        last.latestVersion?.updatedAt != null &&
        last.latestVersion.updatedAt !== priorLatestVersionUpdatedAt;
      const tail = this.getLastAssistantTail(last);
      const asstOk =
        priorAssistantTail?.id != null &&
        tail.id != null &&
        (tail.id !== priorAssistantTail.id ||
          (tail.updatedAt != null &&
            priorAssistantTail.updatedAt != null &&
            tail.updatedAt !== priorAssistantTail.updatedAt));
      if (finalSig === priorSig && !vidOk && !verUpdOk) {
        const errMsg = asstOk
          ? 'v0 replied to your edit but did not publish updated project files in time. Wait a minute and try again.'
          : 'Timed out waiting for v0 to apply this edit (no new files or version activity detected). Wait a moment and try again, or shorten the request.';
        const err = new Error(errMsg) as Error & { status?: number };
        err.status = 504;
        throw err;
      }
    }
    return last;
  }

  /**
   * `async` + poll first (fast when v0 indexes the chat). `sync` = one long POST until done (used on retries when poll never sees the chat).
   */
  private async invokeV0ChatCreate(
    systemPrompt: string,
    userMessage: string,
    responseMode: 'sync' | 'async' = 'async',
    attachments?: V0MessageAttachment[],
  ): Promise<ChatDetail> {
    const modelConfiguration = this.getV0ModelConfiguration();
    const normalizedAttachments = this.normalizeV0Attachments(attachments);
    const body: ChatsCreateRequest = {
      message: userMessage,
      system: systemPrompt,
      responseMode,
    };
    if (normalizedAttachments) body.attachments = normalizedAttachments;
    if (modelConfiguration) body.modelConfiguration = modelConfiguration;
    console.log(
      'WebsiteService - v0 chats.create',
      'mode=',
      responseMode,
      responseMode === 'async'
        ? '(then poll getById — avoids long single HTTP response / headers timeout)'
        : '(single long request — may hit client timeouts)',
      'promptLength=',
      userMessage.length,
    );
    let result: ChatDetail | ReadableStream;
    const useAxiosFirst = process.env.V0_CREATE_USE_AXIOS_FIRST !== '0';
    try {
      if (useAxiosFirst) {
        result = await this.createV0ChatWithAxios(body);
      } else {
        try {
          result = await this.v0Platform.chats.create(body);
        } catch (e: unknown) {
          const msg = this.formatV0NetworkError(e);
          if (/UND_ERR_HEADERS_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
            console.warn('WebsiteService - SDK fetch failed; retrying create via axios...');
            result = await this.createV0ChatWithAxios(body);
          } else {
            throw e;
          }
        }
      }
    } catch (e: unknown) {
      throw e;
    }
    if (result != null && typeof (result as ReadableStream).getReader === 'function') {
      throw new Error(`v0.chats.create returned a stream; set V0_RESPONSE_MODE=sync|async JSON modes only (got ${responseMode}).`);
    }
    let chat = result as ChatDetail;
    const r = chat as ChatDetail & { chat?: { id?: string } };
    if (!chat.id && r.chat?.id) {
      chat = { ...chat, id: r.chat.id } as ChatDetail;
      console.log('WebsiteService - normalized chat id from nested response.chat.id');
    }
    chat = await this.waitForV0ChatReady(chat, responseMode === 'async');
    console.log('WebsiteService - v0 chat ready, chatId=', chat?.id || '(unknown)');
    return chat;
  }

  /**
   * Follow-up message on an existing v0 chat (same as v0-clone `chats.sendMessage`).
   * Does not send `system`; conversation context stays on the platform.
   */
  private async invokeV0ChatSendMessage(
    chatId: string,
    message: string,
    responseMode: 'sync' | 'async' = 'async',
    /** Snapshot from GET /chats/:id immediately before sendMessage; avoids persisting stale files when latestVersion already had code. */
    priorArtifact?: {
      contentSig: string;
      versionId?: string;
      chatUpdatedAt?: string;
      latestVersionUpdatedAt?: string;
      assistantTail?: { id?: string; updatedAt?: string };
    },
    attachments?: V0MessageAttachment[],
  ): Promise<ChatDetail> {
    const modelConfiguration = this.getV0ModelConfiguration();
    const normalizedAttachments = this.normalizeV0Attachments(attachments);
    const body: ChatsSendMessageRequest = {
      message,
      responseMode,
    };
    if (normalizedAttachments) body.attachments = normalizedAttachments;
    if (modelConfiguration) body.modelConfiguration = modelConfiguration;
    console.log(
      'WebsiteService - v0 chats.sendMessage',
      'chatId=',
      chatId,
      'mode=',
      responseMode,
      responseMode === 'async'
        ? '(then poll getById)'
        : '(single long request — may hit client timeouts)',
      'messageLength=',
      message.length,
    );
    let result: ChatDetail | ReadableStream;
    const useAxiosFirst = process.env.V0_CREATE_USE_AXIOS_FIRST !== '0';
    try {
      if (useAxiosFirst) {
        result = await this.sendV0MessageWithAxios(chatId, body);
      } else {
        try {
          result = await this.v0Platform.chats.sendMessage({ chatId, ...body });
        } catch (e: unknown) {
          const msg = this.formatV0NetworkError(e);
          if (/UND_ERR_HEADERS_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
            console.warn('WebsiteService - SDK sendMessage failed; retrying via axios...');
            result = await this.sendV0MessageWithAxios(chatId, body);
          } else {
            throw e;
          }
        }
      }
    } catch (e: unknown) {
      throw e;
    }
    if (result != null && typeof (result as ReadableStream).getReader === 'function') {
      throw new Error(
        `v0.chats.sendMessage returned a stream; use POST /website/:id/edit-stream for experimental_stream, or sync/async only here.`,
      );
    }
    let chat = result as ChatDetail;
    const r = chat as ChatDetail & { chat?: { id?: string } };
    if (!chat.id && r.chat?.id) {
      chat = { ...chat, id: r.chat.id } as ChatDetail;
      console.log('WebsiteService - normalized chat id from nested response.chat.id (sendMessage)');
    }
    const resolvedId = chat.id || chatId;
    if (!chat.id) {
      chat = { ...chat, id: resolvedId } as ChatDetail;
    }
    let priorSig = priorArtifact?.contentSig;
    let priorVid = priorArtifact?.versionId;
    let priorChatUpd = priorArtifact?.chatUpdatedAt;
    let priorLatestVerUpd = priorArtifact?.latestVersionUpdatedAt;
    let priorAsstTail = priorArtifact?.assistantTail;
    if (priorSig === undefined) {
      priorSig = this.v0FilesContentSignature(chat);
      priorVid = chat.latestVersion?.id;
      priorChatUpd = chat.updatedAt;
      priorLatestVerUpd = chat.latestVersion?.updatedAt;
      const t = this.getLastAssistantTail(chat);
      priorAsstTail = t.id ? t : undefined;
    }
    chat = await this.waitForV0ChatReady(chat, responseMode === 'async', {
      followUpMessage: true,
      priorFilesContentSig: priorSig,
      priorVersionId: priorVid,
      priorChatUpdatedAt: priorChatUpd,
      priorLatestVersionUpdatedAt: priorLatestVerUpd,
      priorAssistantTail: priorAsstTail?.id != null ? priorAsstTail : undefined,
    });
    console.log('WebsiteService - v0 sendMessage chat ready, chatId=', chat?.id || '(unknown)');
    return chat;
  }

  private websiteCodeFromChatDetail(chat: ChatDetail): any {
    const filesRaw = this.getV0GeneratedFileRecords(chat);
    const normalized = this.normalizeV0SdkFiles(filesRaw);
    if (normalized.length > 0) {
      return this.convertV0FilesToStructure({
        files: normalized.map((f) => ({ path: f.path, content: f.content })),
      });
    }
    const textCandidates = [chat.text, this.getLastAssistantContent(chat)].filter(Boolean) as string[];
    for (const t of textCandidates) {
      let w = this.parseV0Response(t);
      if (!w) w = this.extractCodeFromResponse(t);
      if (w?.files && Array.isArray(w.files)) return this.convertV0FilesToStructure(w);
      if (w) return w;
    }
    return null;
  }

  private async fetchWebsiteCodeFromV0(
    systemPrompt: string,
    userPrompt: string,
    attachments?: V0MessageAttachment[],
  ): Promise<{ responseContent: string; websiteCode: any; v0ChatId: string; v0DemoUrl?: string }> {
    const MAX_V0_ATTEMPTS = Number(process.env.V0_MAX_RETRIES) || 3;
    const RETRY_DELAY_MS = 1500;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let responseContent = '{}';
    let websiteCode: any = null;

    for (let attempt = 1; attempt <= MAX_V0_ATTEMPTS; attempt++) {
      console.log('WebsiteService - v0 Platform API attempt', attempt, 'of', MAX_V0_ATTEMPTS);
      const syncOnRetry = process.env.V0_WEBSITE_RETRY_WITH_SYNC !== '0';
      const mode: 'sync' | 'async' = syncOnRetry && attempt > 1 ? 'sync' : 'async';
      if (attempt > 1 && mode === 'sync') {
        console.log(
          'WebsiteService - attempt',
          attempt,
          'uses sync chats.create (same prompt) because async+poll can hit persistent chat_not_found — one long request,',
          Number(process.env.V0_CREATE_TIMEOUT_MS) || 600000,
          'ms timeout',
        );
      }
      let chat: ChatDetail;
      try {
        chat = await this.invokeV0ChatCreate(systemPrompt, userPrompt, mode, attachments);
      } catch (e: any) {
        console.warn('WebsiteService - v0 request error:', this.formatV0NetworkError(e));
        if (this.isV0NonRetryableHttpError(e)) {
          throw e;
        }
        if (attempt < MAX_V0_ATTEMPTS) {
          console.log('WebsiteService - Retrying in', RETRY_DELAY_MS, 'ms...');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw e;
      }

      responseContent = this.serializeChatForHistory(chat);
      const refusalText = (chat.text || this.getLastAssistantContent(chat) || '').trim();
      console.log(
        'WebsiteService - v0 chat',
        chat.id,
        'version',
        chat.latestVersion?.status,
        'fileCount',
        chat.latestVersion?.files?.length ?? 0,
      );

      if (this.isRefusalResponse(refusalText)) {
        console.warn('WebsiteService - v0 refusal on attempt', attempt);
        if (attempt < MAX_V0_ATTEMPTS) {
          console.log('WebsiteService - Retrying in', RETRY_DELAY_MS, 'ms...');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        const msg =
          'The AI declined to generate this website after ' +
          MAX_V0_ATTEMPTS +
          ' attempts. Try rephrasing your prompt (e.g. avoid sensitive topics, use clearer wording, or break the request into smaller steps).';
        const err = new Error(msg) as Error & { status?: number };
        err.status = 422;
        throw err;
      }

      websiteCode = this.websiteCodeFromChatDetail(chat);
      if (websiteCode?.files && Array.isArray(websiteCode.files)) {
        websiteCode = this.convertV0FilesToStructure(websiteCode);
      }

      const hasNonEmptyLegacyHtml =
        typeof websiteCode?.html === 'string' && websiteCode.html.trim().length > 0;
      const hasValidCode =
        (websiteCode?.components?.length > 0) ||
        (websiteCode?.files?.length > 0) ||
        !!(websiteCode?.viteConfig?.mainJsx || websiteCode?.viteConfig?.mainJs) ||
        hasNonEmptyLegacyHtml ||
        (typeof websiteCode?.js === 'string' && websiteCode.js.trim().length > 0) ||
        (typeof websiteCode?.css === 'string' && websiteCode.css.trim().length > 0);
      if (hasValidCode) {
        console.log('WebsiteService - Valid code received on attempt', attempt);
        const extractedDemo = this.extractV0DemoFromChatDetail(chat);
        console.log('WebsiteService.fetchWebsiteCodeFromV0 - extracted demoUrl from chat:', {
          chatId: chat.id || null,
          demoUrl: extractedDemo || null,
        });
        return {
          responseContent,
          websiteCode,
          v0ChatId: chat.id,
          v0DemoUrl: extractedDemo,
        };
      }

      console.warn('WebsiteService - No valid code on attempt', attempt);
      if (attempt < MAX_V0_ATTEMPTS) {
        console.log('WebsiteService - Retrying in', RETRY_DELAY_MS, 'ms...');
        await delay(RETRY_DELAY_MS);
        continue;
      }
      const err = new Error(
        'The AI did not return valid website code after ' +
          MAX_V0_ATTEMPTS +
          ' attempts. Try rephrasing your prompt or simplifying the request.',
      ) as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    throw new Error('v0 generation failed after retries');
  }

  /** Continue an existing v0 chat with a short edit instruction (official v0-clone pattern). */
  private async fetchWebsiteCodeFromV0SendMessage(
    chatId: string,
    userMessage: string,
    attachments?: V0MessageAttachment[],
  ): Promise<{ responseContent: string; websiteCode: any; v0ChatId: string; v0DemoUrl?: string }> {
    const MAX_V0_ATTEMPTS = Number(process.env.V0_MAX_RETRIES) || 3;
    const RETRY_DELAY_MS = 1500;
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let responseContent = '{}';
    let websiteCode: any = null;

    for (let attempt = 1; attempt <= MAX_V0_ATTEMPTS; attempt++) {
      console.log('WebsiteService - v0 sendMessage attempt', attempt, 'of', MAX_V0_ATTEMPTS, 'chatId=', chatId);
      const syncOnRetry = process.env.V0_WEBSITE_RETRY_WITH_SYNC !== '0';
      const mode: 'sync' | 'async' = syncOnRetry && attempt > 1 ? 'sync' : 'async';
      if (attempt > 1 && mode === 'sync') {
        console.log(
          'WebsiteService - sendMessage attempt',
          attempt,
          'uses sync because async+poll can hit persistent chat_not_found',
        );
      }
      let priorArtifact:
        | {
            contentSig: string;
            versionId?: string;
            chatUpdatedAt?: string;
            latestVersionUpdatedAt?: string;
            assistantTail?: { id?: string; updatedAt?: string };
          }
        | undefined;
      try {
        const pre = await this.getV0ChatByIdRest(chatId);
        const asst = this.getLastAssistantTail(pre);
        priorArtifact = {
          contentSig: this.v0FilesContentSignature(pre),
          versionId: pre.latestVersion?.id,
          chatUpdatedAt: pre.updatedAt,
          latestVersionUpdatedAt: pre.latestVersion?.updatedAt,
          assistantTail: asst.id ? asst : undefined,
        };
      } catch (e: unknown) {
        console.warn(
          'WebsiteService - pre-sendMessage GET (artifact baseline) failed:',
          this.formatV0NetworkError(e),
        );
        priorArtifact = undefined;
      }
      let chat: ChatDetail;
      try {
        chat = await this.invokeV0ChatSendMessage(chatId, userMessage, mode, priorArtifact, attachments);
      } catch (e: any) {
        console.warn('WebsiteService - v0 sendMessage error:', this.formatV0NetworkError(e));
        if (this.isV0NonRetryableHttpError(e)) {
          throw e;
        }
        if (attempt < MAX_V0_ATTEMPTS) {
          console.log('WebsiteService - Retrying sendMessage in', RETRY_DELAY_MS, 'ms...');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw e;
      }

      responseContent = this.serializeChatForHistory(chat);
      const refusalText = (chat.text || this.getLastAssistantContent(chat) || '').trim();
      console.log(
        'WebsiteService - v0 sendMessage chat',
        chat.id,
        'version',
        chat.latestVersion?.status,
        'fileCount',
        chat.latestVersion?.files?.length ?? 0,
      );

      if (this.isRefusalResponse(refusalText)) {
        console.warn('WebsiteService - v0 refusal on sendMessage attempt', attempt);
        if (attempt < MAX_V0_ATTEMPTS) {
          console.log('WebsiteService - Retrying in', RETRY_DELAY_MS, 'ms...');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        const msg =
          'The AI declined to apply this edit after ' +
          MAX_V0_ATTEMPTS +
          ' attempts. Try rephrasing your request.';
        const err = new Error(msg) as Error & { status?: number };
        err.status = 422;
        throw err;
      }

      websiteCode = this.websiteCodeFromChatDetail(chat);
      if (websiteCode?.files && Array.isArray(websiteCode.files)) {
        websiteCode = this.convertV0FilesToStructure(websiteCode);
      }

      const hasNonEmptyLegacyHtml =
        typeof websiteCode?.html === 'string' && websiteCode.html.trim().length > 0;
      const hasValidCode =
        (websiteCode?.components?.length > 0) ||
        (websiteCode?.files?.length > 0) ||
        !!(websiteCode?.viteConfig?.mainJsx || websiteCode?.viteConfig?.mainJs) ||
        hasNonEmptyLegacyHtml ||
        (typeof websiteCode?.js === 'string' && websiteCode.js.trim().length > 0) ||
        (typeof websiteCode?.css === 'string' && websiteCode.css.trim().length > 0);
      if (hasValidCode) {
        console.log('WebsiteService - Valid code from sendMessage on attempt', attempt);
        const resolvedId = chat.id || chatId;
        const extractedDemo = this.extractV0DemoFromChatDetail(chat);
        console.log('WebsiteService.fetchWebsiteCodeFromV0SendMessage - extracted demoUrl from chat:', {
          chatId: resolvedId,
          demoUrl: extractedDemo || null,
        });
        return {
          responseContent,
          websiteCode,
          v0ChatId: resolvedId,
          v0DemoUrl: extractedDemo,
        };
      }

      console.warn('WebsiteService - No valid code on sendMessage attempt', attempt);
      if (attempt < MAX_V0_ATTEMPTS) {
        console.log('WebsiteService - Retrying in', RETRY_DELAY_MS, 'ms...');
        await delay(RETRY_DELAY_MS);
        continue;
      }
      const err = new Error(
        'The AI did not return valid website code for this edit after ' +
          MAX_V0_ATTEMPTS +
          ' attempts. Try rephrasing or simplifying the request.',
      ) as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    throw new Error('v0 sendMessage failed after retries');
  }

  /**
   * Converts v0 API "files" format into our "components" + "viteConfig" structure
   * so the rest of the pipeline works (e.g. app/page.tsx + components/emi-calculator.tsx → components array + mainJsx).
   */
  private convertV0FilesToStructure(websiteCode: { files: Array<{ path: string; content: string }> }): any {
    const files = websiteCode.files || [];
    const htmlFiles = files.filter((f: any) => /\.html?$/i.test(f.path));
    const plainCssFiles = files.filter((f: any) => /\.(css|scss)$/i.test(f.path));
    const plainJsFiles = files.filter((f: any) => /\.(m?js)$/i.test(f.path) && !/\.(jsx)$/i.test(f.path));
    const hasFrameworkFiles = files.some((f: any) => /\.(tsx|jsx)$/i.test(f.path) || /^app\//i.test(f.path));
    if (!hasFrameworkFiles && htmlFiles.length > 0) {
      const indexFile =
        htmlFiles.find((f: any) => /(^|\/)index\.html?$/i.test(f.path)) ||
        htmlFiles[0];
      console.log('WebsiteService.convertV0FilesToStructure - Converted static files to legacy HTML shape:', {
        htmlCount: htmlFiles.length,
        cssCount: plainCssFiles.length,
        jsCount: plainJsFiles.length,
      });
      return {
        html: indexFile?.content || '',
        css: plainCssFiles.map((f: any) => f.content || '').join('\n\n'),
        js: plainJsFiles.map((f: any) => f.content || '').join('\n\n'),
      };
    }
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
    const suffixes = [
      '"\n}\n]\n}',
      '"\n}\n}',
      '"\n]\n}',
      '"\n}',
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

    const parseCandidate = (candidate: string, label: string): any | null => {
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          console.log(`WebsiteService.parseV0Response - Parsed JSON (${label})`, {
            hasComponents: Array.isArray(parsed.components),
            componentCount: Array.isArray(parsed.components) ? parsed.components.length : 0,
          });
          return parsed;
        }
      } catch (e: any) {
        const isTruncation = /Unterminated string|Unexpected end of JSON input|position \d+/.test(e?.message || '');
        if (isTruncation) {
          console.warn(`WebsiteService.parseV0Response - JSON likely truncated (${label}), attempting repair:`, e?.message);
          const repaired = this.tryRepairTruncatedJson(trimmed);
          if (repaired) {
            try {
              const parsed = JSON.parse(repaired);
              if (parsed && typeof parsed === 'object') {
                console.log(`WebsiteService.parseV0Response - Parsed after truncation repair (${label})`, {
                  hasComponents: Array.isArray(parsed.components),
                  componentCount: Array.isArray(parsed.components) ? parsed.components.length : 0,
                });
                return parsed;
              }
            } catch (e2: any) {
              console.warn(`WebsiteService.parseV0Response - Repair parse failed (${label}):`, e2?.message);
            }
          }
        }
        return null;
      }
      return null;
    };

    // v0 follow-up edits may prepend prose before a fenced JSON artifact.
    const fencedJson = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
    if (fencedJson?.[1]) {
      const parsed = parseCandidate(fencedJson[1], 'fenced-block');
      if (parsed) return parsed;
    }

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

    const genericLegacyJsonMatch = response.match(/\{[\s\S]*"(?:html|HTML|css|CSS|js|JS|javascript)"[\s\S]*\}/);
    if (genericLegacyJsonMatch) {
      try {
        const parsed = JSON.parse(genericLegacyJsonMatch[0]);
        const hasStaticCode =
          typeof parsed?.html === 'string' ||
          typeof parsed?.HTML === 'string' ||
          typeof parsed?.css === 'string' ||
          typeof parsed?.CSS === 'string' ||
          typeof parsed?.js === 'string' ||
          typeof parsed?.JS === 'string' ||
          typeof parsed?.javascript === 'string';
        if (hasStaticCode) {
          console.log('WebsiteService.extractCodeFromResponse - Found generic static JSON object in response');
          return parsed;
        }
      } catch (e: any) {
        console.warn('WebsiteService.extractCodeFromResponse - Generic static JSON match found but parse failed:', e?.message);
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
      html: htmlMatch ? htmlMatch[1].trim() : '',
      css: cssMatch ? cssMatch[1].trim() : '',
      js: jsMatch ? jsMatch[1].trim() : '',
    };
    
    console.log('WebsiteService.extractCodeFromResponse - Extracted (fence/markdown scrape):', {
      hasHtml: result.html.length > 0,
      hasCss: result.css.length > 0,
      hasJs: result.js.length > 0,
    });
    
    return result;
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

  async rebuildReactPreview(websiteId: string, userId: string) {
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
    }

    const inferredFramework =
      website.framework === 'react' || website.framework === 'next' || website.framework === 'html'
        ? website.framework
        : ((website.components?.length ?? 0) > 0 || !!(website.viteConfig?.mainJsx || website.viteConfig?.mainJs))
            ? 'react'
            : 'html';
    website.framework = inferredFramework;
    if (inferredFramework !== 'react' && inferredFramework !== 'html') {
      const err = new Error('Preview rebuild is only supported for React and HTML websites.') as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    website.reactBuildStatus = 'queued';
    website.reactBuildLog = undefined;
    website.reactArtifactUrl = undefined;
    website.reactBuildId = undefined;
    website.reactBuildStartedAt = undefined;
    website.reactBuildFinishedAt = undefined;
    const saved = await this.websiteRepository.save(website);
    console.log('WebsiteService.rebuildReactPreview - rebuilding preview:', {
      websiteId: saved.id.toString(),
      framework: saved.framework,
    });
    if (saved.framework === 'react') {
      void this.reactPreviewBuildService.enqueue(saved.id.toString());
    } else {
      await this.reactPreviewBuildService.publishStaticPreview(saved.id.toString());
    }
    const latest = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    return {
      id: (latest || saved).id.toString(),
      websiteId: (latest || saved).id.toString(),
      reactBuildStatus: (latest || saved).reactBuildStatus,
      reactArtifactUrl: (latest || saved).reactArtifactUrl,
      message: saved.framework === 'react' ? 'React preview rebuild queued' : 'Static preview rebuilt',
    };
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

