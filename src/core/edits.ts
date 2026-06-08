/**
 * edits.ts — shared engine for:
 *   • parsing model output into edit operations (new-file OR search/replace),
 *   • applying search/replace edits to existing content SAFELY (fail loud,
 *     never silently truncate),
 *   • computing line-level diffs for the review UI,
 *   • a real line-level 3-way merge (used by the merge engine).
 *
 * Design rule: an edit that can't be located is REJECTED, never guessed. This
 * is what prevents the "/* …existing… *\/ replaced the whole file" class of bug.
 */

export type EditKind = 'create' | 'replace';

export interface EditOp {
  path: string;
  kind: EditKind;
  /** For 'replace'. */
  search?: string;
  replace?: string;
  /** For 'create' (whole-file). */
  content?: string;
}

export interface AppliedOp {
  index: number;
  kind: EditKind;
  ok: boolean;
  reason?: string;            // why it failed (anchor not found, etc.)
  search?: string;
  replace?: string;
  /** match strategy that succeeded, for transparency */
  matched?: 'exact' | 'whitespace' | 'whole-file';
}

export interface AppliedFile {
  path: string;
  before: string;             // content before edits ('' if new file)
  after: string;              // content after applying the OK ops
  isNew: boolean;
  ops: AppliedOp[];
  failedCount: number;
  hunks: DiffHunk[];          // line diff before -> after, for display
}

export interface DiffLine { type: 'ctx' | 'add' | 'del'; text: string; }
export interface DiffHunk { beforeStart: number; afterStart: number; lines: DiffLine[]; }

// ─── parsing ──────────────────────────────────────────────────────────────

const FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;
const PATH_RE = /^(?:#|\/\/)\s*path:\s*(.+)$/;
const SR_BLOCK_RE =
  /<{5,}\s*SEARCH\s*\n([\s\S]*?)\n={5,}\s*\n([\s\S]*?)\n>{5,}\s*REPLACE/g;

/**
 * Parse assistant text into edit operations.
 *   - A fenced block whose first line is `# path: X` / `// path: X`:
 *       · if it contains SEARCH/REPLACE markers → one 'replace' op per marker
 *       · otherwise → a single 'create' op (whole file)
 */
export function parseEdits(text: string): EditOp[] {
  const ops: EditOp[] = [];
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const body = m[1];
    const lines = body.split('\n');
    const pm = lines[0].trim().match(PATH_RE);
    if (!pm) continue;
    const path = pm[1].trim();
    const rest = lines.slice(1).join('\n');

    const srOps: EditOp[] = [];
    let sr: RegExpExecArray | null;
    SR_BLOCK_RE.lastIndex = 0;
    while ((sr = SR_BLOCK_RE.exec(rest)) !== null) {
      srOps.push({ path, kind: 'replace', search: sr[1], replace: sr[2] });
    }

    if (srOps.length) {
      ops.push(...srOps);
    } else {
      // whole-file create/replace
      ops.push({ path, kind: 'create', content: stripTrailingNewline(rest) });
    }
  }
  return ops;
}

function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

// ─── applying (fail-safe) ───────────────────────────────────────────────────

/** Collapse runs of whitespace + trim each line — for tolerant matching. */
function normalize(s: string): string {
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').trim();
}

/**
 * Find `search` inside `content`. Tries exact first, then a whitespace-tolerant
 * line match. Returns the [start,end) char range in `content`, or null.
 */
