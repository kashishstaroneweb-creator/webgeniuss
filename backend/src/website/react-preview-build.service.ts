import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Website } from '../entities/website.entity';

type BuildStatus = 'queued' | 'building' | 'ready' | 'failed';

@Injectable()
export class ReactPreviewBuildService {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private isDraining = false;

  constructor(
    @InjectRepository(Website)
    private readonly websiteRepository: Repository<Website>,
  ) {}

  async enqueue(websiteId: string): Promise<void> {
    const site = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    if (!site) return;
    if (site.framework !== 'react') return;
    console.log('ReactPreviewBuildService.enqueue - request received:', {
      websiteId,
      framework: site.framework,
      currentStatus: site.reactBuildStatus || null,
    });

    await this.mark(site, 'queued', {
      reactBuildLog: undefined,
      reactArtifactUrl: undefined,
      reactBuildId: undefined,
      reactBuildStartedAt: undefined,
      reactBuildFinishedAt: undefined,
    });

    if (!this.queued.has(websiteId)) {
      this.queued.add(websiteId);
      this.queue.push(websiteId);
      console.log('ReactPreviewBuildService.enqueue - queued:', {
        websiteId,
        queueLength: this.queue.length,
      });
    }
    if (!this.isDraining) {
      this.isDraining = true;
      console.log('ReactPreviewBuildService.enqueue - starting drain loop');
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const websiteId = this.queue.shift()!;
      this.queued.delete(websiteId);
      console.log('ReactPreviewBuildService.drain - dequeued:', {
        websiteId,
        remaining: this.queue.length,
      });
      try {
        await this.processOne(websiteId);
      } catch (error: any) {
        console.error('ReactPreviewBuildService.drain - processOne failed:', websiteId, error?.message || error);
      }
    }
    console.log('ReactPreviewBuildService.drain - queue empty, stopping loop');
    this.isDraining = false;
  }

