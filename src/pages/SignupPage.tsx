import { useState } from "react";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      console.error("Passwords do not match");
      return;
    }
    // TODO: Implement authentication
    console.log("Signup attempted:", username, email);
  };

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-primary)]">
      <form
        onSubmit={handleSignUp}
        className="flex flex-col w-[300px] p-4 border border-[var(--border-primary)] rounded-xl gap-1.5 bg-[var(--bg-secondary)]"
      >
        <h2 className="text-[var(--text-primary)] text-lg font-semibold mb-2 text-center">
          Sign Up
        </h2>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <input
          type="email"
          placeholder="Email Address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <input
          type="password"
          placeholder="Confirm Password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <button
          type="submit"
          className="mt-2 px-2 py-2 border border-[var(--accent-light)] rounded-md bg-[var(--accent-light)] text-[#2a2a35] text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
        >
          Sign Up
        </button>
      </form>
    </div>
  );
}