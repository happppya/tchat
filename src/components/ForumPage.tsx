import { useState, useEffect, useCallback, useRef } from "react";
import type { ForumPost } from "../types";
import { fetchForumPosts, searchForumPosts, createForumPost } from "../services/api";

interface Props {
  groupChatId: number;
  gcName: string;
  onSelectPost: (postId: number) => void;
}

type SortMode = "recent" | "date" | "alpha";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "recent", label: "recently active" },
  { value: "date", label: "date posted" },
  { value: "alpha", label: "alphabetical" },
];

/**
 * Forum list view: a search/new-post bar at the top, sort controls, and a
 * scrollable list of rows — one per thread. Clicking a row opens that post.
 */
export default function ForumPage({ groupChatId, gcName, onSelectPost }: Props) {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (searchQ?: string) => {
    setLoading(true);
    setError("");
    try {
      let list: ForumPost[];
      if (searchQ && searchQ.trim()) {
        list = await searchForumPosts(groupChatId, searchQ.trim());
      } else {
        list = await fetchForumPosts(groupChatId, sort);
      }
      setPosts(list);
    } catch (err) {
      setError("Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [groupChatId, sort]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (value: string) => {
    setQuery(value);
    clearTimeout(searchTimer.current);
    if (composing) {
      setNewTitle(value);
    } else {
      searchTimer.current = setTimeout(() => load(value), 200);
    }
  };

  const handleSortChange = (s: SortMode) => {
    setSort(s);
    // reload will happen via useEffect
  };

  const handleNewPostClick = () => {
    setComposing(true);
    setNewTitle(query);
    setNewContent("");
    setError("");
  };

  const handleCancelCompose = () => {
    setComposing(false);
    setNewTitle("");
    setNewContent("");
    setError("");
    load(query);
  };

  const handleSendPost = async () => {
    if (!newTitle.trim()) return;
    setSending(true);
    setError("");
    try {
      const post = await createForumPost(groupChatId, newTitle.trim(), newContent.trim());
      setComposing(false);
      setNewTitle("");
      setNewContent("");
      setQuery("");
      // Open the new post immediately
      onSelectPost(post.id);
    } catch (err: any) {
      setError(err?.message || "Failed to create post");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <span className="text-[var(--accent)]">~</span>
        <span className="text-[var(--text-primary)] text-sm">{gcName}</span>
        <span className="text-[var(--text-muted)] text-xs">— forum</span>
        <span
          data-testid="forum-post-count"
          className="text-[var(--text-muted)] text-xs"
        >
          — {posts.length} post{posts.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Search / compose bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        {composing && (
          <button
            onClick={handleCancelCompose}
            title="Cancel new post"
            className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs border-none bg-transparent cursor-pointer px-1"
          >
            ✕
          </button>
        )}
        <input
          type="text"
          value={composing ? newTitle : query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => {
            if (composing && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendPost();
            }
          }}
          placeholder={composing ? "Post title…" : "search or create a post…"}
          className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        {!composing ? (
          <button
            onClick={handleNewPostClick}
            className="text-xs border border-[var(--accent)] text-[var(--accent)] bg-transparent px-3 py-1.5 cursor-pointer hover:bg-[var(--accent)]/10 transition-colors whitespace-nowrap"
          >
            new post
          </button>
        ) : (
          <button
            onClick={handleSendPost}
            disabled={sending || !newTitle.trim()}
            className="text-xs border border-[var(--accent)] text-[var(--accent)] bg-transparent px-3 py-1.5 cursor-pointer hover:bg-[var(--accent)]/10 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-default"
          >
            {sending ? "posting…" : "send post"}
          </button>
        )}
      </div>

      {/* Content textarea when composing */}
      {composing && (
        <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="enter content…"
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none"
            rows={4}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border-b border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-[var(--error)] text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-[var(--error)] text-xs cursor-pointer bg-transparent border-none">✕</button>
        </div>
      )}

      {/* Sort controls */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-x-auto">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSortChange(opt.value)}
            className={`text-xs px-2 py-0.5 border cursor-pointer transition-colors whitespace-nowrap ${
              sort === opt.value
                ? "border-[var(--accent)] text-[var(--accent-light)] bg-[var(--accent)]/10"
                : "border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Post list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">
            loading posts…
          </div>
        )}
        {!loading && posts.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
            {query.trim() ? "No posts match your search." : "No posts yet. Create the first one!"}
          </div>
        )}
        {posts.map((post) => (
          <button
            key={post.id}
            onClick={() => onSelectPost(post.id)}
            data-testid="forum-post-row"
            className="w-full text-left px-3 py-2.5 border-b border-[var(--border-primary)]/50 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer bg-transparent border-x-0 border-t-0 last:border-b-0"
          >
            <div className="text-sm text-[var(--text-primary)] font-semibold truncate">
              {post.title}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
              {post.content.slice(0, 120)}
              {post.content.length > 120 ? "…" : ""}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-muted)]">
              <span>{post.display_name}</span>
              <span>{typeof post.reply_count === "number" ? `${post.reply_count} repl${post.reply_count === 1 ? "y" : "ies"}` : ""}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}