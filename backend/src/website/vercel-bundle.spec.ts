import { ObjectId } from 'mongodb';
import { publicBackendUrl, vercelBundle } from './vercel-bundle';
import { ReactPreviewBuildService } from './react-preview-build.service';

describe('Vercel frontend packaging', () => {
  const viteFiles = [
    { file: 'package.json', data: JSON.stringify({ scripts: { postinstall: 'unsafe', build: 'custom' }, dependencies: { react: '^18.2.0' } }) },
    { file: 'index.html', data: '<html><head></head><body><div id="root"></div></body></html>' },
    { file: 'src/main.jsx', data: 'export default {};' },
  ];
  it('configures Vite builds, deep links and the hosted backend proxy', () => {
    const bundle = vercelBundle(viteFiles, 'vite', 'https://api.example.com/runtime/project');
    const config = JSON.parse(bundle.find((entry) => entry.file === 'vercel.json')!.data);
    expect(config.framework).toBe('vite');
    expect(config.outputDirectory).toBe('dist');
    expect(config.rewrites).toContainEqual({ source: '/api/:path*', destination: 'https://api.example.com/runtime/project/api/:path*' });
    expect(config.rewrites).toContainEqual({ source: '/((?!api/|assets/).*)', destination: '/index.html' });
    const manifest = JSON.parse(bundle.find((entry) => entry.file === 'package.json')!.data);
    expect(manifest.scripts).toEqual({ build: 'vite build' });
    expect(bundle.find((entry) => entry.file === 'index.html')!.data).toContain('__WEBGENIUS_API_BASE__=""');
  });

  it('excludes secrets, local configuration and separately generated backends', () => {
    const files = [...viteFiles, ...['.env', 'src/.env.local', '.npmrc', 'private.pem', 'backend/server.js', 'auth-data.json', 'vercel.json', 'node_modules/test.js'].map((file) => ({ file, data: 'sensitive' })), { file: 'src/lib/auth.js', data: 'frontend helper' }];
    const bundle = vercelBundle(files, 'vite');
    expect(bundle.some((entry) => entry.data === 'sensitive')).toBe(false);
    expect(bundle.some((entry) => entry.file === 'src/lib/auth.js')).toBe(true);
  });

  it.each(['../outside.js', '/root.js', 'C:\\secret.js', 'src/../../secret.js', 'src//file.js'])('rejects unsafe paths: %s', (file) => {
    expect(() => vercelBundle([{ file, data: 'code' }], null)).toThrow('unsafe file path');
  });

  it('rejects oversized projects before making provider requests', () => {
    expect(() => vercelBundle([{ file: 'index.html', data: 'x'.repeat(4 * 1024 * 1024) }], null)).toThrow('deployment limit');
  });

  it('requires complete Next.js source rather than deploying preview fragments', () => {
    expect(() => vercelBundle(viteFiles, 'nextjs')).toThrow('Next.js dependency');
    const bundle = vercelBundle([
      { file: 'package.json', data: JSON.stringify({ dependencies: { next: 'latest', react: '^19.0.0' } }) },
      { file: 'app/page.tsx', data: 'export default function Page() { return <main>Hello</main> }' },
    ], 'nextjs');
    expect(JSON.parse(bundle.find((entry) => entry.file === 'package.json')!.data).scripts.build).toBe('next build');
    expect(JSON.parse(bundle.find((entry) => entry.file === 'vercel.json')!.data).rewrites).toBeUndefined();
  });

  it.each(['http://api.example.com', 'https://localhost', 'https://127.0.0.1', 'https://user:secret@api.example.com', 'https://api.example.com?secret=value'])('rejects unsuitable backend URLs: %s', (url) => {
    expect(() => publicBackendUrl(url)).toThrow();
  });

  it('accepts an HTTPS backend base path without fetching it', () => {
    expect(publicBackendUrl('https://api.example.com/runtime/123/')).toBe('https://api.example.com/runtime/123');
  });

  it('packages static HTML without preview-only runtime code or npm builds', () => {
    const service = new ReactPreviewBuildService({} as any);
    const files = service.deploymentFiles({ id: new ObjectId(), framework: 'html', websiteName: 'Landing', htmlCode: '<main>Hello</main>', cssCode: 'body{color:red}', jsCode: 'console.log("site")' } as any);
    expect(files.find((file) => file.file === 'index.html')!.data).toContain('styles.css');
    expect(files.find((file) => file.file === 'script.js')!.data).not.toContain('postMessage');
    expect(JSON.parse(vercelBundle(files, null).find((file) => file.file === 'vercel.json')!.data).buildCommand).toBe('');
  });

  it('preserves TypeScript component paths when supplying a missing React entry point', () => {
    const service = new ReactPreviewBuildService({} as any);
    const files = service.deploymentFiles({ framework: 'react', websiteName: 'App',
      components: [{ name: 'App', path: 'src/App.tsx', code: 'export default function App(){ return <main>Hello</main> }' }],
    } as any);
    expect(files.find((file) => file.file === 'src/main.jsx')!.data).toContain('./App.tsx');
    expect(files.find((file) => file.file === 'vite.config.js')!.data).toContain("base: '/'");
    expect(files.find((file) => file.file === 'src/main.jsx')!.data).not.toContain('postMessage');
    expect(files.some((file) => file.file === 'src/App.tsx')).toBe(true);
  });
});
