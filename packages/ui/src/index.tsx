import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import './primitives.css';

/** Minimal centered shell — used by the placeholder apps until their
 *  own build phases (employee 6, booking 7, supplier 10, hq 8). */
export function AppShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font)',
        background: 'var(--surface-muted)',
        color: 'var(--ink)',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <main className="card" style={{ padding: '2rem 2.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function Button({
  variant = 'primary',
  size,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm';
}) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`.trim()}
      {...rest}
    />
  );
}

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string | undefined;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'accent';
}) {
  return <span className={`badge${tone ? ` badge-${tone}` : ''}`}>{children}</span>;
}
