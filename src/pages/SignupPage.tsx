import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setBusy(true);
    try {
      await signup(username.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-primary)]">
      <form
        onSubmit={handleSubmit}
        className="term-panel flex flex-col w-[340px] p-5 gap-3"
      >
        <div className="border-b border-[var(--border-primary)] pb-2 mb-1">
          <h2 className="text-[var(--accent)] glow text-base font-normal">
            tchat signup
          </h2>
          <span className="text-[var(--text-muted)] text-[10px]">
            create a new account
          </span>
        </div>
        {error && (
          <div
            role="alert"
            data-testid="auth-error"
            className="border border-[var(--error)]/40 bg-[var(--error)]/10 px-2.5 py-1.5 text-[var(--error)] text-xs"
          >
            {error}
          </div>
        )}
        <div className="border border-[var(--warning,#b58900)]/40 bg-[var(--warning,#b58900)]/10 px-2.5 py-2 text-[var(--warning,#b58900)] text-[11px] leading-relaxed">
          This app is still in beta and going through rapid server-side changes.
          Your login data may be gone — just register again for now.
          You can create any number of accounts.
        </div>
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
          username
        </label>
        <input
          type="text"
          placeholder="user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="px-2.5 py-2 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
          password
        </label>
        <input
          type="password"
          placeholder="at least 8 chars"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="px-2.5 py-2 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
          confirm
        </label>
        <input
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="px-2.5 py-2 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-1 px-2.5 py-2 border border-[var(--accent)] text-[var(--accent)] text-sm cursor-pointer hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
        >
          {busy ? "[ registering… ]" : "[ register ]"}
        </button>
        <p className="text-center text-[10px] text-[var(--text-muted)] mt-1">
          already have an account?{" "}
          <Link to="/login" className="text-[var(--accent)] hover:underline">
            log in
          </Link>
        </p>
      </form>
    </div>
  );
}
