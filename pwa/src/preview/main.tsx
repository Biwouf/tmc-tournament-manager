import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LivePreview from './live';
import '../index.css';
import './live.css';

createRoot(document.getElementById('root')!).render(<StrictMode><LivePreview /></StrictMode>);
