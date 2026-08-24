import { API_PREFIX, HealthResponseSchema, type HealthResponse } from '@velnes/contracts';
import { AppShell } from '@velnes/ui';
import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_PREFIX}/health`)
      .then((res) => res.json())
      .then((data: unknown) => setHealth(HealthResponseSchema.parse(data)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'failed'));
  }, []);

  return (
    <AppShell title="Velnes HQ">
      {health ? (
        <p>
          API {health.status} · v{health.version} · {health.time}
        </p>
      ) : error ? (
        <p>API unreachable: {error}</p>
      ) : (
        <p>Checking API…</p>
      )}
    </AppShell>
  );
}
