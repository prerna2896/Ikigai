import type { WeekNote } from '@ikigai/core';

export type ReflectionCategoryId =
  | 'on_mind'
  | 'helped'
  | 'hindered'
  | 'lessons'
  | 'check_in';

export type ParsedReflectionNote = {
  id: string;
  categoryId: ReflectionCategoryId | null;
  emoji: string | null;
  text: string;
  tags: string[];
  createdAt: string;
};

const ALL_CATEGORY_IDS: ReflectionCategoryId[] = [
  'on_mind',
  'helped',
  'hindered',
  'lessons',
  'check_in',
];

const isCategoryId = (value: unknown): value is ReflectionCategoryId =>
  typeof value === 'string' &&
  ALL_CATEGORY_IDS.includes(value as ReflectionCategoryId);

type EncodeOptions = {
  emoji?: string | null;
  tags?: string[];
};

export const encodeReflectionNote = (
  categoryId: ReflectionCategoryId,
  text: string,
  options: EncodeOptions = {},
): string => {
  const payload: Record<string, unknown> = { categoryId, text };
  if (options.emoji) payload.emoji = options.emoji;
  if (options.tags && options.tags.length > 0) payload.tags = options.tags;
  return JSON.stringify(payload);
};

export const decodeReflectionNote = (note: WeekNote): ParsedReflectionNote => {
  const fallback: ParsedReflectionNote = {
    id: note.id,
    categoryId: null,
    emoji: null,
    text: note.note,
    tags: [],
    createdAt: note.createdAt,
  };
  if (!note.note) return fallback;
  try {
    const parsed = JSON.parse(note.note) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'categoryId' in parsed &&
      'text' in parsed
    ) {
      const candidateId = (parsed as { categoryId: unknown }).categoryId;
      const candidateText = (parsed as { text: unknown }).text;
      const candidateEmoji = (parsed as { emoji?: unknown }).emoji;
      const candidateTags = (parsed as { tags?: unknown }).tags;
      if (isCategoryId(candidateId) && typeof candidateText === 'string') {
        return {
          id: note.id,
          categoryId: candidateId,
          emoji:
            typeof candidateEmoji === 'string' && candidateEmoji.length > 0
              ? candidateEmoji
              : null,
          text: candidateText,
          tags:
            Array.isArray(candidateTags) &&
            candidateTags.every((t) => typeof t === 'string')
              ? (candidateTags as string[])
              : [],
          createdAt: note.createdAt,
        };
      }
    }
  } catch {
    // Not JSON — treat as legacy/free-form note.
  }
  return fallback;
};

export const reflectionCategoryLabel = (
  id: ReflectionCategoryId | null,
): string => {
  switch (id) {
    case 'on_mind':
      return 'On your mind';
    case 'helped':
      return 'What helped';
    case 'hindered':
      return 'What got in the way';
    case 'lessons':
      return 'Lessons';
    case 'check_in':
      return 'Check-in';
    default:
      return 'Note';
  }
};

export const formatReflectionTimestamp = (iso: string): string => {
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};
