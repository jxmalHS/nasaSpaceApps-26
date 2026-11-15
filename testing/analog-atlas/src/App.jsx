import { lazy, Suspense, useEffect } from 'react';
import { Share2, Compass } from 'lucide-react';
import { usePath, Link } from './lib/router.jsx';
import { useStore, setState, shareUrl } from './lib/store.js';
import { Mark, Toaster, toast } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Tour from './components/Tour.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const Explore = lazy(() => import('./pages/Explore.jsx'));
const Compare = lazy(() => import('./pages/Compare.jsx'));
const Report = lazy(() => import('./pages/Report.jsx'));
const Trust = lazy(() => import('./pages/Trust.jsx'));

const NAV = [['/explore', 'Explore'], ['/compare', 'Compare'], ['/trust', 'Trust']];

export default function App() {
  const path = usePath();
  const tourStep = useStore((s) => s.tourStep);
  const page = path.startsWith('/explore') ? <Explore /> : path.startsWith('/compare') ? <Compare /> : path.startsWith('/report') ? <Report />
    : path.startsWith('/trust') ? <Trust /> : path === '/' ? <Home /> : <NotFound />;
  const appMode = path !== '/';
  useEffect(() => { document.body.classList.toggle('app-mode', appMode && !path.startsWith('/report') && !path.startsWith('/trust')); }, [appMode, path]);

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Analog Atlas home"><Mark /> <span>Analog Atlas</span></Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label]) => <Link key={to} to={to} aria-current={path.startsWith(to) ? 'page' : undefined}>{label}</Link>)}
        </nav>
        <div className="spacer" />
        {path.startsWith('/explore') && (
          <button className="btn btn-ghost btn-sm" onClick={() => setState({ tourStep: 0 })} data-tour-anchor="tour"><Compass size={15} /> <span className="hide-sm">Tour</span></button>
        )}
        {appMode && (
          <button className="btn btn-sm" onClick={async () => {
            const url = shareUrl();
            try { await navigator.clipboard.writeText(url); toast('Link copied: it restores this exact view'); } catch { prompt('Copy this link', url); }
          }}><Share2 size={15} /> <span className="hide-sm">Share view</span></button>
        )}
      </header>
      <ErrorBoundary key={path}><Suspense fallback={<div className="page-loading" role="status"><span className="spinner" /> Loading…</div>}>{page}</Suspense></ErrorBoundary>
      {tourStep != null && path.startsWith('/explore') && <Tour />}
      <Toaster />
    </>
  );
}

function NotFound() {
  return (
    <main id="main" className="empty" style={{ minHeight: '60vh', alignContent: 'center' }}>
      <h1 style={{ fontSize: 40 }}>No site at these coordinates.</h1>
      <p className="dim">This page does not exist. The atlas does.</p>
      <Link className="btn btn-primary" to="/explore">Open the atlas</Link>
    </main>
  );
}
