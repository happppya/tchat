/** A forum post / thread. */
export interface ForumPost {
  id: number;
  group_chat_id: number;
  title: string;
  content: string;
  author_id: number;
  display_name: string;
  created_at: string;
  updated_at: string;
  reply_count?: number;
}
