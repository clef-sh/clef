import React from "react";

function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface TableProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

const TableRoot = React.forwardRef<HTMLDivElement, TableProps>(function Table(
  { className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        "bg-ink-850 border border-edge rounded-card overflow-hidden",
        className,
      )}
      {...rest}
    >
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
});

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  className?: string;
  children?: React.ReactNode;
}

function TableHeader({ className, children, ...rest }: TableHeaderProps) {
  return (
    <thead className={joinClasses("bg-ink-800 border-b border-edge", className)} {...rest}>
      {children}
    </thead>
  );
}

export interface TableHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  className?: string;
  children?: React.ReactNode;
}

function TableHeaderCell({ className, children, ...rest }: TableHeaderCellProps) {
  return (
    <th
      className={joinClasses(
        "px-5 py-3 font-sans text-[11px] font-semibold text-ash-dim uppercase tracking-[0.08em] text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
  tone?: "drift";
  className?: string;
  children?: React.ReactNode;
}

function TableRow({ interactive, tone, className, children, ...rest }: TableRowProps) {
  const interactiveClasses = interactive ? "hover:bg-ink-800 cursor-pointer transition-colors" : "";
  const toneClasses = tone === "drift" ? "shadow-[inset_4px_0_0_0_var(--color-stop-500)]" : "";
  return (
    <tr
      className={joinClasses(
        "border-b border-edge last:border-0",
        interactiveClasses,
        toneClasses,
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  className?: string;
  children?: React.ReactNode;
}

function TableCell({ className, children, ...rest }: TableCellProps) {
  return (
    <td className={joinClasses("px-5 py-3 font-sans text-[12px] text-bone", className)} {...rest}>
      {children}
    </td>
  );
}

type TableCompound = typeof TableRoot & {
  Header: typeof TableHeader;
  Row: typeof TableRow;
  HeaderCell: typeof TableHeaderCell;
  Cell: typeof TableCell;
};

const Table = TableRoot as TableCompound;
Table.Header = TableHeader;
Table.Row = TableRow;
Table.HeaderCell = TableHeaderCell;
Table.Cell = TableCell;

export { Table };
