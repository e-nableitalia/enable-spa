// ========================================
// GLOBAL MESSAGES
// /messages/{id}
// ========================================

export interface GlobalMessage {
  id: string;
  title: string;
  body: string;
  target: "all" | "volunteer" | "admin";
  createdAt: unknown;
  expiresAt?: unknown;
  active: boolean;
}

// ========================================
// PERSONAL MESSAGES
// /users/{uid}/messages/{id}
// ========================================

export interface PersonalMessage {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: unknown;
}

// ========================================
// ENRICHED MESSAGE (frontend UI type)
// Merges global + personal for display
// ========================================

export interface EnrichedMessage {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: unknown;
  type: "global" | "personal";
}
