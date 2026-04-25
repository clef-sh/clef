import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Toolbar } from "./Toolbar";

describe("Toolbar", () => {
  it("renders title, subtitle, and actions", () => {
    render(
      <Toolbar data-testid="toolbar">
        <div>
          <Toolbar.Title>Secret Matrix</Toolbar.Title>
          <Toolbar.Subtitle>3 namespaces</Toolbar.Subtitle>
        </div>
        <Toolbar.Actions>
          <button>Lint All</button>
        </Toolbar.Actions>
      </Toolbar>,
    );
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Secret Matrix" })).toBeInTheDocument();
    expect(screen.getByText("3 namespaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lint All" })).toBeInTheDocument();
  });

  it("title uses upgraded type tier classes", () => {
    render(
      <Toolbar>
        <Toolbar.Title>Hello</Toolbar.Title>
      </Toolbar>,
    );
    const heading = screen.getByRole("heading", { name: "Hello" });
    expect(heading.className).toContain("text-[20px]");
    expect(heading.className).toContain("font-semibold");
    expect(heading.className).toContain("text-bone");
  });

  it("actions wrapper applies flex gap classes", () => {
    render(
      <Toolbar>
        <Toolbar.Actions data-testid="acts">
          <button>a</button>
          <button>b</button>
        </Toolbar.Actions>
      </Toolbar>,
    );
    const wrap = screen.getByTestId("acts");
    expect(wrap.className).toContain("flex");
    expect(wrap.className).toContain("gap-2");
  });
});
