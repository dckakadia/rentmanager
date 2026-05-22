import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Eye, EyeOff, LogIn, Lock, User, AlertCircle } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        navigate('/', { replace: true });
      } else {
        setError(data.error || 'Invalid credentials. Please try again.');
      }
    } catch (err) {
      setError('Unable to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '20%',
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '15%',
        width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 420, position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24,
        padding: '2.5rem',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64,
            background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
            borderRadius: 18,
            boxShadow: '0 8px 32px rgba(99,102,241,0.4)',
            marginBottom: '1.25rem',
          }}>
            <Building2 size={32} color="white" />
          </div>
          <h1 style={{
            margin: 0, fontSize: '1.6rem', fontWeight: 800,
            color: '#f8fafc', letterSpacing: '-0.02em',
          }}>
            RentManager
          </h1>
          <p style={{
            margin: '0.4rem 0 0', fontSize: '0.85rem', fontWeight: 500,
            color: 'rgba(148,163,184,0.9)',
          }}>
            Sign in to manage your properties
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 12, padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            animation: 'shake 0.3s ease',
          }}>
            <AlertCircle size={16} color="#f87171" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', color: '#fca5a5', fontWeight: 500 }}>
              {error}
            </span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Username */}
          <div>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 700,
              color: 'rgba(148,163,184,0.9)', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: '0.5rem',
            }}>
              Username
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)',
                color: 'rgba(100,116,139,0.8)',
              }}>
                <User size={16} />
              </div>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                autoComplete="username"
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: '0.85rem 0.9rem 0.85rem 2.6rem',
                  color: '#f1f5f9', fontSize: '0.95rem',
                  outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(99,102,241,0.6)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label style={{
              display: 'block', fontSize: '0.78rem', fontWeight: 700,
              color: 'rgba(148,163,184,0.9)', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: '0.5rem',
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)',
                color: 'rgba(100,116,139,0.8)',
              }}>
                <Lock size={16} />
              </div>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: '0.85rem 3rem 0.85rem 2.6rem',
                  color: '#f1f5f9', fontSize: '0.95rem',
                  outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(99,102,241,0.6)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                style={{
                  position: 'absolute', right: '0.9rem', top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'rgba(100,116,139,0.8)', padding: '0.2rem',
                  display: 'flex', alignItems: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(100,116,139,0.8)'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.6rem', marginTop: '0.5rem',
              background: loading
                ? 'rgba(99,102,241,0.5)'
                : 'linear-gradient(135deg, #6366f1, #4f46e5)',
              color: 'white', border: 'none', borderRadius: 12,
              padding: '0.95rem', fontSize: '0.95rem', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 4px 24px rgba(99,102,241,0.4)',
              transition: 'all 0.2s', letterSpacing: '0.01em',
              transform: loading ? 'none' : 'translateY(0)',
            }}
            onMouseEnter={e => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(99,102,241,0.5)';
              }
            }}
            onMouseLeave={e => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 24px rgba(99,102,241,0.4)';
              }
            }}
          >
            {loading ? (
              <>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white',
                  animation: 'spin 0.6s linear infinite',
                }} />
                Signing in…
              </>
            ) : (
              <>
                <LogIn size={18} />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p style={{
          textAlign: 'center', marginTop: '1.75rem', marginBottom: 0,
          fontSize: '0.78rem', color: 'rgba(100,116,139,0.6)',
        }}>
          Secured with encrypted session · Credentials stored in .env only
        </p>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-4px); }
          40%, 80% { transform: translateX(4px); }
        }
        input::placeholder { color: rgba(100,116,139,0.5); }
      `}</style>
    </div>
  );
}
