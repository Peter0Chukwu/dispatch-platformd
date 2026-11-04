import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerCustomerSchema, type RegisterCustomerInput } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function RegisterCustomerPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterCustomerInput>({
    resolver: zodResolver(registerCustomerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', password: '', acceptTerms: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const response = await api.post<{
        message: string;
        verification: { devToken?: string; devCode?: string };
      }>('/auth/register/customer', values, { skipAuthRefresh: true });
      navigate('/verify', {
        state: { email: values.email, phone: values.phone, verification: response.verification },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.userMessage);
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof RegisterCustomerInput, { message });
        }
      } else {
        setFormError('Could not create your account.');
      }
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Book a rider in minutes and track every package in real time."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login?portal=customer" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {formError && (
        <div className="mb-4">
          <Alert tone="danger" title="Could not create your account">
            {formError}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" placeholder="Ada" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" placeholder="Okafor" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Phone number"
          placeholder="0803 123 4567"
          hint="Nigerian mobile number — we text you a 6-digit code"
          inputMode="tel"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          hint="Mix upper and lower case letters with at least one number"
          error={errors.password?.message}
          {...register('password')}
        />

        <label className="flex items-start gap-2.5 text-sm text-ink-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300" {...register('acceptTerms')} />
          <span>
            I agree to the Terms of Service and Privacy Policy, including the processing of my delivery data.
          </span>
        </label>
        {errors.acceptTerms && <p className="text-xs font-medium text-danger-600">{errors.acceptTerms.message}</p>}

        <Button type="submit" variant="accent" size="lg" fullWidth isLoading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
