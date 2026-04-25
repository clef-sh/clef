import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Field, Input, Textarea } from "./Field";

describe("Field", () => {
  it("renders label and child input", () => {
    render(
      <Field label="Name">
        <Input placeholder="enter name" />
      </Field>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("enter name")).toBeInTheDocument();
  });

  it("shows hint when provided and no error", () => {
    render(
      <Field label="Pattern" hint="regex string">
        <Input />
      </Field>,
    );
    expect(screen.getByText("regex string")).toBeInTheDocument();
  });

  it("shows error and hides hint when error present", () => {
    render(
      <Field label="URL" hint="https://...." error="invalid URL">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("invalid URL");
    expect(screen.queryByText("https://....")).not.toBeInTheDocument();
  });

  it("renders required asterisk when required", () => {
    render(
      <Field label="Required field" required>
        <Textarea />
      </Field>,
    );
    expect(screen.getByText(/Required field/)).toBeInTheDocument();
    const star = screen.getByText("*");
    expect(star.className).toContain("text-stop-500");
  });
});
