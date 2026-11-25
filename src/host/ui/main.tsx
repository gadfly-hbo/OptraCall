import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './workspace-visual.css';
import './visual-refresh-settings.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
