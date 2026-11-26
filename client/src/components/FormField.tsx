import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../utils/format';

const CONTROL =
  'w-full rounded-lg border-[1.5px] border-line-strong bg-white px-3.5 text-body-md text-ink placeholder:text-sage transition-colors focus:border-forest focus:outline-none disabled:bg-parchment-alt disabled:text-sage aria-[invalid=true]:border-danger';

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  id: string;
  required?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

function FieldShell({ label, error, hint, id, required, children, className }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label-md text-slate">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-body-sm text-sage">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  leading?: ReactNode;
  containerClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, error, hint, leading, className, containerClassName, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fieldId} required={required} className={containerClassName}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-terracotta">{leading}</span>}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          required={required}
          className={cn(CONTROL, 'h-12', Boolean(leading) && 'pl-10', className)}
          {...rest}
        />
      </div>
    </FieldShell>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string | undefined; hint?: ReactNode; containerClassName?: string };

export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField(
  { label, error, hint, className, containerClassName, id, required, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fieldId} required={required} className={containerClassName}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        required={required}
        className={cn(
          CONTROL,
          'h-12 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23718077%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")] bg-[length:18px] bg-[right_12px_center] bg-no-repeat pr-10',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | undefined; hint?: ReactNode; containerClassName?: string };

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextareaProps>(function TextAreaField(
  { label, error, hint, className, containerClassName, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fieldId} required={required} className={containerClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        required={required}
        className={cn(CONTROL, 'min-h-24 py-3', className)}
        {...rest}
      />
    </FieldShell>
  );
});
