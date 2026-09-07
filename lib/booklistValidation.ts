import { guessCategory } from './booklistUpload';
import type { ItemCategory } from '../types/db';

/**
 * One rule about author/publisher, in one place.
 *
 * A school booklist that says only "New General Mathematics" names a
 * book that four publishers print in six editions. Shops guess, quote
 * the cheapest thing matching the words, and a parent pays for the wrong
 * edition — which is the bug this file exists to close.
 */

export const AUTHOR_PLACEHOLDER = 'Author / Publisher (e.g. A.O. Kalejaiye, Evans)';

export const AUTHOR_REQUIRED_MESSAGE =
  'Author or publisher is required to avoid incorrect quotes.';

export const TITLE_REQUIRED_MESSAGE = 'Give this line a title, or remove it.';

/** Shape every booklist form has, whatever else it carries. */
export interface ValidatableLine {
  title: string;
  author: string;
  /** Known on parsed lines; derived from the title when it is not. */
  category?: ItemCategory;
}

/**
 * Which lines need an author, and which genuinely cannot have one.
 *
 * "2 dozen exercise books" and "white school socks" have no author, and
 * blocking a parent's whole booklist over a field that cannot be filled
 * would be worse than the wrong-edition problem this is fixing. So
 * stationery and uniform are exempt; everything that could be a book is
 * not.
 */
export function authorRequiredFor(line: ValidatableLine): boolean {
  const title = line.title.trim();
  if (!title) return false;
  const category = line.category ?? guessCategory(title);
  return category !== 'stationery' && category !== 'uniform';
}

export type LineProblem = 'title' | 'author' | null;

/**
 * What is wrong with this line, if anything.
 *
 * A completely blank line is not a problem — it is an empty row the
 * buyer has not filled in yet, and forms drop those on submit rather
 * than complaining about them.
 */
export function lineProblem(line: ValidatableLine): LineProblem {
  const title = line.title.trim();
  const author = line.author.trim();
  if (!title) return author ? 'title' : null;
  return authorRequiredFor(line) && !author ? 'author' : null;
}

export interface LinesVerdict {
  /** Safe to submit: at least one usable line and no line missing a field. */
  ok: boolean;
  /** Lines with a title, which is what actually gets saved. */
  filled: number;
  /** Ids/keys of lines whose author is missing but required. */
  missingAuthor: string[];
  /** Ids/keys of lines with an author but no title. */
  missingTitle: string[];
  /** One sentence for the form's error banner, or null when ok. */
  message: string | null;
}

/**
 * Validate a whole form. `keyOf` says how a line is identified, so the
 * caller can highlight exactly the inputs that need attention.
 */
export function validateLines<T extends ValidatableLine>(
  lines: T[],
  keyOf: (line: T) => string
): LinesVerdict {
  const missingAuthor: string[] = [];
  const missingTitle: string[] = [];
  let filled = 0;

  for (const line of lines) {
    if (line.title.trim()) filled += 1;
    const problem = lineProblem(line);
    if (problem === 'author') missingAuthor.push(keyOf(line));
    if (problem === 'title') missingTitle.push(keyOf(line));
  }

  let message: string | null = null;
  if (missingTitle.length) {
    message = TITLE_REQUIRED_MESSAGE;
  } else if (missingAuthor.length) {
    message =
      missingAuthor.length === 1
        ? AUTHOR_REQUIRED_MESSAGE
        : `${missingAuthor.length} lines still need an author or publisher. ${AUTHOR_REQUIRED_MESSAGE}`;
  }

  return {
    ok: filled > 0 && missingAuthor.length === 0 && missingTitle.length === 0,
    filled,
    missingAuthor,
    missingTitle,
    message,
  };
}
