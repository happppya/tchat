import { useState, useCallback } from "react";
import type { GiphyResult, SelectedGif } from "../types";
import { searchGifs } from "../services/api";

/**
 * Manages GIF search state and selection.
 */
export function useGifSearch() {
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedGif | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchGifs(query);
      setResults(data.data ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback((gif: GiphyResult) => {
    setSelected({ id: gif.id, url: gif.images.original.url });
  }, []);

  const clear = useCallback(() => {
    setSelected(null);
  }, []);

  return { results, loading, selected, search, select, clear };
}