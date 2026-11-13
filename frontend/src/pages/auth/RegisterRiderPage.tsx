import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerRiderSchema, type RegisterRiderInput, NIGERIAN_STATES } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Button, Input, Select } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

const VEHICLES = [
  { value: 'MOTORCYCLE', label: 'Motorcycle (okada)' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'TRICYCLE', label: 'Tricycle (keke)' },
  { value: 'CAR', label: 'Car' },
  { value: 'VAN', label: 'Van' },
];

export default function RegisterRiderPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterRiderInput>({
    resolver: zodResolver(registerRiderSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      addressLine: '',
      city: 'Benin City',
      state: 'Edo',
      vehicleType: 'MOTORCYCLE',
      vehicleRegistrationNumber: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      acceptTerms: true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const response = await api.post<{ message: string; riderCode?: string; verification: { devToken?: string } }>(
        '/auth/register/rider',
        values,
        { skipAuthRefresh: true },
      );
      navigate('/verify', {
        state: { email: values.email, phone: values.phone, verification: response.verification, rider: true },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.userMessage);
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof RegisterRiderInput, { message });
        }
      } else {
        setFormError('Could not submit your application.');
      }
    }
  });

  return (
    <AuthLayout
      title="Apply to ride with us"
      subtitle="Tell us about you and your vehicle. An administrator reviews every application."
      footer={
        <>
          Already applied?{' '}
          <Link to="/login?portal=rider" className="font-semibold text-brand-700 hover:underline">
            Sign in to your rider account
          </Link>
        </>
      }
    >
      <div className="mb-4">
        <Alert tone="info" title="What happens next">
          Verify your email and phone, then upload your ID, driver's licence and vehicle papers in the rider portal.
          You stay <strong>offline</strong> until an administrator approves you.
        </Alert>
      </div>

      {formError && (
        <div className="mb-4">
          <Alert tone="danger" title="Could not submit your application">
            {formError}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input label="Email address" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="Phone number" placeholder="0803 123 4567" error={errors.phone?.message} {...register('phone')} />
        <Input
          label="Password"
          type="password"
          hint="At least 8 characters with upper, lower case and a number"
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Residential address"
          placeholder="12 Adesuwa Road, GRA, Benin City"
          error={errors.addressLine?.message}
          {...register('addressLine')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="City" error={errors.city?.message} {...register('city')} />
          <Select
            label="State"
            options={NIGERIAN_STATES.map((state) => ({ value: state, label: state }))}
            error={errors.state?.message}
            {...register('state')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Vehicle type" options={VEHICLES} error={errors.vehicleType?.message} {...register('vehicleType')} />
          <Input
            label="Plate number"
            placeholder="KJA 123 XY"
            error={errors.vehicleRegistrationNumber?.message}
            {...register('vehicleRegistrationNumber')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Emergency contact"
            placeholder="Full name"
            error={errors.emergencyContactName?.message}
            {...register('emergencyContactName')}
          />
          <Input
            label="Their phone number"
            placeholder="0803 000 0000"
            error={errors.emergencyContactPhone?.message}
            {...register('emergencyContactPhone')}
          />
        </div>
        <label className="flex items-start gap-2.5 text-sm text-ink-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300" {...register('acceptTerms')} />
          <span>I confirm the information is accurate and accept the rider agreement and commission terms.</span>
        </label>
        {errors.acceptTerms && <p className="text-xs font-medium text-danger-600">{errors.acceptTerms.message}</p>}

        <Button type="submit" variant="accent" size="lg" fullWidth isLoading={isSubmitting}>
          Submit application
        </Button>
      </form>
    </AuthLayout>
  );
}
