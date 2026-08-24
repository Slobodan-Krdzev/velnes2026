import type { ReactNode } from 'react';

export function AppShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--v-font)',
        background: 'var(--v-bg)',
        color: 'var(--v-text)',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <main
        style={{
          background: 'var(--v-surface)',
          borderRadius: 'var(--v-radius)',
          padding: '2rem 2.5rem',
          boxShadow: '0 1px 4px rgba(0,0,0,.08)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{title}</h1>
        {children}
      </main>
    </div>
  );
}
