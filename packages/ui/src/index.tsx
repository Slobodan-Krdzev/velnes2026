import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export { EMP_COLORS, empColorOf, I, Icon, VelnesMark } from './icons.js';

/** Primitives emitting the prototype's exact class names — all
 *  styling comes from prototype.css (lifted verbatim). */

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger';
}) {
  const cls = variant === 'danger' ? 'btn btn-primary' : `btn btn-${variant}`;
  return (
    <button
      className={`${cls} ${className}`.trim()}
      style={variant === 'danger' ? { background: 'var(--danger)' } : undefined}
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

/** The prototype's field(): label > span + control (+ hint). */
export function Field({
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <span className="req">*</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="hint" style={{ color: 'var(--danger)', fontWeight: 600 }}>
          {error}
        </span>
      ) : null}
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
  return <span className={`badge${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** Minimal centered shell — used by the placeholder apps until their
 *  own build phases (employee 6, booking 7, supplier 10, hq 8). */
export function AppShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
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
