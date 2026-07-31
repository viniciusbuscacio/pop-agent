import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyFontSize, useFontStore } from './store/font';
import { applyTheme, useThemeStore } from './store/theme';
import './styles/index.css';

// index.html already set the theme before the first paint; this keeps the
// store and the document in step once React takes over.
applyTheme(useThemeStore.getState().choice);
applyFontSize(useFontStore.getState().choice);

const container = document.getElementById('root');
if (container === null) throw new Error('index.html must provide #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
