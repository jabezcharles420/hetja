import type { ReactNode } from "react";
import styles from "./CompareTable.module.css";

/**
 * Apple "compare models" columns (Sidehoe `.compare`): a glyph, a name and a
 * one-liner on top, then N rows of { bold claim, grey detail }.
 *
 * Each column is its own grid item spanning all rows with
 * `grid-template-rows: subgrid`, so row K lines up across columns even when
 * one column's copy wraps to three lines, without a <table> forcing
 * row-major DOM order. Reading order stays column-by-column (Hetja, then
 * NGOs, then "Doing nothing"), which is how people actually read these, and
 * `rowLabels` adds a visually-hidden row name to each cell so a screen
 * reader hears "Records: Append-only ledger", not just the claim.
 */

export interface CompareCell {
  bold: ReactNode;
  detail?: ReactNode;
}

export interface CompareColumn {
  id: string;
  glyph?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  cells: CompareCell[];
}

export interface CompareTableProps {
  columns: CompareColumn[];
  /** Hidden per-row names read before each cell. */
  rowLabels?: string[];
  /** Heading level for column titles. Default 3. */
  level?: 2 | 3 | 4;
  /** Prefix for heading ids; set it when two tables share a page. */
  idPrefix?: string;
  className?: string;
}

export function CompareTable({
  columns,
  rowLabels,
  level = 3,
  idPrefix = "cmp",
  className,
}: CompareTableProps): React.JSX.Element {
  const rows = Math.max(0, ...columns.map((c) => c.cells.length));
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div
      className={`${styles.compare} ${className ?? ""}`}
      style={{ "--cols": columns.length, "--rows": rows + 1 } as React.CSSProperties}
    >
      {columns.map((col) => (
        <div key={col.id} role="group" className={styles.col} aria-labelledby={`${idPrefix}-${col.id}`}>
          <div className={`${styles.cell} ${styles.top}`}>
            {col.glyph ? (
              <div className={styles.glyph} aria-hidden="true">
                {col.glyph}
              </div>
            ) : null}
            <Heading id={`${idPrefix}-${col.id}`} className={styles.title}>
              {col.title}
            </Heading>
            {col.subtitle ? <p className={styles.subtitle}>{col.subtitle}</p> : null}
          </div>
          {Array.from({ length: rows }, (_, r) => {
            const cell = col.cells[r];
            return (
              <div key={r} className={styles.cell}>
                {cell ? (
                  <>
                    {rowLabels?.[r] ? <span className="h-sr-only">{rowLabels[r]}: </span> : null}
                    <b>{cell.bold}</b>
                    {cell.detail ? <span>{cell.detail}</span> : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
