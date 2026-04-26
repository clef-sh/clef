import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Table } from "./Table";

describe("Table", () => {
  it("renders header cells and body cells", () => {
    render(
      <Table data-testid="tbl">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Name</Table.HeaderCell>
            <Table.HeaderCell>Env</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <tbody>
          <Table.Row>
            <Table.Cell>auth</Table.Cell>
            <Table.Cell>prod</Table.Cell>
          </Table.Row>
        </tbody>
      </Table>,
    );
    expect(screen.getByTestId("tbl")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
  });

  it("applies interactive classes to rows when interactive prop set", () => {
    render(
      <Table>
        <tbody>
          <Table.Row interactive data-testid="row">
            <Table.Cell>x</Table.Cell>
          </Table.Row>
        </tbody>
      </Table>,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("hover:bg-ink-800");
    expect(row.className).toContain("cursor-pointer");
  });

  it("applies drift tone shadow class", () => {
    render(
      <Table>
        <tbody>
          <Table.Row tone="drift" data-testid="row">
            <Table.Cell>drifted</Table.Cell>
          </Table.Row>
        </tbody>
      </Table>,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("shadow-[inset_4px_0_0_0_var(--color-stop-500)]");
  });
});
