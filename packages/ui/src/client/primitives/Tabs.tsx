import React, { createContext, useContext } from "react";

interface TabsContextValue {
  value: string;
  onChange: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(componentName: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`${componentName} must be used inside <Tabs>`);
  }
  return ctx;
}

export interface TabsProps {
  value: string;
  onChange: (v: string) => void;
  children?: React.ReactNode;
}

function TabsRoot({ value, onChange, children }: TabsProps) {
  return <TabsContext.Provider value={{ value, onChange }}>{children}</TabsContext.Provider>;
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

function TabsList({ children, className, ...rest }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={["flex gap-1 border-b border-edge", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
  children?: React.ReactNode;
}

function TabsTab({ value, children, className, onClick, ...rest }: TabsTabProps) {
  const ctx = useTabsContext("Tabs.Tab");
  const active = ctx.value === value;
  const stateClasses = active
    ? "text-gold-500 border-b-2 border-gold-500 -mb-px"
    : "text-ash hover:text-bone border-b-2 border-transparent";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={["px-4 py-2 font-sans text-[12px] font-medium", stateClasses, className]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        ctx.onChange(value);
        if (onClick) onClick(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabsPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  children?: React.ReactNode;
}

function TabsPanel({ value, children, ...rest }: TabsPanelProps) {
  const ctx = useTabsContext("Tabs.Panel");
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" {...rest}>
      {children}
    </div>
  );
}

type TabsCompound = typeof TabsRoot & {
  List: typeof TabsList;
  Tab: typeof TabsTab;
  Panel: typeof TabsPanel;
};

const Tabs = TabsRoot as TabsCompound;
Tabs.List = TabsList;
Tabs.Tab = TabsTab;
Tabs.Panel = TabsPanel;

export { Tabs };
