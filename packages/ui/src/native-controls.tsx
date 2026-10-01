import type { ComponentProps, ReactNode } from "react";

export function Button({ type = "button", className = "", ...props }: ComponentProps<"button">) {
  return <button {...props} type={type} className={`oi-button ${className}`} />;
}

type FieldLabels = { id: string; label: string; description?: string; error?: string };
function descriptions(id: string, description?: string, error?: string, external?: string) {
  return (
    [external, description ? `${id}-description` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined
  );
}
function FieldText({
  id,
  label,
  description,
  error,
  children,
}: FieldLabels & { children: ReactNode }) {
  return (
    <div className="oi-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {description && (
        <p id={`${id}-description`} className="oi-help">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="oi-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  id,
  label,
  description,
  error,
  className = "",
  ...props
}: FieldLabels & Omit<ComponentProps<"input">, "id">) {
  return (
    <FieldText
      {...{ id, label }}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
    >
      <input
        {...props}
        id={id}
        className={`oi-input ${className}`}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={descriptions(id, description, error, props["aria-describedby"])}
      />
    </FieldText>
  );
}

export function SelectField({
  id,
  label,
  description,
  error,
  className = "",
  children,
  ...props
}: FieldLabels & Omit<ComponentProps<"select">, "id">) {
  return (
    <FieldText
      {...{ id, label }}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
    >
      <select
        {...props}
        id={id}
        className={`oi-input ${className}`}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={descriptions(id, description, error, props["aria-describedby"])}
      >
        {children}
      </select>
    </FieldText>
  );
}

export function Disclosure({
  summary,
  children,
  initiallyOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  return (
    <details className="oi-disclosure" open={initiallyOpen}>
      <summary>{summary}</summary>
      <div className="oi-disclosure-content">{children}</div>
    </details>
  );
}
