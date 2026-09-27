import { WebsiteService } from './website.service';
import { ReactPreviewBuildService } from './react-preview-build.service';

describe('Incomplete generated frontend responses', () => {
  const service = Object.create(WebsiteService.prototype) as any;
  const builder = Object.create(ReactPreviewBuildService.prototype) as any;
  const truncated = '{"components":[{"name":"Login","code":"export default function Login() {}"}],"viteConfig":{"indexHtml":"<!DOCTYPE html>\\n<html lang=';

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not turn an unfinished HTML string into a valid project', () => {
    expect(service.parseV0Response(truncated)).toBeNull();
    expect(service.extractCodeFromResponse(truncated)).toBeNull();
    expect(service.websiteCodeFromChatDetail({ text: truncated })).toBeNull();
  });

  it('preserves complete project JSON and fenced responses', () => {
    const project = { components: [], viteConfig: { indexHtml: '<html lang="en"></html>', mainJsx: 'render(<App />);' } };
    expect(service.parseV0Response(JSON.stringify(project))).toEqual(project);
    expect(service.parseV0Response('```json\n' + JSON.stringify(project) + '\n```')).toEqual(project);
  });

  it('does not report an empty scrape as a ready project', () => {
    expect(service.websiteCodeFromChatDetail({ text: 'Still generating the app.' })).toBeNull();
  });

  it('rejects already-saved truncated HTML before deployment bundling', () => {
    expect(() => builder.deploymentFiles({ framework: 'react', viteConfig: { indexHtml: '<!DOCTYPE html>\n<html lang=' } }))
      .toThrow('Regenerate this project');
  });

  it('keeps runtime configuration after the doctype when the document has no head', () => {
    jest.spyOn(builder, 'fullStackApiBase').mockReturnValue('https://api.example/runtime/123');
    const html = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';
    const result = builder.injectFullStackRuntimeConfig(html, {});
    expect(result.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(result).toContain('<body>\n<script>globalThis.__WEBGENIUS_API_BASE__=');
  });
});
