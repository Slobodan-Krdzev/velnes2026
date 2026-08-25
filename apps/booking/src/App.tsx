import { createI18n } from '@velnes/i18n';
import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { BookingFlow } from './BookingFlow.js';

function BySlug() {
  const { slug } = useParams();
  return <BookingFlow slug={slug ?? null} pk={null} source="link" />;
}
function ByKey() {
  const [sp] = useSearchParams();
  return <BookingFlow slug={null} pk={sp.get('pk')} source="widget" />;
}

export function App() {
  const i18n = useMemo(() => createI18n('en'), []);
  return (
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <Routes>
          <Route path="/book/:slug" element={<BySlug />} />
          <Route path="/w" element={<ByKey />} />
          <Route path="*" element={<Navigate to="/book/velnes-fizio" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nextProvider>
  );
}