function locate(content: string, search: string): { start: number; end: number; how: 'exact' | 'whitespace' } | null {
  if (search.length === 0) return null;
  const exact = content.indexOf(search);
  if (exact !== -1) return { start: exact, end: exact + search.length, how: 'exact' };

  // whitespace-tolerant: match the sequence of normalized lines
  const cLines = content.split('\n');
  const sLines = search.split('\n').filter((_, i, a) => !(i === a.length - 1 && a[i] === ''));
  const sNorm = sLines.map(l => l.replace(/\s+/g, ' ').trim());
  for (let i = 0; i + sNorm.length <= cLines.length; i++) {
    let ok = true;
    for (let j = 0; j < sNorm.length; j++) {
      if (cLines[i + j].replace(/\s+/g, ' ').trim() !== sNorm[j]) { ok = false; break; }
    }
    if (ok) {
      const start = cLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const matchedText = cLines.slice(i, i + sNorm.length).join('\n');
      return { start, end: start + matchedText.length, how: 'whitespace' };
    }
  }
  return null;
}

/**
 * Apply ops grouped by path to the given current contents.
 * `currentByPath` maps path -> current content; absence means the file is new.
 * NEVER throws on a bad op; failed ops are reported and skipped, leaving the
 * rest of the file intact.
 */
export function applyEdits(ops: EditOp[], currentByPath: Map<string, string>): AppliedFile[] {
  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    if (!byPath.has(op.path)) byPath.set(op.path, []);
    byPath.get(op.path)!.push(op);
  }

  const results: AppliedFile[] = [];
  for (const [path, fileOps] of byPath) {
    const isNew = !currentByPath.has(path);
    const before = currentByPath.get(path) ?? '';
    let working = before;
    const applied: AppliedOp[] = [];
    let idx = 0;
    let failed = 0;

    for (const op of fileOps) {
      if (op.kind === 'create') {
        // Whole-file. Allowed for NEW files always; for EXISTING files only if
        // it doesn't look elided (guard against the placeholder bug).
        const content = op.content ?? '';
        if (!isNew && looksElided(content, before)) {
          applied.push({ index: idx, kind: 'create', ok: false,
            reason: 'whole-file replacement looks truncated/elided — refused to avoid data loss' });
          failed++;
        } else {
          working = content;
          applied.push({ index: idx, kind: 'create', ok: true, matched: 'whole-file' });
        }
      } else {
        const search = op.search ?? '';
        const replace = op.replace ?? '';
        const loc = locate(working, search);
        if (!loc) {
          applied.push({ index: idx, kind: 'replace', ok: false,
            reason: 'could not locate the SEARCH anchor in the current file',
            search, replace });
          failed++;
        } else {
          working = working.slice(0, loc.start) + replace + working.slice(loc.end);
          applied.push({ index: idx, kind: 'replace', ok: true, matched: loc.how, search, replace });
        }
      }
      idx++;
    }

    results.push({
      path, before, after: working, isNew, ops: applied, failedCount: failed,
      hunks: diffLines(before, working),
    });
  }
  return results;
}

/** Re-apply only a chosen subset of ops (by index) — for per-hunk accept/reject. */
export function applySelected(
  ops: EditOp[], currentByPath: Map<string, string>, acceptedIndexByPath: Map<string, Set<number>>
): AppliedFile[] {
  // Reconstruct global indices the same way the UI saw them: ops are numbered
  // per-file in original order.
  const byPath = new Map<string, EditOp[]>();
  for (const op of ops) {
    if (!byPath.has(op.path)) byPath.set(op.path, []);
    byPath.get(op.path)!.push(op);
  }
  const chosen: EditOp[] = [];
  for (const [path, fileOps] of byPath) {
    const accepted = acceptedIndexByPath.get(path);
    fileOps.forEach((op, i) => {
      if (!accepted || accepted.has(i)) chosen.push(op);
    });
  }
  return applyEdits(chosen, currentByPath);
}

/**
 * Heuristic: does a proposed whole-file replacement look like the model elided
 * the original (placeholders, or suspiciously shorter than what it replaces)?
 */
