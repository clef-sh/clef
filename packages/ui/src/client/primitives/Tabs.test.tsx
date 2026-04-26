import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Tabs } from "./Tabs";

function Harness({ initial = "a" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <Tabs value={v} onChange={setV}>
      <Tabs.List>
        <Tabs.Tab value="a">A</Tabs.Tab>
        <Tabs.Tab value="b">B</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="a">panel-a-content</Tabs.Panel>
      <Tabs.Panel value="b">panel-b-content</Tabs.Panel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows active panel and active tab class", () => {
    render(<Harness initial="a" />);
    expect(screen.getByText("panel-a-content")).toBeInTheDocument();
    expect(screen.queryByText("panel-b-content")).not.toBeInTheDocument();
    const tabA = screen.getByRole("tab", { name: "A" });
    expect(tabA.className).toContain("text-gold-500");
    expect(tabA).toHaveAttribute("aria-selected", "true");
  });

  it("switches panels when a tab is clicked", () => {
    render(<Harness initial="a" />);
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByText("panel-b-content")).toBeInTheDocument();
    expect(screen.queryByText("panel-a-content")).not.toBeInTheDocument();
  });

  it("inactive tab uses non-active classes", () => {
    render(<Harness initial="a" />);
    const tabB = screen.getByRole("tab", { name: "B" });
    expect(tabB.className).toContain("text-ash");
    expect(tabB.className).toContain("border-transparent");
    expect(tabB).toHaveAttribute("aria-selected", "false");
  });
});
