import { useCallback, useEffect, useState } from 'react';
import { GamePage } from './components/GamePage';
import { Lobby } from './components/Lobby';

/** Two routes, so a tiny history-API router is enough: "/" and "/g/:code". */
function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate] as const;
}

export function App() {
  const [path, navigate] = usePath();
  const match = path.match(/^\/g\/([A-Za-z0-9]{4,12})\/?$/);
  if (match) {
    const code = match[1].toUpperCase();
    return <GamePage key={code} code={code} navigate={navigate} />;
  }
  return <Lobby navigate={navigate} />;
}
