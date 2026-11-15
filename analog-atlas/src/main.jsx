import { installTooltips } from './lib/tooltip.js';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/base.css';
import './styles/components.css';
import './styles/home.css';
import './styles/app.css';
import { hydrateFromUrl } from './lib/store.js';
import App from './App.jsx';

// Native buttons with radio semantics share the standard arrow-key interaction.
document.addEventListener('keydown',e=>{
  const radio=e.target.closest?.('button[role="radio"]'), group=radio?.closest('[role="radiogroup"]');
  if(!group||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const options=[...group.querySelectorAll('button[role="radio"]:not(:disabled)')];
  const next=e.key==='Home'?0:e.key==='End'?options.length-1:(options.indexOf(radio)+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+options.length)%options.length;
  e.preventDefault();options[next].focus();options[next].click();
});
const disposeTooltips = installTooltips();
if (import.meta.hot) import.meta.hot.dispose(disposeTooltips);
hydrateFromUrl();
createRoot(document.getElementById('root')).render(<App />);
