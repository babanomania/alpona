import { useState } from 'react';
import { KeyRound, Loader2, LogIn } from 'lucide-react';
import { login } from '../auth.js';

/**
 * The studio login. Shown when the server reports an auth mode other than
 * "none" and no valid token is held. Accounts are provisioned by the CLI
 * (`alpona-db user add`) — there is no signup here by design.
 */
export function Login({ authUrl, onSignedIn }: { authUrl: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    const result = await login(authUrl, email.trim(), password);
    setBusy(false);
    if (result.ok) onSignedIn();
    else setError(result.error);
  };

  return (
    <div className="login">
      <div className="login__card">
        <span className="login__glyph" aria-hidden>
          আলপনা
        </span>
        <h1>Sign in to Alpona</h1>
        <p className="login__sub">Use the account your administrator created for you.</p>
        <label className="login__field">
          <span>Email</span>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </label>
        <label className="login__field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </label>
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn btn--primary login__submit"
          disabled={busy || !email.trim() || !password}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 size={16} className="composer__spin" /> : <LogIn size={16} />}
          Sign in
        </button>
        <p className="login__hint">
          <KeyRound size={12} /> Trouble signing in? Contact your administrator.
        </p>
      </div>
    </div>
  );
}
