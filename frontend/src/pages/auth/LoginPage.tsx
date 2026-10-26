import * as React from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Compass, Eye, EyeOff } from 'lucide-react';
import { ROLE_HOME_ROUTE } from '@careerpilot/shared';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { ApiClientError } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';

const DEMO_ACCOUNTS = [
  { label: 'Student', email: 'student@careerpilot.demo' },
  { label: 'Alumni mentor', email: 'alumni@careerpilot.demo' },
  { label: 'Placement officer', email: 'officer@careerpilot.demo' },
  { label: 'Administrator', email: 'admin@careerpilot.demo' },
];
const DEMO_PASSWORD = 'Demo@Pass123';

export function LoginPage() {
  const { login, user, status } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (status === 'authenticated' && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? ROLE_HOME_ROUTE[user.role]} replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? ROLE_HOME_ROUTE[signedIn.role], { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught : null);
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Compass className="size-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">CareerPilot AI</h1>
          <p className="text-sm text-muted-foreground">
            Agentic AI-based placement preparation and career intelligence
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <h2 className="text-lg font-semibold">Sign in</h2>

            {error && (
              <Alert variant="danger" title="Sign-in failed">
                <p>{error.message}</p>
              </Alert>
            )}

            <Field label="Email address" htmlFor="email" required error={error?.fieldError('email')}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                aria-invalid={Boolean(error?.fieldError('email'))}
              />
            </Field>

            <Field label="Password" htmlFor="password" required error={error?.fieldError('password')}>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              New here?{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </form>
        </Card>

        {isDemoMode && (
          <Card className="p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Demo accounts
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.email}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fillDemo(account.email)}
                >
                  {account.label}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              These accounts exist only after running <code className="font-mono">npm run seed</code>. All demo
              data is clearly labelled and must not be treated as real records.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
