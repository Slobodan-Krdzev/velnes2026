import './styles/prototype.css';
// Deliberate departures from the prototype, after the design review.
import './styles/overrides.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
