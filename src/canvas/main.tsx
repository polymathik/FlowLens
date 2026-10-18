import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/tokens.css';
import './styles/canvas.css';
import './styles/zones.css';
import './styles/focus.css';
import './styles/flow.css';
import './styles/explorer.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