export function looksElided(proposed: string, current: string): boolean {
  const placeholderRe =
    /(\/\*|#|\/\/|<!--)\s*\.{2,}\s*(existing|rest|unchanged|previous|original|same as before|your)|(\bexisting (code|styles|content)\b)|(\brest of (the )?(file|code)\b)|(\.\.\.\s*(rest|existing|unchanged))/i;
  if (placeholderRe.test(proposed)) return true;
  // Big shrink against a non-trivial original is suspicious.
  if (current.length > 400 && proposed.length < current.length * 0.5) return true;
  return false;
}

// ─── line diff (for review display) ─────────────────────────────────────────

/** Longest-common-subsequence over lines → grouped hunks with 2 ctx lines. */
export function diffLines(before: string, after: string, ctx = 2): DiffHunk[] {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  const ops = lcsDiff(a, b); // sequence of {type, text, ai, bi}

  // group into hunks separated by long runs of context
  const hunks: DiffHunk[] = [];
  let cur: DiffLine[] = [];
  let pendingCtx: DiffLine[] = [];
  let beforeStart = 0, afterStart = 0, started = false;
  let ai = 0, bi = 0, curBeforeStart = 0, curAfterStart = 0;

  const flush = () => {
    if (cur.length) {
      hunks.push({ beforeStart: curBeforeStart, afterStart: curAfterStart, lines: cur });
    }
    cur = []; started = false;
  };

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === 'ctx') {
      if (started) {
        // keep up to `ctx` trailing context, then decide whether to flush
        pendingCtx.push(op);
        if (pendingCtx.length > ctx * 2) {
          // close this hunk with `ctx` trailing context
          cur.push(...pendingCtx.slice(0, ctx));
          pendingCtx = [];
          flush();
        }
      } else {
        pendingCtx.push(op);
        if (pendingCtx.length > ctx) pendingCtx.shift();
      }
      ai++; bi++;
    } else {
      if (!started) {
        // open a hunk with up to `ctx` leading context
        const lead = pendingCtx.slice(-ctx);
        curBeforeStart = ai - lead.length;
        curAfterStart = bi - lead.length;
        cur.push(...lead);
        pendingCtx = [];
        started = true;
      } else if (pendingCtx.length) {
        cur.push(...pendingCtx);
        pendingCtx = [];
      }
      cur.push({ type: op.type, text: op.text });
      if (op.type === 'del') ai++; else bi++;
    }
  }
  if (started) { cur.push(...pendingCtx.slice(0, ctx)); flush(); }
  return hunks;
}

