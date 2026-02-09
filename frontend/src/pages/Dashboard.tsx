import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useSidebarStore } from '@/store/sidebarStore';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Sparkles, Send, Eye, Code, Monitor, Download, Maximize2, Minimize2 } from 'lucide-react';
import WebsitePreview from '@/components/WebsitePreview';
import { GeneratingLoader } from '@/components/GeneratingLoader';
import { PromptInput } from '@/components/PromptInput';
import { StatsCards } from '@/components/StatsCards';
import { RecentProjects } from '@/components/RecentProjects';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import JSZip from 'jszip';

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

interface GeneratedWebsite {
  id: string;
  userId?: string;
  websiteName: string;
  prompt?: string;
  htmlCode?: string;
  cssCode?: string;
  jsCode?: string;
  components?: Component[];
  viteConfig?: ViteConfig;
  createdAt: string;
}


const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const websiteIdFromUrl = searchParams.get('website');
  const { user } = useAuthStore();
  const { setCollapsed } = useSidebarStore();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [websiteName, setWebsiteName] = useState('');
  const [generatedWebsite, setGeneratedWebsite] = useState<GeneratedWebsite | null>(null);
  const [showCodeView, setShowCodeView] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('component-0');
  const [activeComponentIndex, setActiveComponentIndex] = useState(0);
  const [stats, setStats] = useState({ totalProjects: 0, generations: 0, creditsUsed: 0, creditsRemaining: 5 });
  const [loadingHistoryWebsite, setLoadingHistoryWebsite] = useState(false);
  const [realPreviewUrl, setRealPreviewUrl] = useState<string | null>(null);
  const [realPreviewLoading, setRealPreviewLoading] = useState(false);
  const [realPreviewError, setRealPreviewError] = useState<string | null>(null);
  const [realPreviewFullscreen, setRealPreviewFullscreen] = useState(false);

  const showSplitView = isGenerating || loadingHistoryWebsite || generatedWebsite !== null;

  // Load website from history when ?website=id is in URL (e.g. from sidebar Recents click)
  useEffect(() => {
    if (!websiteIdFromUrl) return;
    const loadHistoryWebsite = async () => {
      setLoadingHistoryWebsite(true);
      try {
        const res = await api.get(`/website/${websiteIdFromUrl}`);
        const data = res.data;
        setGeneratedWebsite({
          id: data.id,
          userId: data.userId,
          websiteName: data.websiteName || '',
          prompt: data.prompt,
          htmlCode: data.htmlCode,
          cssCode: data.cssCode,
          jsCode: data.jsCode,
          components: data.components,
          viteConfig: data.viteConfig,
          createdAt: data.createdAt,
        });
        setPrompt(data.prompt || '');
        setWebsiteName(data.websiteName || '');
        setCollapsed(true);
      } catch (err) {
        console.error('Failed to load website from history:', err);
      } finally {
        setLoadingHistoryWebsite(false);
      }
    };
    loadHistoryWebsite();
  }, [websiteIdFromUrl, setCollapsed]);

  // Reset real preview when switching website or closing
  useEffect(() => {
    if (!generatedWebsite) {
      setRealPreviewUrl(null);
      setRealPreviewError(null);
      return;
    }
  }, [generatedWebsite?.id]);

  // Fetch real-build preview URL when showing preview for a component-based website
  useEffect(() => {
    if (
      !generatedWebsite?.id ||
      !generatedWebsite?.components?.length ||
      showCodeView
    ) {
      return;
    }
    const userId = generatedWebsite.userId || '691df5ddac69fc46beca44b3';
    let cancelled = false;
    setRealPreviewLoading(true);
    setRealPreviewError(null);
    api
      .get(`/website/${generatedWebsite.id}/preview`, { params: { userId } })
      .then((res) => {
        if (!cancelled && res.data?.previewUrl) {
          setRealPreviewUrl(res.data.previewUrl);
          setRealPreviewError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Preview build failed';
          const log = err.response?.data?.log;
          setRealPreviewError(log ? `${msg}: ${log}` : msg);
          setRealPreviewUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRealPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generatedWebsite?.id, generatedWebsite?.components?.length, generatedWebsite?.userId, showCodeView]);

  useEffect(() => {
    // Fetch stats
    const fetchStats = async () => {
      try {
        const response = await api.get('/website/list');
        const websites = response.data || [];
        setStats({
          totalProjects: websites.length,
          generations: websites.length,
          creditsUsed: websites.length,
          creditsRemaining: 5 - websites.length,
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };
    fetchStats();
  }, [generatedWebsite]);

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

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    setLoading(true);
    setIsGenerating(true);
    setGeneratedWebsite(null);
    setShowCodeView(false);
    setActiveTab('html');
    try {
      // Check if token exists
      const token = localStorage.getItem('token');
      if (!token) {
        alert('You are not authenticated. Please login again.');
        window.location.href = '/login';
        return;
      }

      console.log('Making website generation request...', {
        prompt: prompt.substring(0, 50) + '...',
        websiteName,
        tokenLength: token.length
      });

      const res = await api.post('/website/generate', {
        prompt,
        websiteName: websiteName || `Website ${Date.now()}`,
      });
      
      console.log('Website generated successfully!', res.data);
      console.log('Code lengths:', {
        html: res.data.htmlCode?.length || 0,
        css: res.data.cssCode?.length || 0,
        js: res.data.jsCode?.length || 0
      });
      
      // Check if we got actual code or just placeholders
      if (res.data.htmlCode === '<div>Generated Website</div>' && 
          res.data.cssCode === 'body { margin: 0; padding: 0; }') {
        console.warn('WARNING: Received placeholder code. OpenAI may not have generated properly.');
      }
      
      setGeneratedWebsite(res.data);
      setPrompt('');
      setWebsiteName('');
      // Automatically collapse sidebar when website is generated
      setCollapsed(true);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to generate website';
      const status = error.response?.status;
      const errorData = error.response?.data;
      
      console.error('Website generation error:', {
        status,
        message: errorMessage,
        errorData,
        token: localStorage.getItem('token') ? `exists (${localStorage.getItem('token')?.substring(0, 20)}...)` : 'missing',
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      });
      
      if (status === 401) {
        const detailedError = errorData?.message || errorMessage;
        alert(`Authentication Error (401):\n\n${detailedError}\n\nThis usually means:\n- Your token has expired\n- Your token is invalid\n- You need to login again\n\nRedirecting to login...`);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        useAuthStore.getState().logout();
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        alert(`Error (${status || 'Unknown'}): ${errorMessage}`);
      }
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!generatedWebsite) return;

    try {
      const zip = new JSZip();
      const folderName = generatedWebsite.websiteName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'website';
      
      // Create folder structure
      const htmlFolder = zip.folder('HTML');
      const cssFolder = zip.folder('CSS');
      const jsFolder = zip.folder('JavaScript');

      // Add files to respective folders
      htmlFolder?.file('index.html', generatedWebsite.htmlCode);
      cssFolder?.file('styles.css', generatedWebsite.cssCode);
      jsFolder?.file('script.js', generatedWebsite.jsCode);

      // Generate zip file
      const blob = await zip.generateAsync({ type: 'blob' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating zip file:', error);
      alert('Failed to create zip file. Please try again.');
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col relative">
      {!showSplitView ? (
        // Reference design layout - before generation
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-10">
            {/* Hero Section */}
            <div className="mb-10 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-sm text-accent mb-4">
                <Sparkles className="h-4 w-4" />
                <span>AI-Powered Website Generation</span>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                What do you want to{' '}
                <span className="text-accent">build</span> today?
              </h1>
              <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto text-balance">
                Describe your vision and let AI generate a stunning website in seconds. No coding required.
              </p>
            </div>

            {/* Prompt Input */}
            <div className="mb-8">
              <div className="mb-4 w-full max-w-3xl mx-auto">
                <label className="text-sm font-medium mb-2 block text-foreground text-center">Website Name (Optional)</label>
                <div className="flex justify-center">
                  <input
                    type="text"
                    value={websiteName}
                    onChange={(e) => setWebsiteName(e.target.value)}
                    placeholder="My Awesome Website"
                    className="w-full max-w-md px-4 py-2 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
              <PromptInput
                prompt={prompt}
                setPrompt={setPrompt}
                onGenerate={handleGenerate}
                loading={loading}
              />
            </div>

            {/* Stats */}
            <StatsCards
              totalProjects={stats.totalProjects}
              generations={stats.generations}
              creditsUsed={stats.creditsUsed}
              creditsRemaining={stats.creditsRemaining}
            />

            {/* Recent Projects */}
            <RecentProjects />
          </div>
        </div>
      ) : (
        // Split view after generation starts
        <div className="flex-1 flex gap-6 p-8 overflow-hidden h-full">
          {/* Left Side - Prompt Section */}
          <div className="w-1/2 flex flex-col space-y-6 overflow-y-auto pr-4 h-full">
            <div>
              <h1 className="text-4xl font-bold mb-2">Welcome back, {user?.name}!</h1>
              <p className="text-muted-foreground">
                Describe your website idea and let AI generate it for you.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Generate Website
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Website Name</label>
                  <input
                    type="text"
                    value={websiteName}
                    onChange={(e) => setWebsiteName(e.target.value)}
                    placeholder="My Awesome Website"
                    className="w-full px-4 py-2 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Describe your website</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., Create a modern landing page for a tech startup with a hero section, features, and contact form..."
                    className="w-full px-4 py-3 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground min-h-[200px] resize-none transition-all duration-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    rows={6}
                  />
                </div>
                <Button
                  onClick={handleGenerate}
                  disabled={loading || !prompt.trim()}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    'Generating...'
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Generate Website
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Side - Preview Section */}
          <div className="w-1/2 flex flex-col overflow-hidden h-full">
            <Card className="flex-1 flex flex-col overflow-hidden h-full">
              <CardHeader className="flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {generatedWebsite ? (
                      <>
                        <Monitor className="h-5 w-5" />
                        {generatedWebsite.websiteName}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-5 w-5 animate-pulse" />
                        {loadingHistoryWebsite ? 'Loading...' : 'Generating...'}
                      </>
                    )}
                  </CardTitle>
                  {generatedWebsite && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadZip}
                        className="gap-2"
                        title="Download as ZIP"
                      >
                        <Download className="h-4 w-4" />
                        Download ZIP
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowCodeView(!showCodeView);
                          if (!showCodeView) {
                            if (generatedWebsite.components && generatedWebsite.components.length > 0) {
                              setActiveTab('component-0');
                              setActiveComponentIndex(0);
                            } else {
                            setActiveTab('html');
                            }
                          }
                        }}
                        className="gap-2"
                      >
                        {showCodeView ? (
                          <>
                            <Eye className="h-4 w-4" />
                            View Preview
                          </>
                        ) : (
                          <>
                            <Code className="h-4 w-4" />
                            View Code
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col pt-6">
                {(loading || loadingHistoryWebsite) && !generatedWebsite ? (
                  <GeneratingLoader />
                ) : generatedWebsite ? (
                  // Generated Content
                  <div className="flex-1 overflow-hidden flex flex-col">
                    {showCodeView ? (
                      // Code View - Component-based or Legacy
                      <div className="flex-1 flex flex-col overflow-hidden">
                        {generatedWebsite.components && generatedWebsite.components.length > 0 ? (
                          // Component-based tabs
                          <>
                            <div className="flex border-b bg-muted/30 overflow-x-auto">
                              {generatedWebsite.components.map((component, index) => (
                                <button
                                  key={index}
                                  onClick={() => {
                                    setActiveTab(`component-${index}`);
                                    setActiveComponentIndex(index);
                                  }}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                    activeTab === `component-${index}`
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  {component.path.split('/').pop()}
                                </button>
                              ))}
                              {generatedWebsite.viteConfig?.styleCss && (
                                <button
                                  onClick={() => setActiveTab('style')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'style'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  style.css
                                </button>
                              )}
                              {(generatedWebsite.viteConfig?.mainJs || generatedWebsite.viteConfig?.mainJsx) && (
                                <button
                                  onClick={() => setActiveTab('main')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'main'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  {generatedWebsite.viteConfig?.mainJsx ? 'main.jsx' : 'main.js'}
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.indexHtml && (
                                <button
                                  onClick={() => setActiveTab('index')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'index'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  index.html
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.viteConfig && (
                                <button
                                  onClick={() => setActiveTab('vite')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'vite'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  vite.config.js
                                </button>
                              )}
                              {generatedWebsite.viteConfig?.packageJson && (
                                <button
                                  onClick={() => setActiveTab('package')}
                                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'package'
                                      ? 'border-accent text-accent bg-background'
                                      : 'border-transparent text-muted-foreground hover:text-foreground'
                                  }`}
                                >
                                  package.json
                                </button>
                              )}
                            </div>
                            <div className="flex-1 overflow-auto">
                              <div className="rounded-lg overflow-hidden border h-full">
                                {activeTab.startsWith('component-') && (
                                  <SyntaxHighlighter
                                    language={generatedWebsite.components[activeComponentIndex]?.language === 'jsx' ? 'jsx' : 'javascript'}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {generatedWebsite.components[activeComponentIndex]?.code || ''}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'style' && generatedWebsite.viteConfig?.styleCss && (
                                  <SyntaxHighlighter
                                    language="css"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {formatCode(generatedWebsite.viteConfig.styleCss, 'css')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'main' && (generatedWebsite.viteConfig?.mainJs || generatedWebsite.viteConfig?.mainJsx) && (
                                  <SyntaxHighlighter
                                    language={generatedWebsite.viteConfig?.mainJsx ? 'jsx' : 'javascript'}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {formatCode(generatedWebsite.viteConfig.mainJsx || generatedWebsite.viteConfig.mainJs || '', 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'index' && generatedWebsite.viteConfig?.indexHtml && (
                                  <SyntaxHighlighter
                                    language="html"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {formatCode(generatedWebsite.viteConfig.indexHtml, 'html')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'vite' && generatedWebsite.viteConfig?.viteConfig && (
                                  <SyntaxHighlighter
                                    language="javascript"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {formatCode(generatedWebsite.viteConfig.viteConfig, 'js')}
                                  </SyntaxHighlighter>
                                )}
                                {activeTab === 'package' && generatedWebsite.viteConfig?.packageJson && (
                                  <SyntaxHighlighter
                                    language="json"
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      borderRadius: 0,
                                      fontSize: '0.875rem',
                                      lineHeight: '1.6',
                                      height: '100%',
                                      minHeight: '100%',
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
                                    {formatJson(generatedWebsite.viteConfig.packageJson)}
                                  </SyntaxHighlighter>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          // Legacy HTML/CSS/JS tabs
                          <>
                        <div className="flex border-b bg-muted/30">
                          <button
                            onClick={() => setActiveTab('html')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'html'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            index.html
                          </button>
                          <button
                            onClick={() => setActiveTab('css')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'css'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            styles.css
                          </button>
                          <button
                            onClick={() => setActiveTab('js')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'js'
                                ? 'border-accent text-accent bg-background'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            script.js
                          </button>
                        </div>
                        <div className="flex-1 overflow-auto">
                          <div className="rounded-lg overflow-hidden border h-full">
                            {activeTab === 'html' && (
                              <SyntaxHighlighter
                                language="html"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
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
                                    {formatCode(generatedWebsite.htmlCode || '', 'html')}
                              </SyntaxHighlighter>
                            )}
                            {activeTab === 'css' && (
                              <SyntaxHighlighter
                                language="css"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
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
                                    {formatCode(generatedWebsite.cssCode || '', 'css')}
                              </SyntaxHighlighter>
                            )}
                            {activeTab === 'js' && (
                              <SyntaxHighlighter
                                language="javascript"
                                style={vscDarkPlus}
                                customStyle={{
                                  margin: 0,
                                  borderRadius: 0,
                                  fontSize: '0.875rem',
                                  lineHeight: '1.6',
                                  height: '100%',
                                  minHeight: '100%',
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
                                    {formatCode(generatedWebsite.jsCode || '', 'js')}
                              </SyntaxHighlighter>
                            )}
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    ) : (
                      // Preview View: real-build iframe or legacy
                      <div className="flex-1 overflow-auto h-full flex flex-col min-h-[600px]">
                        {realPreviewLoading && (
                          <div className="flex-1 flex items-center justify-center min-h-[600px]">
                            <GeneratingLoader variant="building" />
                          </div>
                        )}
                        {!realPreviewLoading && realPreviewUrl && (
                          <>
                            {realPreviewFullscreen ? (
                              <div className="fixed inset-0 z-50 bg-background flex flex-col">
                                <div className="flex items-center justify-between p-4 border-b bg-card flex-shrink-0">
                                  <h2 className="text-lg font-semibold">{generatedWebsite.websiteName || 'Website Preview'}</h2>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRealPreviewFullscreen(false)}
                                    className="gap-2"
                                  >
                                    <Minimize2 className="h-4 w-4" />
                                    Exit Fullscreen
                                  </Button>
                                </div>
                                <iframe
                                  src={realPreviewUrl}
                                  title="Website Preview"
                                  className="flex-1 w-full border-0 min-h-0"
                                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                />
                              </div>
                            ) : (
                              <div className="border rounded-lg overflow-hidden bg-card flex flex-col flex-1 min-h-[600px]">
                                <div className="flex items-center justify-between p-3 border-b bg-muted/50 flex-shrink-0">
                                  <h3 className="text-sm font-medium">{generatedWebsite.websiteName || 'Preview'}</h3>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRealPreviewFullscreen(true)}
                                    className="h-7 px-2"
                                  >
                                    <Maximize2 className="h-3 w-3" />
                                  </Button>
                                </div>
                                <iframe
                                  src={realPreviewUrl}
                                  title="Website Preview"
                                  className="w-full flex-1 min-h-[500px] border-0"
                                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                />
                              </div>
                            )}
                          </>
                        )}
                        {!realPreviewLoading && realPreviewError && (
                          <div className="p-4 space-y-2">
                            <p className="text-sm text-destructive">{realPreviewError}</p>
                            <p className="text-xs text-muted-foreground">Showing quick preview instead.</p>
                            <WebsitePreview
                              html={generatedWebsite.htmlCode}
                              css={generatedWebsite.cssCode}
                              js={generatedWebsite.jsCode}
                              components={generatedWebsite.components}
                              viteConfig={generatedWebsite.viteConfig}
                              websiteName={generatedWebsite.websiteName}
                              prompt={generatedWebsite.prompt}
                              className="h-full min-h-[400px]"
                            />
                          </div>
                        )}
                        {!realPreviewLoading && !realPreviewUrl && !realPreviewError && (
                          <WebsitePreview
                            html={generatedWebsite.htmlCode}
                            css={generatedWebsite.cssCode}
                            js={generatedWebsite.jsCode}
                            components={generatedWebsite.components}
                            viteConfig={generatedWebsite.viteConfig}
                            websiteName={generatedWebsite.websiteName}
                            prompt={generatedWebsite.prompt}
                            className="h-full min-h-[600px]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

