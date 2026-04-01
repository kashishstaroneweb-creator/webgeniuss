import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Sparkles, ArrowLeft } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const OTP_LENGTH = 6;

const ForgotPassword = () => {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpSession, setOtpSession] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

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

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');

    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setInfo(data?.message ?? 'Check your email for the code.');
      if (data?.otpSession) {
        setOtpSession(data.otpSession);
        setOtpExpiresAt(data.expiresAt ?? null);
        setStep('reset');
        setOtpDigits(Array(OTP_LENGTH).fill(''));
      } else {
        setInfo(
          data?.message ??
            'If an account exists with this email, you will receive a verification code shortly.',
        );
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { data } = await api.post('/auth/reset-password', {
        email,
        otp: combinedOtp,
        sessionToken: otpSession,
        newPassword,
      });
      if (data?.access_token && data?.user) {
        setAuth(data.user, data.access_token);
        navigate('/dashboard');
        return;
      }
      setError('Unexpected response from server.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
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
          <CardTitle className="text-3xl font-bold text-foreground">WebGenius</CardTitle>
          <CardDescription className="text-lg text-muted-foreground">
            {step === 'email' ? 'Reset your password' : 'Enter code & new password'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the email for your account. We will send a 6-digit code if the account exists.
              </p>
              {info && !error && (
                <p className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
                  {info}
                </p>
              )}
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="transition-all duration-200"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              {info && <p className="text-sm text-muted-foreground">{info}</p>}
              <p className="text-sm text-muted-foreground">
                Code sent to <span className="text-foreground font-medium">{email}</span>
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
              <Input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="transition-all duration-200"
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="transition-all duration-200"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-1/3"
                  onClick={() => {
                    setStep('email');
                    setError('');
                    setInfo('');
                    setOtpDigits(Array(OTP_LENGTH).fill(''));
                    setOtpSession('');
                    setOtpExpiresAt(null);
                    setNewPassword('');
                    setConfirmPassword('');
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
                  {loading ? 'Updating...' : 'Reset password'}
                </Button>
              </div>
            </form>
          )}

          <div className="pt-2 border-t border-border">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
