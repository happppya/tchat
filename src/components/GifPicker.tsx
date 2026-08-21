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
    <div className="absolute bottom-full mb-2 right-0 w-60 h-80 p-2.5 bg-white border border-gray-300 rounded-xl shadow-lg overflow-hidden">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearch}
        placeholder="Search GIFs..."
        className="w-full box-border px-2.5 py-2 border border-gray-300 rounded-md outline-none mb-2 text-sm"
      />

      <div className="grid grid-cols-2 gap-1.5 h-[260px] overflow-y-auto">
        {loading && (
          <p className="col-span-2 text-center text-gray-400 text-sm py-4">
            Loading...
          </p>
        )}
        {!loading && results.length === 0 && (
          <p className="col-span-2 text-center text-gray-400 text-sm py-4">
            No GIFs found
          </p>
        )}
        {results.map((gif) => (
          <img
            key={gif.id}
            src={gif.images.fixed_width_small.url}
            alt={gif.title || "GIF"}
            className="w-full h-20 object-cover rounded-md cursor-pointer hover:opacity-80"
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