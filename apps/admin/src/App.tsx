import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { io } from 'socket.io-client';
import { API_ORIGIN, api, session, setOnSignedOut } from './api';
import { Bookings } from './pages/Bookings';
import { Helpers } from './pages/Helpers';
import { Audit } from './pages/Audit';
import { Categories } from './pages/Categories';
import { Disputes } from './pages/Disputes';
import { Customers } from './pages/Customers';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Settings } from './pages/Settings';

/** The Sibimate mark, drawn for dark grounds. */
export function Mark({ width = 36 }: { width?: number }) {
  return (
    <svg role="img" aria-label="Sibimate" width={width} height={(width * 32) / 44} viewBox="0 0 44 32">
      <circle cx="16" cy="16" r="14" fill="#F4B321" />
      <circle cx="28" cy="16" r="14" fill="none" stroke="#FFFFFF" strokeWidth="4" />
    </svg>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(() => session.get() !== null);

  useEffect(() => {
    setOnSignedOut(() => {
      queryClient.clear();
      setSignedIn(false);
    });
  }, [queryClient]);

  // Live updates: the lists refresh the moment a task or a helper changes.
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const socket = io(API_ORIGIN, { transports: ['websocket'], auth: (send) => send({ adminToken: session.get() }) });
    for (const name of ['profile.changed', 'applications.changed']) {
      socket.on(name, () => {
        void queryClient.invalidateQueries({ queryKey: ['applications'] });
        void queryClient.invalidateQueries({ queryKey: ['helpers'] });
      });
    }
    socket.on('task.changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['helpers'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [signedIn, queryClient]);

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: signedIn });

  if (!signedIn) {
    return <Login onSignedIn={() => setSignedIn(true)} />;
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    session.clear();
    queryClient.clear();
    setSignedIn(false);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <span className="wordmark">sibimate</span>
        </div>
        <nav className="nav" aria-label="Admin">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/bookings">Bookings</NavLink>
          <NavLink to="/disputes">Disputes</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/helpers">Helpers</NavLink>
          <NavLink to="/categories">Categories</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {me.data?.role === 'owner' ? <NavLink to="/audit">Audit log</NavLink> : null}
        </nav>
        <div className="sidebar-foot">
          {me.data ? (
            <span>
              {me.data.email} · {me.data.role}
            </span>
          ) : null}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/helpers" element={<Helpers />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
