import { useState, useEffect, useRef } from "react";
import { useGifSearch } from "../hooks/useGifSearch";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectGif: (url: string) => void;
}

export default function GifPicker({ isOpen, onClose, onSelectGif }: Props) {
  const { results, loading, search } = useGifSearch();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-search trending on open
  useEffect(() => {
    if (isOpen) {
      search("trending");
      inputRef.current?.focus();
    }
  }, [isOpen, search]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search(query.trim());
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-full mb-2 right-0 w-64 h-80 p-2.5 term-panel shadow-2xl overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[var(--accent)] text-xs select-none">{"~>"}</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearch}
          placeholder="search gifs…"
          className="flex-1 box-border px-1.5 py-1.5 border-b border-[var(--border-primary)] bg-transparent text-[var(--text-primary)] text-sm outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 flex-1 overflow-y-auto">
        {loading && (
          <p className="col-span-2 text-center text-[var(--text-muted)] text-sm py-4">
            loading…
          </p>
        )}
        {!loading && results.length === 0 && (
          <p className="col-span-2 text-center text-[var(--text-muted)] text-sm py-4">
            no gifs found
          </p>
        )}
        {results.map((gif) => (
          <img
            key={gif.id}
            src={gif.images.fixed_width_small.url}
            alt={gif.title || "GIF"}
            className="w-full h-20 object-cover cursor-pointer border border-[var(--border-primary)] hover:border-[var(--accent)] hover:opacity-80 transition-all"
            onClick={() => {
              onSelectGif(gif.images.original.url);
              onClose();
            }}
          />
        ))}
      </div>
    </div>
  );
}