interface LcsOp { type: 'ctx' | 'add' | 'del'; text: string; }
function lcsDiff(a: string[], b: string[]): LcsOp[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: LcsOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

// ─── 3-way line merge (used by the merge engine) ────────────────────────────

export interface Merge3Result { ok: boolean; text: string; conflicts: number; }

/** A change region against base: replace base[start,end) with `lines`. */
interface Hunk { start: number; end: number; lines: string[]; }

function hunksFromDiff(baseLines: string[], sideLines: string[]): Hunk[] {
  const ops = lcsDiff(baseLines, sideLines);
  const hunks: Hunk[] = [];
  let bi = 0;
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op.type === 'ctx') {
      if (cur) { hunks.push(cur); cur = null; }
      bi++;
    } else if (op.type === 'del') {
      if (!cur) cur = { start: bi, end: bi, lines: [] };
      cur.end = bi + 1; bi++;
    } else { // add
      if (!cur) cur = { start: bi, end: bi, lines: [] };
      cur.lines.push(op.text);
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

function hunkOverlap(a: Hunk, b: Hunk): boolean {
  if (a.start < b.end && b.start < a.end) return true;          // ranges overlap
  if (a.start === a.end && b.start === b.end && a.start === b.start) return true; // both insert same point
  if (a.start === a.end && a.start >= b.start && a.start < b.end) return true;    // a inserts inside b
  if (b.start === b.end && b.start >= a.start && b.start < a.end) return true;    // b inserts inside a
  return false;
}

/** Apply a set of (sorted, in-range) hunks over base[s,e). */
function reconstruct(base: string[], hunks: Hunk[], s: number, e: number): string[] {
  const res: string[] = [];
  let p = s;
  for (const h of hunks) { res.push(...base.slice(p, h.start)); res.push(...h.lines); p = h.end; }
  res.push(...base.slice(p, e));
  return res;
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Line-level 3-way merge. Non-overlapping changes from BOTH sides are combined
 * cleanly (regardless of where in the file they are); overlapping changes
 * become a localized conflict block (not the whole file).
 */
export function merge3(base: string, ours: string, theirs: string,
                       labels = { ours: 'target', theirs: 'source' }): Merge3Result {
  if (ours === theirs) return { ok: true, text: ours, conflicts: 0 };
  if (ours === base) return { ok: true, text: theirs, conflicts: 0 };
  if (theirs === base) return { ok: true, text: ours, conflicts: 0 };

  const B = base.length ? base.split('\n') : [];
  const ourH = hunksFromDiff(B, ours.length ? ours.split('\n') : []);
  const theirH = hunksFromDiff(B, theirs.length ? theirs.split('\n') : []);

  const out: string[] = [];
  let i = 0, oi = 0, ti = 0, conflicts = 0;

  while (i < B.length || oi < ourH.length || ti < theirH.length) {
    const oStart = oi < ourH.length ? ourH[oi].start : Infinity;
    const tStart = ti < theirH.length ? theirH[ti].start : Infinity;
    const next = Math.min(oStart, tStart);

    if (i < next && i < B.length) { out.push(B[i]); i++; continue; }

    const oh = oi < ourH.length ? ourH[oi] : null;
    const th = ti < theirH.length ? theirH[ti] : null;

    if (oh && th && hunkOverlap(oh, th)) {
      // Take the two triggering hunks first (guarantees pointer progress), then
      // greedily swallow any further hunks overlapping the growing region.
      const oTaken: Hunk[] = [oh], tTaken: Hunk[] = [th];
      let s = Math.min(oh.start, th.start);
      let e = Math.max(oh.end, th.end);
      oi++; ti++;
      const inRegion = (h: Hunk) =>
        (h.start < e && h.end > s) || (h.start === h.end && h.start >= s && h.start <= e);
      let grew = true;
      while (grew) {
        grew = false;
        while (oi < ourH.length && inRegion(ourH[oi])) {
          s = Math.min(s, ourH[oi].start); e = Math.max(e, ourH[oi].end); oTaken.push(ourH[oi]); oi++; grew = true;
        }
        while (ti < theirH.length && inRegion(theirH[ti])) {
          s = Math.min(s, theirH[ti].start); e = Math.max(e, theirH[ti].end); tTaken.push(theirH[ti]); ti++; grew = true;
        }
      }
      if (s === e) {
        // Both sides only INSERTED at the same point (no base lines replaced).
        // Keep both contributions (ours then theirs) rather than conflicting —
        // this is the common "both branches appended something" case.
        const ol = oTaken.flatMap(h => h.lines);
        const tl = tTaken.flatMap(h => h.lines);
        if (sameLines(ol, tl)) out.push(...ol);
        else out.push(...ol, ...tl);
      } else {
        const ourLines = reconstruct(B, oTaken, s, e);
        const theirLines = reconstruct(B, tTaken, s, e);
        if (sameLines(ourLines, theirLines)) {
          out.push(...ourLines);
        } else {
          conflicts++;
          out.push(`<<<<<<< ${labels.ours}`, ...ourLines, '=======', ...theirLines, `>>>>>>> ${labels.theirs}`);
        }
      }
      i = e;
    } else if (oStart <= tStart && oh) {
      out.push(...oh.lines); i = oh.end; oi++;
    } else if (th) {
      out.push(...th.lines); i = th.end; ti++;
    } else if (i < B.length) {
      out.push(B[i]); i++;
    } else break;
  }

  return { ok: conflicts === 0, text: out.join('\n'), conflicts };
}