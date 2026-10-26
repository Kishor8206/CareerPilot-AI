import * as React from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { ROLE_HOME_ROUTE, UserRole } from '@careerpilot/shared';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';
import { ApiClientError } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Self-registration is limited to students and alumni (§29). Placement officer
 * and administrator accounts are provisioned by an existing administrator, so
 * they are deliberately absent from this form and refused by the API.
 */
export function RegisterPage() {
  const { register, user, status } = useAuthStore();
  const navigate = useNavigate();

  const [role, setRole] = React.useState<UserRole>(UserRole.STUDENT);
  const [error, setError] = React.useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (status === 'authenticated' && user) {
    return <Navigate to={ROLE_HOME_ROUTE[user.role]} replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      fullName: String(form.get('fullName') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
      role,
      department: String(form.get('department') ?? '').trim() || undefined,
    };

    if (role === UserRole.STUDENT) {
      payload.rollNumber = String(form.get('rollNumber') ?? '').trim() || undefined;
      payload.batch = String(form.get('batch') ?? '').trim() || undefined;
      const year = String(form.get('graduationYear') ?? '').trim();
      if (year) payload.graduationYear = Number(year);
    } else {
      payload.company = String(form.get('company') ?? '').trim();
      payload.designation = String(form.get('designation') ?? '').trim();
      payload.domain = String(form.get('domain') ?? '').trim();
      const years = String(form.get('experienceYears') ?? '').trim();
      if (years) payload.experienceYears = Number(years);
      const gradYear = String(form.get('graduationYearAlumni') ?? '').trim();
      if (gradYear) payload.graduationYearAlumni = Number(gradYear);
    }

    try {
      const created = await register(payload);
      navigate(ROLE_HOME_ROUTE[created.role], { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught : null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl space-y-6 py-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Compass className="size-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && (
              <Alert variant="danger" title="Registration failed">
                <p>{error.message}</p>
                {error.details && error.details.length > 0 && (
                  <ul className="mt-1 list-inside list-disc">
                    {error.details.map((detail) => (
                      <li key={detail.path}>
                        {detail.path}: {detail.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}

            <Field label="I am a" htmlFor="role" required>
              <Select id="role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value={UserRole.STUDENT}>Student</option>
                <option value={UserRole.ALUMNI}>Alumni mentor</option>
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="fullName" required error={error?.fieldError('fullName')}>
                <Input id="fullName" name="fullName" required minLength={2} autoComplete="name" />
              </Field>

              <Field label="Email address" htmlFor="email" required error={error?.fieldError('email')}>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </Field>
            </div>

            <Field
              label="Password"
              htmlFor="password"
              required
              error={error?.fieldError('password')}
              hint="At least 10 characters, including an uppercase letter, a lowercase letter and a digit."
            >
              <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
            </Field>

            <Field label="Department" htmlFor="department" error={error?.fieldError('department')}>
              <Input id="department" name="department" placeholder="Computer Science" />
            </Field>

            {role === UserRole.STUDENT ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Roll number" htmlFor="rollNumber">
                  <Input id="rollNumber" name="rollNumber" placeholder="CS21B001" />
                </Field>
                <Field label="Batch" htmlFor="batch">
                  <Input id="batch" name="batch" placeholder="2021-2025" />
                </Field>
                <Field label="Graduation year" htmlFor="graduationYear">
                  <Input id="graduationYear" name="graduationYear" type="number" min={1980} max={2100} placeholder="2025" />
                </Field>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Current company" htmlFor="company" required error={error?.fieldError('company')}>
                    <Input id="company" name="company" required placeholder="Amazon" />
                  </Field>
                  <Field label="Designation" htmlFor="designation" required>
                    <Input id="designation" name="designation" required placeholder="Software Engineer" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Domain" htmlFor="domain" required>
                    <Input id="domain" name="domain" required placeholder="Software Engineering" />
                  </Field>
                  <Field label="Years of experience" htmlFor="experienceYears">
                    <Input id="experienceYears" name="experienceYears" type="number" min={0} max={60} />
                  </Field>
                  <Field label="Graduation year" htmlFor="graduationYearAlumni">
                    <Input id="graduationYearAlumni" name="graduationYearAlumni" type="number" min={1950} max={2100} />
                  </Field>
                </div>

                <Alert variant="info" title="Verification required">
                  <p>
                    Alumni accounts are reviewed by an administrator before you appear in mentor searches. You can
                    complete your profile immediately; mentoring unlocks once your employment is verified.
                  </p>
                </Alert>
              </>
            )}

            <Button type="submit" className="w-full" loading={submitting}>
              Create account
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already registered?{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