  private async processOne(websiteId: string): Promise<void> {
    const site = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    if (!site || site.framework !== 'react') return;

    const buildId = Date.now().toString(36);
    const workspaceRoot = path.resolve(process.env.REACT_PREVIEW_WORKSPACE_ROOT || path.join(process.cwd(), '.preview-builds'));
    const artifactsRoot = path.resolve(process.env.REACT_PREVIEW_ARTIFACT_ROOT || path.join(process.cwd(), '.preview-artifacts'));
    const workspaceDir = path.join(workspaceRoot, websiteId, buildId);
    const artifactDir = path.join(artifactsRoot, websiteId, buildId);
    console.log('ReactPreviewBuildService.processOne - starting build:', {
      websiteId,
      buildId,
      workspaceDir,
      artifactDir,
    });

    await this.mark(site, 'building', {
      reactBuildId: buildId,
      reactBuildLog: undefined,
      reactArtifactUrl: undefined,
      reactBuildStartedAt: new Date(),
      reactBuildFinishedAt: undefined,
    });

    let logs = '';
    try {
      await fs.promises.mkdir(workspaceDir, { recursive: true });
      await this.writeReactProjectFiles(workspaceDir, site);
      console.log('ReactPreviewBuildService.processOne - project files written:', {
        websiteId,
        buildId,
        componentCount: site.components?.length || 0,
      });

      logs += await this.runCommand('npm', ['install', '--no-audit', '--no-fund'], workspaceDir, 240_000);
      logs += await this.runCommand('npm', ['run', 'build'], workspaceDir, 240_000);

      const distDir = path.join(workspaceDir, 'dist');
      const distExists = fs.existsSync(path.join(distDir, 'index.html'));
      if (!distExists) {
        throw new Error('Build completed but dist/index.html was not found.');
      }

      await fs.promises.rm(artifactDir, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(artifactDir), { recursive: true });
      await fs.promises.cp(distDir, artifactDir, { recursive: true, force: true });

      const publicBase = (process.env.BACKEND_PUBLIC_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const artifactUrl = `${publicBase}/preview-artifacts/${websiteId}/${buildId}/`;
      console.log('ReactPreviewBuildService.processOne - build success:', {
        websiteId,
        buildId,
        artifactUrl,
      });

      await this.mark(site, 'ready', {
        reactBuildId: buildId,
        reactArtifactUrl: artifactUrl,
        reactBuildLog: logs.slice(-120_000),
        reactBuildFinishedAt: new Date(),
      });
    } catch (error: any) {
      console.error('ReactPreviewBuildService.processOne - build failed:', {
        websiteId,
        buildId,
        message: error?.message || String(error),
      });
      const errorLog =
        logs +
        '\n\n[build-error]\n' +
        (error?.stack || error?.message || String(error));
      await this.mark(site, 'failed', {
        reactBuildId: buildId,
        reactBuildLog: errorLog.slice(-120_000),
        reactBuildFinishedAt: new Date(),
      });
    } finally {
      await fs.promises.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
      console.log('ReactPreviewBuildService.processOne - workspace cleaned:', {
        websiteId,
        buildId,
      });
    }
  }

  private async mark(site: Website, status: BuildStatus, updates: Partial<Website>): Promise<void> {
    const latest = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(site.id.toString()) } as any,
    });
    if (!latest) return;
    latest.reactBuildStatus = status;
    Object.assign(latest, updates);
    await this.websiteRepository.save(latest);
    console.log('ReactPreviewBuildService.mark - status updated:', {
      websiteId: latest.id?.toString?.() || site.id?.toString?.(),
      status,
      buildId: latest.reactBuildId || null,
      artifactUrl: latest.reactArtifactUrl || null,
    });
  }

  private async writeReactProjectFiles(workspaceDir: string, site: Website): Promise<void> {
    const vite: {
      packageJson?: string;
      viteConfig?: string;
      indexHtml?: string;
      mainJs?: string;
      mainJsx?: string;
      styleCss?: string;
    } = site.viteConfig || {};
    const pkgRaw = vite.packageJson && vite.packageJson.trim().length > 0
      ? vite.packageJson
      : JSON.stringify({
          name: 'generated-react-site',
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build' },
          dependencies: {
            react: '^18.2.0',
            'react-dom': '^18.2.0',
            'react-router-dom': '^6.20.0',
          },
          devDependencies: {
            vite: '^5.4.0',
            '@vitejs/plugin-react': '^4.3.0',
          },
        }, null, 2);

    const packageJson = this.normalizePackageJson(pkgRaw);
    const viteConfig = this.normalizeViteConfig(vite.viteConfig);
    const indexHtml = vite.indexHtml || this.defaultIndexHtml(site.websiteName || 'React Preview');
    const mainJsxRaw = vite.mainJsx || vite.mainJs || this.defaultMainJsx(site.components || []);
    const mainJsx = this.injectPreviewRouterBasename(mainJsxRaw);
    const styleCss = vite.styleCss || '';

    await this.writeFileSafe(workspaceDir, 'package.json', packageJson);
    await this.writeFileSafe(workspaceDir, 'vite.config.js', viteConfig);
    await this.writeFileSafe(workspaceDir, 'index.html', indexHtml);
    await this.writeFileSafe(workspaceDir, 'src/main.jsx', mainJsx);
    await this.writeFileSafe(workspaceDir, 'src/style.css', styleCss);

    for (const c of site.components || []) {
      const relPath = this.sanitizeRelativePath(c.path || `src/components/${c.name || 'Component'}.jsx`);
      if (!relPath) continue;
      await this.writeFileSafe(workspaceDir, relPath, c.code || '');
    }
  }

  private sanitizeRelativePath(input: string): string | null {
    const rel = input.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) return null;
    return rel;
  }

  private async writeFileSafe(root: string, relPath: string, content: string): Promise<void> {
    const safeRel = this.sanitizeRelativePath(relPath);
    if (!safeRel) throw new Error(`Unsafe path refused: ${relPath}`);
    const abs = path.join(root, safeRel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const startedAt = Date.now();
      const isWin = process.platform === 'win32';
      const pretty = `${command} ${args.join(' ')}`;
      const comspec = process.env.ComSpec || 'cmd.exe';
      const bin = isWin ? comspec : command;
      const finalArgs = isWin ? ['/d', '/s', '/c', pretty] : args;
      console.log('ReactPreviewBuildService.runCommand - start:', {
        command: pretty,
        platform: process.platform,
        bin,
        finalArgs,
        cwd,
        timeoutMs,
      });
      const cp = spawn(bin, finalArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const timer = setTimeout(() => {
        cp.kill();
        reject(new Error(`Command timed out: ${pretty}`));
      }, timeoutMs);
      cp.stdout.on('data', (d) => {
        out += d.toString();
      });
      cp.stderr.on('data', (d) => {
        out += d.toString();
      });
      cp.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      cp.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          console.log('ReactPreviewBuildService.runCommand - success:', {
            command: pretty,
            durationMs: Date.now() - startedAt,
          });
          resolve(out);
        } else {
          console.error('ReactPreviewBuildService.runCommand - failed:', {
            command: pretty,
            code,
            durationMs: Date.now() - startedAt,
          });
          reject(new Error(`Command failed (${code}): ${pretty}\n${out}`));
        }
      });
    });
  }

  private normalizePackageJson(raw: string): string {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.type) parsed.type = 'module';
      if (!parsed.scripts) parsed.scripts = {};
      if (!parsed.scripts.build) parsed.scripts.build = 'vite build';
      if (!parsed.scripts.dev) parsed.scripts.dev = 'vite';
      if (!parsed.dependencies) parsed.dependencies = {};
      if (!parsed.dependencies.react) parsed.dependencies.react = '^18.2.0';
      if (!parsed.dependencies['react-dom']) parsed.dependencies['react-dom'] = '^18.2.0';
      if (!parsed.dependencies['react-router-dom']) parsed.dependencies['react-router-dom'] = '^6.20.0';
      if (!parsed.devDependencies) parsed.devDependencies = {};
      if (!parsed.devDependencies.vite) parsed.devDependencies.vite = '^5.4.0';
      if (!parsed.devDependencies['@vitejs/plugin-react']) parsed.devDependencies['@vitejs/plugin-react'] = '^4.3.0';
      return JSON.stringify(parsed, null, 2);
    } catch {
      return JSON.stringify({
        name: 'generated-react-site',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
          'react-router-dom': '^6.20.0',
        },
        devDependencies: {
          vite: '^5.4.0',
          '@vitejs/plugin-react': '^4.3.0',
        },
      }, null, 2);
    }
  }

  private defaultViteConfig(): string {
    return [
      "import { defineConfig } from 'vite';",
      "import react from '@vitejs/plugin-react';",
      '',
      'export default defineConfig({',
      "  base: './',",
      '  plugins: [react()],',
      '});',
      '',
    ].join('\n');
  }

  private normalizeViteConfig(raw?: string): string {
    if (!raw || !raw.trim()) return this.defaultViteConfig();
    let s = raw;
    // Ensure preview artifacts work from nested path: /preview-artifacts/<id>/<buildId>/index.html
    // by forcing relative asset URLs in build output.
    if (/\bbase\s*:\s*['"`]\.\/['"`]/.test(s) || /\bbase\s*:\s*['"`]\.\/?['"`]/.test(s)) {
      return s;
    }
    if (s.includes('defineConfig({')) {
      s = s.replace('defineConfig({', "defineConfig({\n  base: './',");
      return s;
    }
    if (s.includes('defineConfig(() => ({')) {
      s = s.replace('defineConfig(() => ({', "defineConfig(() => ({\n  base: './',");
      return s;
    }
    // Fallback to safe default for preview consistency if model returned exotic config shape.
    console.warn('ReactPreviewBuildService.normalizeViteConfig - unsupported vite config shape, using safe default with base ./');
    return this.defaultViteConfig();
  }

  private defaultIndexHtml(title: string): string {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `    <title>${title}</title>`,
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.jsx"></script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n');
  }

  private defaultMainJsx(components: Array<{ name: string; path: string }>): string {
    const page = components.find((c) => /\/pages\//.test(c.path)) || components[0];
    if (!page) {
      return [
        "import React from 'react';",
        "import ReactDOM from 'react-dom/client';",
        "import './style.css';",
        '',
        'function App() {',
        "  return <div style={{padding: 24}}>No components found</div>;",
        '}',
        '',
        "ReactDOM.createRoot(document.getElementById('root')).render(<App />);",
        '',
      ].join('\n');
    }
    const importPath = page.path
      .replace(/^src\//, './')
      .replace(/\.tsx$/i, '.jsx')
      .replace(/\.ts$/i, '.js');
    return [
      "import React from 'react';",
      "import ReactDOM from 'react-dom/client';",
      "import './style.css';",
      `import App from '${importPath}';`,
      '',
      "ReactDOM.createRoot(document.getElementById('root')).render(<App />);",
      '',
    ].join('\n');
  }

  private injectPreviewRouterBasename(code: string): string {
    if (!code || typeof code !== 'string') return code;
    if (!/BrowserRouter/.test(code)) return code;
    if (/basename\s*=/.test(code)) return code;
    if (!/<BrowserRouter\b/.test(code)) return code;

    const helper = [
      'const __previewBasename = (function () {',
      "  var p = (typeof window !== 'undefined' && window.location && window.location.pathname) || '/';",
      "  var marker = '/preview-artifacts/';",
      '  var idx = p.indexOf(marker);',
      "  if (idx === -1) return '/';",
      '  var after = p.slice(idx + marker.length);',
      "  var parts = after.split('/').filter(Boolean);",
      "  if (parts.length < 2) return '/';",
      "  return marker + parts[0] + '/' + parts[1];",
      '})();',
      '',
    ].join('\n');

    let out = code;
    if (!out.includes('__previewBasename')) {
      // Put helper before App function when possible; otherwise prepend.
      const appFnIdx = out.search(/\bfunction\s+App\s*\(/);
      if (appFnIdx >= 0) out = out.slice(0, appFnIdx) + helper + out.slice(appFnIdx);
      else out = helper + out;
    }
    out = out.replace(/<BrowserRouter(\s*)>/, '<BrowserRouter basename={__previewBasename}$1>');
    console.log('ReactPreviewBuildService.injectPreviewRouterBasename - injected basename helper');
    return out;
  }
}
