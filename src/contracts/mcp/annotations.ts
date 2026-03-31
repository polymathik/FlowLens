export interface Annotation {
  id: string;
  entity_id: string;
  text: string;
  category: 'convention' | 'decision' | 'warning' | 'todo';
  author: string;
  created_at: string;
  updated_at: string;
}
