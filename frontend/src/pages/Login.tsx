import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Sparkles, Github } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const OTP_LENGTH = 6;

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOtpStep, setIsOtpStep] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [pendingEmail, setPendingEmail] = useState('');
  const [otpSession, setOtpSession] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const combinedOtp = otpDigits.join('');

  const handleOtpBoxChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;

    const updatedDigits = [...otpDigits];
    updatedDigits[index] = value;
    setOtpDigits(updatedDigits);

    if (value && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('Text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;

    const updatedDigits = Array(OTP_LENGTH)
      .fill('')
      .map((_, idx) => pasted[idx] || '');

    setOtpDigits(updatedDigits);
    if (pasted.length === OTP_LENGTH) {
      otpRefs.current[OTP_LENGTH - 1]?.focus();
    }
    event.preventDefault();
  };

  const resetOtpState = () => {
    setIsOtpStep(false);
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    setPendingEmail('');
    setOtpSession('');
    setOtpMessage('');
    setOtpExpiresAt(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      // Only send required fields based on login/signup
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : { name: formData.name, email: formData.email, password: formData.password };
      const { data } = await api.post(endpoint, payload);

      if (data?.access_token && data?.user) {
        setAuth(data.user, data.access_token);
        navigate('/dashboard');
        return;
      }

      if (data?.otpRequired) {
        setIsOtpStep(true);
        setPendingEmail(data.email ?? formData.email);
        setOtpSession(data.otpSession);
        setOtpMessage(data.message);
        setOtpExpiresAt(data.expiresAt ?? null);
        setOtpDigits(Array(OTP_LENGTH).fill(''));
        return;
      }

      setError('Unexpected response from server.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await api.post('/auth/verify-otp', {
        email: pendingEmail,
        otp: combinedOtp,
        sessionToken: otpSession,
      });
      setAuth(data.user, data.access_token);
      resetOtpState();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: 'google' | 'github') => {
    window.location.href = `${API_URL}/auth/${provider}`;
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-8 overflow-hidden">
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>

      <Card className="relative z-10 w-full max-w-lg border-border bg-card shadow-sm">
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent">
              <Sparkles className="h-6 w-6 text-accent-foreground" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-foreground">
            WebGenius
          </CardTitle>
          <CardDescription className="text-lg text-muted-foreground">
            {isOtpStep
              ? 'Enter OTP'
              : isLogin
                ? 'Welcome back!'
                : 'Create your account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOtpStep ? (
            <form onSubmit={handleOtpSubmit} className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {otpMessage || `Enter the OTP sent to ${pendingEmail}`}
              </p>
              {otpExpiresAt && (
                <p className="text-xs text-muted-foreground">
                  Expires at {new Date(otpExpiresAt).toLocaleTimeString()}
                </p>
              )}
              <div className="flex justify-between gap-2">
                {otpDigits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => (otpRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpBoxChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={handleOtpPaste}
                    className="h-14 w-12 rounded-xl border border-border bg-input text-center text-xl font-semibold text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                  />
                ))}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-1/3"
                  onClick={() => {
                    resetOtpState();
                    setError('');
                  }}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={loading || combinedOtp.length !== OTP_LENGTH}
                >
                  {loading ? 'Verifying...' : 'Verify OTP'}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div>
                  <Input
                    placeholder="Full Name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required={!isLogin}
                    className="transition-all duration-200"
                  />
                </div>
              )}
              <Input
                type="email"
                placeholder="Email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                className="transition-all duration-200"
              />
              <Input
                type="password"
                placeholder="Password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                className="transition-all duration-200"
              />
              {isLogin && (
                <div className="flex justify-end">
                  <Link
                    to="/forgot-password"
                    className="text-sm text-accent hover:underline transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full transition-all duration-200"
                disabled={loading}
              >
                {loading ? 'Loading...' : isLogin ? 'Login' : 'Sign Up'}
              </Button>
            </form>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth('google')}
              className="w-full transition-all duration-200"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth('github')}
              className="w-full transition-all duration-200"
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </Button>
          </div>

          {!isOtpStep && (
            <p className="text-center text-sm text-muted-foreground mt-4">
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                  if (!isLogin) {
                    setFormData({ ...formData, name: '' });
                  }
                }}
                className="text-accent hover:underline transition-colors duration-200"
                disabled={loading}
              >
                {isLogin ? 'Sign up' : 'Login'}
              </button>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;

