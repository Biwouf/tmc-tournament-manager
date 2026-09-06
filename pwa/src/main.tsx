import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { SessionQueryProvider } from './contexts/SessionQueryProvider';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SessionQueryProvider>
          <App />
        </SessionQueryProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
