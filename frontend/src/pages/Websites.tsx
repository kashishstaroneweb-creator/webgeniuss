import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import WebsitePreview from '@/components/WebsitePreview';
import { Globe, Eye, Clock, Trash2, Code, Monitor, ChevronDown, ChevronUp } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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

interface Website {
  id: string;
  websiteName: string;
  prompt?: string;
  htmlCode?: string;
  cssCode?: string;
  jsCode?: string;
  components?: Component[];
  viteConfig?: ViteConfig;
  createdAt: string;
}

const Websites = () => {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewWebsite, setPreviewWebsite] = useState<Website | null>(null);
  const [expandedWebsites, setExpandedWebsites] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<Record<string, 'preview' | 'code'>>({});
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [activeComponentIndex, setActiveComponentIndex] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchWebsites();
  }, []);

  const fetchWebsites = async () => {
    try {
      const response = await api.get('/website/list');
      setWebsites(response.data);
    } catch (error) {
      console.error('Failed to fetch websites:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePreview = (website: Website) => {
    setPreviewWebsite(website);
  };

  const handleDelete = async (websiteId: string) => {
    if (!confirm('Are you sure you want to delete this website?')) {
      return;
    }
    try {
      await api.delete(`/website/${websiteId}`);
      setWebsites(websites.filter(w => w.id !== websiteId));
      // Clean up state
      const newExpanded = new Set(expandedWebsites);
      newExpanded.delete(websiteId);
      setExpandedWebsites(newExpanded);
      const newViewMode = { ...viewMode };
      const newActiveTab = { ...activeTab };
      delete newViewMode[websiteId];
      delete newActiveTab[websiteId];
      setViewMode(newViewMode);
      setActiveTab(newActiveTab);
    } catch (error) {
      console.error('Failed to delete website:', error);
      alert('Failed to delete website. Please try again.');
    }
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedWebsites);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
      // Clean up view mode and active tab when collapsing
      const newViewMode = { ...viewMode };
      const newActiveTab = { ...activeTab };
      delete newViewMode[id];
      delete newActiveTab[id];
      setViewMode(newViewMode);
      setActiveTab(newActiveTab);
    } else {
      newExpanded.add(id);
      // Set default view mode and tab when expanding
      setViewMode({ ...viewMode, [id]: 'preview' });
      setActiveTab({ ...activeTab, [id]: 'html' });
    }
    setExpandedWebsites(newExpanded);
  };

  // Format JSON code with proper indentation
  const formatJson = (jsonString: string): string => {
    if (!jsonString) return '';
    try {
      // Try to parse and format JSON
      const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If parsing fails, return as-is
      return jsonString;
    }
  };

  // Format code with proper indentation and line breaks
  const formatCode = (code: string, type: 'html' | 'css' | 'js'): string => {
    if (!code) return '';
    
    // If code already has multiple lines, return as is (it's already formatted)
    if (code.split('\n').length > 1) {
      return code;
    }
    
    // If code is on a single line, add basic formatting
    let formatted = code;
    
    if (type === 'html') {
      // Add line breaks between HTML tags
      formatted = formatted.replace(/>\s*</g, '>\n<');
    } else if (type === 'css') {
      // Add line breaks after semicolons and braces
      formatted = formatted
        .replace(/;\s*/g, ';\n')
        .replace(/\{\s*/g, '{\n')
        .replace(/\}\s*/g, '\n}\n');
    } else if (type === 'js') {
      // Add line breaks after semicolons, braces, and commas
      formatted = formatted
        .replace(/;\s*/g, ';\n')
        .replace(/\{\s*/g, '{\n')
        .replace(/\}\s*/g, '\n}\n')
        .replace(/,\s*/g, ',\n');
    }
    
    // Add basic indentation
    const lines = formatted.split('\n');
    let indentLevel = 0;
    const indentSize = 2;
    
    formatted = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      
      // Decrease indent for closing tags/braces
      if (trimmed.startsWith('</') || trimmed === '}') {
        indentLevel = Math.max(0, indentLevel - 1);
      }
      
      const indented = ' '.repeat(indentLevel * indentSize) + trimmed;
      
      // Increase indent for opening tags/braces
      if ((trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) || 
          trimmed.endsWith('{')) {
        indentLevel++;
      }
      
      return indented;
    }).filter(line => line.trim().length > 0).join('\n');
    
    return formatted;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl mb-4 flex items-center gap-3">
            <Globe className="h-8 w-8 text-accent" />
            My Websites
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl">
            View, preview, and explore the code of all your generated websites
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : websites.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No websites yet. Generate your first website from the Dashboard!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {websites.map((website) => (
              <Card key={website.id} className="overflow-hidden transition-all duration-200 hover:border-accent/50">
                <CardHeader className="border-b border-border bg-card">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl font-semibold mb-2 text-foreground">{website.websiteName}</CardTitle>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {formatDate(website.createdAt)}
                  </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpand(website.id)}
                        className="gap-2 transition-all duration-200"
                      >
                        {expandedWebsites.has(website.id) ? (
                          <>
                            <ChevronUp className="h-4 w-4" />
                            Collapse
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4" />
                            Expand
                          </>
                        )}
                    </Button>
                    <Button
                      variant="outline"
                        size="sm"
                        onClick={() => handlePreview(website)}
                        className="gap-2 transition-all duration-200"
                      >
                        <Eye className="h-4 w-4" />
                        Fullscreen
                      </Button>
                      <Button
                        variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(website.id)}
                      className="gap-2 transition-all duration-200"
                    >
                      <Trash2 className="h-4 w-4" />
                        Delete
                    </Button>
                  </div>
                  </div>
                </CardHeader>
                
                {expandedWebsites.has(website.id) && (
                  <CardContent className="p-6 space-y-4">
                    {/* View Mode Toggle */}
                    <div className="flex gap-2 border-b">
                      <button
                        onClick={() => setViewMode({ ...viewMode, [website.id]: 'preview' })}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                          viewMode[website.id] === 'preview'
                            ? 'border-accent text-accent'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Monitor className="h-4 w-4" />
                        Preview
                      </button>
                      <button
                          onClick={() => {
                            setViewMode({ ...viewMode, [website.id]: 'code' });
                            if (!activeTab[website.id]) {
                              if (website.components && website.components.length > 0) {
                                setActiveTab({ ...activeTab, [website.id]: 'component-0' });
                                setActiveComponentIndex({ ...activeComponentIndex, [website.id]: 0 });
                              } else {
                                setActiveTab({ ...activeTab, [website.id]: 'html' });
                              }
                            }
                          }}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-200 flex items-center gap-2 ${
                          viewMode[website.id] === 'code'
                            ? 'border-accent text-accent'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Code className="h-4 w-4" />
                        Code
                      </button>
                    </div>

                    {/* Content Area */}
                    <div className="border rounded-lg overflow-hidden bg-card" style={{ minHeight: '500px', maxHeight: '700px' }}>
                      {viewMode[website.id] === 'preview' ? (
                        // Preview View
                        <div className="h-full overflow-auto" style={{ maxHeight: '700px' }}>
                          <WebsitePreview
                            html={website.htmlCode}
                            css={website.cssCode}
                            js={website.jsCode}
                            components={website.components}
                            viteConfig={website.viteConfig}
                            websiteName={website.websiteName}
                            prompt={website.prompt}
                            className="min-h-[500px]"
                          />
                        </div>
                      ) : (
                        // Code View with Tabs - Component-based or Legacy
                        <div className="flex flex-col h-full" style={{ maxHeight: '700px' }}>
                          {website.components && website.components.length > 0 ? (
                            // Component-based tabs
                            <>
                              <div className="flex border-b bg-muted/30 overflow-x-auto">
                                {website.components.map((component, index) => (
                                  <button
                                    key={index}
                                    onClick={() => {
                                      setActiveTab({ ...activeTab, [website.id]: `component-${index}` });
                                      setActiveComponentIndex({ ...activeComponentIndex, [website.id]: index });
                                    }}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                      activeTab[website.id] === `component-${index}`
                                        ? 'border-accent text-accent bg-background'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    {component.path.split('/').pop()}
                                  </button>
                                ))}
                                {website.viteConfig?.styleCss && (
                                  <button
                                    onClick={() => setActiveTab({ ...activeTab, [website.id]: 'style' })}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                      activeTab[website.id] === 'style'
                                        ? 'border-accent text-accent bg-background'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    style.css
                                  </button>
                                )}
                                {website.viteConfig?.mainJs && (
                                  <button
                                    onClick={() => setActiveTab({ ...activeTab, [website.id]: 'main' })}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                      activeTab[website.id] === 'main'
                                        ? 'border-accent text-accent bg-background'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    main.js
                                  </button>
                                )}
                              </div>
                              <div className="flex-1 overflow-auto" style={{ maxHeight: '650px' }}>
                                {activeTab[website.id]?.startsWith('component-') && (
                                  <SyntaxHighlighter
                                    language="javascript"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.components[activeComponentIndex[website.id] || 0]?.code || '', 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'style' && website.viteConfig?.styleCss && (
                                  <SyntaxHighlighter
                                    language="css"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.viteConfig.styleCss, 'css')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'main' && (website.viteConfig?.mainJs || website.viteConfig?.mainJsx) && (
                                  <SyntaxHighlighter
                                    language={website.viteConfig?.mainJsx ? 'jsx' : 'javascript'}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.viteConfig.mainJsx || website.viteConfig.mainJs || '', 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'index' && website.viteConfig?.indexHtml && (
                                  <SyntaxHighlighter
                                    language="html"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.viteConfig.indexHtml, 'html')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'vite' && website.viteConfig?.viteConfig && (
                                  <SyntaxHighlighter
                                    language="javascript"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.viteConfig.viteConfig, 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'package' && website.viteConfig?.packageJson && (
                                  <SyntaxHighlighter
                                    language="json"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatJson(website.viteConfig.packageJson)}
                                  </SyntaxHighlighter>
                                )}
                              </div>
                            </>
                          ) : (
                            // Legacy HTML/CSS/JS tabs
                            <>
                              <div className="flex border-b bg-muted/30">
                                <button
                                  onClick={() => setActiveTab({ ...activeTab, [website.id]: 'html' })}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab[website.id] === 'html'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  index.html
                                </button>
                                <button
                                  onClick={() => setActiveTab({ ...activeTab, [website.id]: 'css' })}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab[website.id] === 'css'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  styles.css
                                </button>
                                <button
                                  onClick={() => setActiveTab({ ...activeTab, [website.id]: 'js' })}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab[website.id] === 'js'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  script.js
                                </button>
                              </div>
                              <div className="flex-1 overflow-auto" style={{ maxHeight: '650px' }}>
                                {activeTab[website.id] === 'html' && (
                                  <SyntaxHighlighter
                                    language="html"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.htmlCode || '', 'html')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'css' && (
                                  <SyntaxHighlighter
                                    language="css"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.cssCode || '', 'css')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab[website.id] === 'js' && (
                                  <SyntaxHighlighter
                                    language="javascript"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      padding: '1rem',
                                      whiteSpace: 'pre',
                                      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                    }}
                                    showLineNumbers
                                    wrapLines={false}
                                    wrapLongLines={false}
                                    PreTag="pre"
                                    codeTagProps={{
                                      style: {
                                        whiteSpace: 'pre',
                                        wordBreak: 'normal',
                                        overflowWrap: 'normal',
                                      }
                                    }}
                                  >
                                    {formatCode(website.jsCode || '', 'js')}
                                  </SyntaxHighlighter>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

        {previewWebsite && (
          <WebsitePreview
            html={previewWebsite.htmlCode}
            css={previewWebsite.cssCode}
            js={previewWebsite.jsCode}
            components={previewWebsite.components}
            viteConfig={previewWebsite.viteConfig}
            websiteName={previewWebsite.websiteName}
            prompt={previewWebsite.prompt}
            isModal={true}
            onClose={() => setPreviewWebsite(null)}
          />
        )}
      </div>
    </div>
  );
};

export default Websites;

