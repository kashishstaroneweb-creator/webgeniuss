import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { transformSync } from 'esbuild';
import { Website } from '../entities/website.entity';

type BuildStatus = 'queued' | 'building' | 'ready' | 'failed';
type PreviewStorageMode = 'local' | 'r2';

const DEVICE_PREVIEW_SCROLL_CSS = `

/* WebGenius device preview: keep natural scrolling but hide browser scrollbars. */
html,
body {
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
}

html::-webkit-scrollbar,
body::-webkit-scrollbar,
*::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
`;

@Injectable()
export class ReactPreviewBuildService {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private isDraining = false;

  private getStorageMode(): PreviewStorageMode {
    const raw = (process.env.REACT_PREVIEW_STORAGE_MODE || 'local').trim().toLowerCase();
    return raw === 'r2' ? 'r2' : 'local';
  }

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

  async publishStaticPreview(websiteId: string): Promise<Website | null> {
    const site = await this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
    if (!site) return null;
    if (site.framework !== 'html') return site;

    const buildId = Date.now().toString(36);
    const workspaceRoot = path.resolve(process.env.REACT_PREVIEW_WORKSPACE_ROOT || path.join(process.cwd(), '.preview-builds'));
    const artifactsRoot = path.resolve(process.env.REACT_PREVIEW_ARTIFACT_ROOT || path.join(process.cwd(), '.preview-artifacts'));
    const workspaceDir = path.join(workspaceRoot, websiteId, buildId);
    const distDir = path.join(workspaceDir, 'dist');
    const artifactDir = path.join(artifactsRoot, websiteId, buildId);

    await this.mark(site, 'building', {
      reactBuildId: buildId,
      reactBuildLog: undefined,
      reactArtifactUrl: undefined,
      reactBuildStartedAt: new Date(),
      reactBuildFinishedAt: undefined,
    });

    try {
      await fs.promises.mkdir(distDir, { recursive: true });
      await this.writeStaticProjectFiles(distDir, site);
      const storageMode = this.getStorageMode();
      const artifactUrl =
        storageMode === 'r2'
          ? await this.publishDistToR2(distDir, websiteId, buildId)
          : await this.publishDistToLocal(distDir, artifactDir, websiteId, buildId);

      const latest = await this.websiteRepository.findOne({
        where: { _id: new ObjectId(websiteId) } as any,
      });
      if (!latest) return null;
      await this.mark(latest, 'ready', {
        reactBuildId: buildId,
        reactArtifactUrl: artifactUrl,
        reactBuildLog: 'Static HTML preview published without npm install or build.',
        reactBuildFinishedAt: new Date(),
      });
    } catch (error: any) {
      const latest = await this.websiteRepository.findOne({
        where: { _id: new ObjectId(websiteId) } as any,
      });
      if (latest) {
        await this.mark(latest, 'failed', {
          reactBuildId: buildId,
          reactBuildLog: (error?.stack || error?.message || String(error)).slice(-120_000),
          reactBuildFinishedAt: new Date(),
        });
      }
    } finally {
      await fs.promises.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return this.websiteRepository.findOne({
      where: { _id: new ObjectId(websiteId) } as any,
    });
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

      // Render runs with NODE_ENV=production, which otherwise omits Vite and other devDependencies.
      logs += await this.runCommand(
        'npm',
        ['install', '--include=dev', '--no-audit', '--no-fund'],
        workspaceDir,
        240_000,
      );
      logs += await this.runCommand('npm', ['run', 'build'], workspaceDir, 240_000);

      const distDir = path.join(workspaceDir, 'dist');
      const distExists = fs.existsSync(path.join(distDir, 'index.html'));
      if (!distExists) {
        throw new Error('Build completed but dist/index.html was not found.');
      }

      const storageMode = this.getStorageMode();
      const artifactUrl =
        storageMode === 'r2'
          ? await this.publishDistToR2(distDir, websiteId, buildId)
          : await this.publishDistToLocal(distDir, artifactDir, websiteId, buildId);
      console.log('ReactPreviewBuildService.processOne - build success:', {
        websiteId,
        buildId,
        storageMode,
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
    const indexHtml = this.injectFullStackRuntimeConfig(
      vite.indexHtml || this.defaultIndexHtml(site.websiteName || 'React Preview'),
      site,
    );
    const mainJsxRaw = vite.mainJsx || vite.mainJs || this.defaultMainJsx(site.components || []);
    const mainJsxWithImports = this.ensureEntryImports(mainJsxRaw, site.components || []);
    const mainJsx = this.stripTypeScriptSyntaxForPreview(
      this.rewriteRelativeApiCalls(
        this.injectPreviewMessagingBridge(this.injectPreviewRouterBasename(mainJsxWithImports)),
        site,
      ),
      'src/main.jsx',
    );
    const styleCss = this.withDevicePreviewScrollCss(vite.styleCss || '');

    await this.writeFileSafe(workspaceDir, 'package.json', packageJson);
    await this.writeFileSafe(workspaceDir, 'vite.config.js', viteConfig);
    await this.writeFileSafe(workspaceDir, 'index.html', indexHtml);
    await this.writeFileSafe(workspaceDir, 'src/main.jsx', mainJsx);
    await this.writeFileSafe(workspaceDir, 'src/style.css', styleCss);

    for (const c of site.components || []) {
      const relPath = this.sanitizeRelativePath(c.path || `src/components/${c.name || 'Component'}.jsx`);
      if (!relPath) continue;
      await this.writeFileSafe(
        workspaceDir,
        relPath,
        this.stripTypeScriptSyntaxForPreview(this.rewriteRelativeApiCalls(c.code || '', site), relPath),
      );
    }
  }

  private fullStackApiBase(site: Website): string | null {
    if (!site.backendFiles?.length) return null;
    const backendBase = (
      process.env.BACKEND_PUBLIC_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const runtimePath = site.backendPreviewUrl?.startsWith('/fullstack/runtime/')
      ? site.backendPreviewUrl
      : `/fullstack/runtime/${site.id.toString()}`;
    return `${backendBase}${runtimePath}`;
  }

  private injectFullStackRuntimeConfig(html: string, site: Website): string {
    const apiBase = this.fullStackApiBase(site);
    if (!apiBase) return html;
    const script = `<script>globalThis.__WEBGENIUS_API_BASE__=${JSON.stringify(apiBase)};</script>`;
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `  ${script}\n</head>`);
    return `${script}\n${html}`;
  }

  private rewriteRelativeApiCalls(code: string, site: Website): string {
    if (!this.fullStackApiBase(site) || !code) return code;
    return code.replace(
      /\bfetch\s*\(\s*(['"`])\/api/g,
      (_match, quote: string) => `fetch((globalThis.__WEBGENIUS_API_BASE__ || '') + ${quote}/api`,
    );
  }

  private async writeStaticProjectFiles(distDir: string, site: Website): Promise<void> {
    const css = this.withDevicePreviewScrollCss(site.cssCode || '');
    const js = this.injectPreviewMessagingBridge(site.jsCode || '');
    const html = this.prepareStaticIndexHtml(site.htmlCode || '', css, js, site.websiteName || 'Static Preview');

    await this.writeFileSafe(distDir, 'index.html', html);
    await this.writeFileSafe(distDir, 'styles.css', css);
    await this.writeFileSafe(distDir, 'script.js', js);
  }

  private prepareStaticIndexHtml(rawHtml: string, css: string, js: string, title: string): string {
    const trimmed = (rawHtml || '').trim();
    let html =
      /<html[\s>]/i.test(trimmed) || /<!doctype/i.test(trimmed)
        ? trimmed
        : [
            '<!doctype html>',
            '<html lang="en">',
            '  <head>',
            '    <meta charset="UTF-8" />',
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
            `    <title>${this.escapeHtml(title)}</title>`,
            '  </head>',
            '  <body>',
            trimmed || '<main></main>',
            '  </body>',
            '</html>',
            '',
          ].join('\n');

    if (!/<head[\s>]/i.test(html)) {
      html = html.replace(/<html([^>]*)>/i, '<html$1><head></head>');
    }
    if (!/<body[\s>]/i.test(html)) {
      html = html.replace(/<\/head>/i, '</head><body>').replace(/<\/html>/i, '</body></html>');
    }
    if (css.trim() && !/href=["']\.?\/?styles\.css["']/i.test(html)) {
      html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="./styles.css" />\n</head>');
    }
    if (js.trim() && !/src=["']\.?\/?script\.js["']/i.test(html)) {
      html = html.replace(/<\/body>/i, '  <script src="./script.js"></script>\n</body>');
    }
    return this.injectDevicePreviewScrollStyle(html);
  }

  private withDevicePreviewScrollCss(css: string): string {
    if ((css || '').includes('WebGenius device preview')) return css || '';
    return `${css || ''}${DEVICE_PREVIEW_SCROLL_CSS}`;
  }

  private injectDevicePreviewScrollStyle(html: string): string {
    if (!html || html.includes('WebGenius device preview')) return html;
    const styleTag = `<style>${DEVICE_PREVIEW_SCROLL_CSS}</style>`;
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `  ${styleTag}\n</head>`);
    }
    return `${styleTag}\n${html}`;
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async publishDistToLocal(
    distDir: string,
    artifactDir: string,
    websiteId: string,
    buildId: string,
  ): Promise<string> {
    await fs.promises.rm(artifactDir, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(artifactDir), { recursive: true });
    await fs.promises.cp(distDir, artifactDir, { recursive: true, force: true });
    const publicBase = (
      process.env.BACKEND_PUBLIC_BASE_URL ||
      process.env.VITE_API_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const url = `${publicBase}/preview-artifacts/${websiteId}/${buildId}/`;
    console.log('ReactPreviewBuildService.publishDistToLocal - published:', { websiteId, buildId, url });
    return url;
  }

  private async publishDistToR2(distDir: string, websiteId: string, buildId: string): Promise<string> {
    const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
    const bucket = (process.env.R2_BUCKET || '').trim();
    const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    const publicBaseRaw = (process.env.R2_PUBLIC_BASE_URL || '').trim();

    if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicBaseRaw) {
      throw new Error(
        'R2 mode enabled but env is incomplete. Required: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL',
      );
    }

    const files = await this.listFilesRecursive(distDir);
    const prefix = `${websiteId}/${buildId}`;
    for (const abs of files) {
      const rel = path.relative(distDir, abs).replace(/\\/g, '/');
      const key = `${prefix}/${rel}`;
      const body = await fs.promises.readFile(abs);
      const contentType = this.getContentTypeByPath(rel);
      await this.putObjectToR2({
        accountId,
        bucket,
        accessKeyId,
        secretAccessKey,
        key,
        body,
        contentType,
      });
    }

    const publicBase = publicBaseRaw.replace(/\/+$/, '');
    const url = `${publicBase}/${prefix}/index.html`;
    console.log('ReactPreviewBuildService.publishDistToR2 - published:', {
      websiteId,
      buildId,
      fileCount: files.length,
      url,
    });
    return url;
  }

  private async listFilesRecursive(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      const items = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walk(abs);
        } else if (item.isFile()) {
          out.push(abs);
        }
      }
    };
    await walk(root);
    return out;
  }

  private getContentTypeByPath(filePath: string): string {
    const p = filePath.toLowerCase();
    if (p.endsWith('.html')) return 'text/html; charset=utf-8';
    if (p.endsWith('.css')) return 'text/css; charset=utf-8';
    if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (p.endsWith('.json')) return 'application/json; charset=utf-8';
    if (p.endsWith('.svg')) return 'image/svg+xml';
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
    if (p.endsWith('.webp')) return 'image/webp';
    if (p.endsWith('.ico')) return 'image/x-icon';
    if (p.endsWith('.map')) return 'application/json; charset=utf-8';
    return 'application/octet-stream';
  }

  private sha256Hex(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
  }

  private encodeRfc3986PathSegment(seg: string): string {
    return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  private buildCanonicalUri(bucket: string, key: string): string {
    const parts = [bucket, ...key.split('/').filter(Boolean)];
    return '/' + parts.map((s) => this.encodeRfc3986PathSegment(s)).join('/');
  }

  private async putObjectToR2(args: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const { accountId, bucket, accessKeyId, secretAccessKey, key, body, contentType } = args;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const method = 'PUT';
    const service = 's3';
    const region = 'auto';
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    const dateStamp = `${y}${m}${d}`;
    const amzDate = `${dateStamp}T${hh}${mm}${ss}Z`;
    const canonicalUri = this.buildCanonicalUri(bucket, key);
    const payloadHash = this.sha256Hex(body);
    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest =
      `${method}\n` +
      `${canonicalUri}\n` +
      `\n` +
      `${canonicalHeaders}\n` +
      `${signedHeaders}\n` +
      `${payloadHash}`;
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n` +
      `${amzDate}\n` +
      `${credentialScope}\n` +
      `${this.sha256Hex(canonicalRequest)}`;
    const kDate = this.hmac(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, region);
    const kService = this.hmac(kRegion, service);
    const kSigning = this.hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          protocol: 'https:',
          hostname: host,
          method,
          path: canonicalUri,
          headers: {
            Host: host,
            'Content-Type': contentType,
            'Content-Length': body.length,
            'x-amz-date': amzDate,
            'x-amz-content-sha256': payloadHash,
            Authorization: authorization,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const status = res.statusCode || 0;
            if (status >= 200 && status < 300) {
              resolve();
              return;
            }
            reject(
              new Error(
                `R2 PUT failed (${status}) for key ${key}: ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`,
              ),
            );
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
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

  private stripTypeScriptSyntaxForPreview(code: string, relPath: string): string {
    if (!code || typeof code !== 'string') return code;
    if (!/\.[cm]?[jt]sx?$/i.test(relPath)) return code;

    const loader = /\.(?:[cm]?jsx|tsx)$/i.test(relPath) ? 'tsx' : 'ts';
    try {
      return transformSync(code, {
        loader,
        jsx: 'preserve',
        format: 'esm',
        target: 'es2020',
        sourcemap: false,
      }).code.trimEnd() + '\n';
    } catch (error: any) {
      console.warn('ReactPreviewBuildService.stripTypeScriptSyntaxForPreview - transform skipped:', {
        relPath,
        message: error?.message || String(error),
      });
      return this.stripCommonTypeScriptSyntaxForPreview(code);
    }
  }

  private stripCommonTypeScriptSyntaxForPreview(code: string): string {
    return code
      .replace(/\(([^()\n;]+?)\s+as\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:<[^>]+>)?(?:\[\])?\)/g, '($1)')
      .replace(/\(([^()\n;]+?)\s+as\s+keyof\s+typeof\s+[A-Za-z_$][\w$]*\)/g, '($1)')
      .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\]|\([^)]*\))*)!\b/g, '$1');
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
    if (/\bbase\s*:\s*['"`][^'"`]*['"`]\s*,?/.test(s)) {
      return s.replace(/\bbase\s*:\s*['"`][^'"`]*['"`]\s*,?/, "base: './',");
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

  private ensureEntryImports(
    code: string,
    components: Array<{ name?: string; path?: string }>,
  ): string {
    if (!code || typeof code !== 'string') return code;
    const imports: string[] = [];

    if (/\bReactDOM\b/.test(code) && !/from\s+['"]react-dom\/client['"]/.test(code)) {
      imports.push("import ReactDOM from 'react-dom/client';");
    }

    if (/\bReact\b/.test(code) && !/from\s+['"]react['"]/.test(code)) {
      imports.push("import React from 'react';");
    }

    const alreadyImported = new Set<string>();
    const defaultImportRegex = /import\s+([\w$]+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"][^'"]+['"]/g;
    const namedImportRegex = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;
    let match: RegExpExecArray | null;
    while ((match = defaultImportRegex.exec(code)) !== null) {
      alreadyImported.add(match[1]);
    }
    while ((match = namedImportRegex.exec(code)) !== null) {
      match[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (name) alreadyImported.add(name);
      });
    }

    for (const c of components) {
      const name = (c.name || '').replace(/\s+/g, '');
      const relPath = c.path ? this.sanitizeRelativePath(c.path) : null;
      if (!name || !relPath) continue;
      if (alreadyImported.has(name)) continue;
      if (!new RegExp(`<${name}(\\s|>|/)`).test(code)) continue;
      if (new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}\\b`).test(code)) continue;

      const importPath = relPath
        .replace(/^src\//, './')
        .replace(/\.tsx$/i, '.jsx')
        .replace(/\.ts$/i, '.js');
      imports.push(`import ${name} from '${importPath}';`);
      alreadyImported.add(name);
    }

    if (imports.length === 0) return code;
    console.log('ReactPreviewBuildService.ensureEntryImports - added missing imports:', imports);
    return `${imports.join('\n')}\n${code}`;
  }

  private injectPreviewRouterBasename(code: string): string {
    if (!code || typeof code !== 'string') return code;
    if (!/BrowserRouter/.test(code)) return code;
    if (/basename\s*=/.test(code)) return code;
    if (!/<BrowserRouter\b/.test(code)) return code;

    const helper = [
      '(function () {',
      "  if (typeof window === 'undefined' || !window.location || !window.history) return;",
      "  var p = window.location.pathname || '/';",
      "  if (!p.endsWith('/index.html')) return;",
      "  var nextPath = p.slice(0, -'/index.html'.length) + '/';",
      "  var nextUrl = nextPath + (window.location.search || '') + (window.location.hash || '');",
      '  try { window.history.replaceState({}, \'\', nextUrl); } catch (_e) {}',
      '})();',
      '',
      'const __previewBasename = (function () {',
      "  var p = (typeof window !== 'undefined' && window.location && window.location.pathname) || '/';",
      "  if (!p || p === '/') return '/';",
      "  var marker = '/preview-artifacts/';",
      '  var idx = p.indexOf(marker);',
      '  if (idx !== -1) {',
      '    var after = p.slice(idx + marker.length);',
      "    var parts = after.split('/').filter(Boolean);",
      "    if (parts.length >= 2) return marker + parts[0] + '/' + parts[1];",
      '  }',
      "  if (p.endsWith('/index.html')) {",
      "    var b = p.slice(0, -'/index.html'.length);",
      "    return b || '/';",
      '  }',
      "  if (p.endsWith('/')) {",
      "    return p.length > 1 ? p.slice(0, -1) : '/';",
      '  }',
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

  private injectPreviewMessagingBridge(code: string): string {
    if (!code || typeof code !== 'string') return code;
    if (code.includes('__WEBGENIUS_PREVIEW_BRIDGE__')) return code;
    const snippet = `

/* __WEBGENIUS_PREVIEW_BRIDGE__ */
if (typeof window !== 'undefined') {
  (function () {
    function computeBase() {
      var p = (window.location && window.location.pathname) || '/';
      if (!p || p === '/') return '/';
      var marker = '/preview-artifacts/';
      var idx = p.indexOf(marker);
      if (idx !== -1) {
        var after = p.slice(idx + marker.length);
        var parts = after.split('/').filter(Boolean);
        if (parts.length >= 2) return marker + parts[0] + '/' + parts[1];
      }
      if (p.endsWith('/index.html')) {
        var b = p.slice(0, -'/index.html'.length);
        return b || '/';
      }
      if (p.endsWith('/')) {
        return p.length > 1 ? p.slice(0, -1) : '/';
      }
      return '/';
    }
    function normalizePath(input) {
      var s = typeof input === 'string' ? input.trim() : '/';
      if (!s) s = '/';
      if (!s.startsWith('/')) s = '/' + s;
      return s;
    }
    function currentRoutePath() {
      var base = computeBase();
      var p = (window.location && window.location.pathname) || '/';
      if (base !== '/' && p.startsWith(base)) {
        var rest = p.slice(base.length);
        return rest || '/';
      }
      return p || '/';
    }
    function publishRoute() {
      try {
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: 'PREVIEW_ROUTE_CHANGE', path: currentRoutePath() }, '*');
        }
      } catch (err) {}
    }
    function selectableElement(node) {
      if (!node || !node.closest) return null;
      var el = node;
      // SVG paths are implementation details; select their meaningful SVG/control wrapper.
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
        el = el.closest('button, a, svg') || el;
      }
      if (el === document.documentElement || el === document.body || el.id === 'root') {
        return el.firstElementChild || el;
      }
      return el;
    }
    function elementPath(el) {
      var parts = [];
      var current = el;
      while (current && current !== document.body && parts.length < 6) {
        var part = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift(part + '#' + current.id);
          break;
        }
        var parent = current.parentElement;
        if (parent) {
          var siblings = Array.prototype.filter.call(parent.children, function (child) {
            return child.tagName === current.tagName;
          });
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(' > ');
    }
    var selectionEnabled = false;
    var hovered = null;
    document.addEventListener('mousemove', function (event) {
      if (!selectionEnabled) return;
      var next = selectableElement(event.target);
      if (hovered === next) return;
      if (hovered) hovered.style.outline = hovered.__webgeniusOldOutline || '';
      hovered = next;
      if (hovered) {
        hovered.__webgeniusOldOutline = hovered.style.outline;
        hovered.style.outline = '3px solid #8b5cf6';
        hovered.style.outlineOffset = '-3px';
      }
    }, true);
    document.addEventListener('click', function (event) {
      if (!selectionEnabled) return;
      var target = selectableElement(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({
        type: 'PREVIEW_SECTION_SELECTED',
        section: {
          tag: target.tagName.toLowerCase(),
          id: target.id || undefined,
          classes: Array.prototype.slice.call(target.classList || [], 0, 8),
          textPreview: String(target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240) || undefined,
          domPath: elementPath(target)
        }
      }, '*');
    }, true);
    function wrapHistoryMethod(name) {
      try {
        var original = window.history && window.history[name];
        if (typeof original !== 'function') return;
        window.history[name] = function () {
          // eslint-disable-next-line prefer-rest-params
          var ret = original.apply(this, arguments);
          publishRoute();
          return ret;
        };
      } catch (err) {}
    }
    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
    window.addEventListener('message', function (event) {
      var data = event && event.data;
      if (!data) return;
      if (data.type === 'PREVIEW_SELECTION_MODE') {
        selectionEnabled = !!data.enabled;
        document.body.style.cursor = selectionEnabled ? 'crosshair' : '';
        if (!selectionEnabled && hovered) {
          hovered.style.outline = hovered.__webgeniusOldOutline || '';
          hovered = null;
        }
        return;
      }
      if (data.type !== 'PREVIEW_NAVIGATE') return;
      var next = normalizePath(data.path);
      var base = computeBase();
      var target = base === '/' ? next : base + (next === '/' ? '' : next);
      if (window.location.pathname !== target) {
        window.history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      publishRoute();
    });
    window.addEventListener('popstate', publishRoute);
    window.addEventListener('hashchange', publishRoute);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', publishRoute);
    } else {
      publishRoute();
    }
    try {
      window.parent.postMessage({ type: 'PREVIEW_BRIDGE_READY', capabilities: ['section-selection'] }, '*');
    } catch (err) {}
  })();
}
`;
    console.log('ReactPreviewBuildService.injectPreviewMessagingBridge - injected preview route bridge');
    return code + snippet;
  }
}
