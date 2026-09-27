import { BadRequestException } from '@nestjs/common';

export interface DeploymentFile { file: string; data: string }

export function publicBackendUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new BadRequestException('Enter a valid HTTPS backend URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) {
    throw new BadRequestException('The backend URL must be a public HTTPS domain without credentials or query parameters.');
  }
  return url.href.replace(/\/+$/, '');
}

export function vercelBundle(files: DeploymentFile[], framework: 'vite' | 'nextjs' | null, backendUrl?: string) {
  const safe = new Map<string, string>();
  for (const entry of files) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.data !== 'string') throw new BadRequestException('Generated source contains an invalid file.');
    const file = entry.file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!file || file.startsWith('/') || /[:\x00-\x1f]/.test(file) || file.split('/').some((part) => part === '..' || part === '.' || !part)) {
      throw new BadRequestException('Generated source contains an unsafe file path.');
    }
    // Do not publish local configuration, credentials, build caches, or a generated backend.
    if (file.split('/').some((part) => part.startsWith('.') && !['.well-known'].includes(part)) ||
        /(^|\/)(node_modules|dist|backend|\.next)(\/|$)/.test(file) ||
        /^(auth-data\.json|data\.json|server\.js|auth\.js|vercel\.(json|ts))$/i.test(file) || /\.(pem|key)$/i.test(file)) continue;
    if (safe.has(file)) throw new BadRequestException(`Generated source contains duplicate files: ${file}`);
    safe.set(file, entry.data);
  }
  if (framework) {
    let manifest: any;
    try { manifest = JSON.parse(safe.get('package.json') || ''); } catch { throw new BadRequestException('Generated source is missing a valid package.json.'); }
    if (framework === 'nextjs' && !manifest.dependencies?.next && !manifest.devDependencies?.next) {
      throw new BadRequestException('The v0 project is missing its Next.js dependency.');
    }
    // Only retain dependency declarations, not lifecycle hooks or arbitrary build commands.
    const allowedDependencies = (dependencies: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(dependencies).map(([name, version]) => {
      if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) || typeof version !== 'string' || !(/^[~^<>=\d*][\d\w.*+~^<>=| -]*$/.test(version) || /^[a-z][a-z0-9._-]*$/i.test(version))) {
        throw new BadRequestException(`Unsupported dependency declaration: ${name}`);
      }
      return [name, version];
    }));
    safe.set('package.json', JSON.stringify({ name: 'webgenius-site', version: '1.0.0', private: true,
      ...(framework === 'vite' ? { type: 'module' } : {}),
      scripts: { build: framework === 'vite' ? 'vite build' : 'next build' },
      dependencies: allowedDependencies(manifest.dependencies), devDependencies: allowedDependencies(manifest.devDependencies),
    }, null, 2));
    // The sanitized manifest is authoritative; stale lockfiles can prevent dependency installation.
    for (const file of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']) safe.delete(file);
  }
  if (framework === 'nextjs' && ![...safe.keys()].some((name) => /^(src\/)?(app\/page|pages\/index)\.[jt]sx?$/.test(name))) {
    throw new BadRequestException('The v0 project does not contain a deployable Next.js entry page.');
  }
  const rewrites = backendUrl ? [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }] : [];
  if (framework === 'vite' && safe.has('index.html')) {
    const html = safe.get('index.html')!;
    const runtime = '<script>globalThis.__WEBGENIUS_API_BASE__="";</script>';
    safe.set('index.html', /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + runtime) : runtime + html);
  }
  if (framework === 'vite') rewrites.push({ source: '/((?!api/|assets/).*)', destination: '/index.html' });
  safe.set('vercel.json', JSON.stringify({ framework, ...(framework === 'vite' ? { outputDirectory: 'dist' } : {}),
    ...(framework ? { installCommand: 'npm install --ignore-scripts --no-audit --no-fund', buildCommand: 'npm run build' } : { buildCommand: '', installCommand: '' }),
    ...(rewrites.length ? { rewrites } : {}),
  }));
  const result = [...safe].map(([file, data]) => ({ file, data }));
  if (result.length > 500 || Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) {
    throw new BadRequestException('This project exceeds the inline deployment limit (500 files / 4 MB). Export it and deploy with the Vercel CLI.');
  }
  return result;
}
