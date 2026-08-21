import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement authentication
    console.log("Login attempted:", username);
  };

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-primary)]">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col w-[300px] p-4 border border-[var(--border-primary)] rounded-xl gap-1.5 bg-[var(--bg-secondary)]"
      >
        <h2 className="text-[var(--text-primary)] text-lg font-semibold mb-2 text-center">
          Log In
        </h2>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-2 border border-[var(--border-primary)] rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none"
        />
        <button
          type="submit"
          className="mt-2 px-2 py-2 border border-[var(--accent-light)] rounded-md bg-[var(--accent-light)] text-[#2a2a35] text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
        >
          Log In
        </button>
      </form>
    </div>
  );
}