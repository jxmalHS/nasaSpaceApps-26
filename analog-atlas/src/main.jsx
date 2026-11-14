import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/base.css';
import './styles/components.css';
import './styles/home.css';
import './styles/app.css';
import { hydrateFromUrl } from './lib/store.js';
import App from './App.jsx';

hydrateFromUrl();
createRoot(document.getElementById('root')).render(<App />);
