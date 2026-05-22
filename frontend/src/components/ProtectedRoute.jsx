import React, { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * ProtectedRoute
 * Checks /api/auth/me — if not logged in, redirects to /login.
 * Shows a minimal loading screen while the check is in flight.
 */
export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const [status, setStatus] = useState('checking'); // 'checking' | 'ok' | 'unauthorized'

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          setStatus(data.loggedIn ? 'ok' : 'unauthorized');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthorized');
      });

    return () => { cancelled = true; };
  }, []);

  if (status === 'checking') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)',
        fontFamily: "'Inter', system-ui, sans-serif",
        flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid rgba(99,102,241,0.2)',
          borderTopColor: '#6366f1',
          animation: 'spin 0.7s linear infinite',
        }} />
        <p style={{ color: 'rgba(148,163,184,0.7)', fontSize: '0.9rem', margin: 0 }}>
          Loading…
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (status === 'unauthorized') {
    // Preserve the intended destination so we can redirect back after login if needed
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
