import { detectFormat, parseDotenv, parseJson, parseYaml, parse } from "./parsers";

describe("detectFormat", () => {
  it("detects .env by basename", () => {
    expect(detectFormat("/project/.env", "")).toBe("dotenv");
  });

  it("detects .env.local by basename prefix", () => {
    expect(detectFormat("/project/.env.local", "")).toBe("dotenv");
  });

  it("detects .env.production by basename prefix", () => {
    expect(detectFormat("/project/.env.production", "")).toBe("dotenv");
  });

  it("detects file.env by suffix", () => {
    expect(detectFormat("/project/secrets.env", "")).toBe("dotenv");
  });

  it("detects .json extension", () => {
    expect(detectFormat("/project/secrets.json", "{}")).toBe("json");
  });

  it("detects .yaml extension", () => {
    expect(detectFormat("/project/secrets.yaml", "")).toBe("yaml");
  });

  it("detects .yml extension", () => {
    expect(detectFormat("/project/secrets.yml", "")).toBe("yaml");
  });

  it("detects JSON from content starting with '{'", () => {
    expect(detectFormat("/project/unknown", '{"KEY": "val"}')).toBe("json");
  });

  it("detects JSON from content-based JSON.parse (non-array object)", () => {
    const content = '  \n{"KEY": "val"}';
    // Does NOT start with { after trimming in the startsWith check because of leading spaces
    // but the JSON.parse heuristic will catch it
    expect(detectFormat("/project/unknown", content)).toBe("json");
  });

  it("detects YAML from content-based YAML.parse (mapping)", () => {
    const content = "KEY: value\nANOTHER: thing\n";
    expect(detectFormat("/project/unknown", content)).toBe("yaml");
  });

  it("falls back to dotenv for unrecognized content", () => {
    expect(detectFormat("/project/unknown", "KEY=value\nOTHER=stuff")).toBe("dotenv");
  });

  it("does not classify JSON array as json (falls back)", () => {
    // an array starts with [ not { so content heuristic won't catch it as json
    // JSON.parse will succeed but it's an array — skip
    const content = "[1, 2, 3]";
    // Falls through all JSON/YAML checks, ends up as dotenv
    expect(detectFormat("/project/unknown", content)).toBe("dotenv");
  });

  it("handles empty file path gracefully", () => {
    expect(detectFormat("", "KEY=value")).toBe("dotenv");
  });
});

describe("parseDotenv", () => {
  it("parses simple KEY=VALUE", () => {
    const result = parseDotenv("DB_HOST=localhost\nDB_PORT=5432\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost", DB_PORT: "5432" });
    expect(result.format).toBe("dotenv");
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("strips comment lines starting with #", () => {
    const result = parseDotenv("# This is a comment\nDB_HOST=localhost\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost" });
  });

  it("ignores blank lines", () => {
    const result = parseDotenv("\n\nDB_HOST=localhost\n\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost" });
  });

  it("strips double quotes from values", () => {
    const result = parseDotenv('API_KEY="my-api-key"\n');
    expect(result.pairs).toEqual({ API_KEY: "my-api-key" });
  });

  it("strips single quotes from values", () => {
    const result = parseDotenv("API_KEY='my-api-key'\n");
    expect(result.pairs).toEqual({ API_KEY: "my-api-key" });
  });

  it("strips inline comments after ' #'", () => {
    const result = parseDotenv("DB_HOST=localhost # the database host\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost" });
  });

  it("strips export prefix", () => {
    const result = parseDotenv("export DB_HOST=localhost\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost" });
  });

  it("handles empty values", () => {
    const result = parseDotenv("EMPTY=\n");
    expect(result.pairs).toEqual({ EMPTY: "" });
  });

  it("handles values with = inside", () => {
    const result = parseDotenv("URL=https://example.com/path?a=1&b=2\n");
    expect(result.pairs).toEqual({ URL: "https://example.com/path?a=1&b=2" });
  });

  it("skips lines without = sign", () => {
    const result = parseDotenv("INVALID\nVALID=yes\n");
    expect(result.pairs).toEqual({ VALID: "yes" });
  });

  it("strips export prefix and then double quotes", () => {
    const result = parseDotenv('export KEY="value"\n');
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("does not strip mismatched quotes", () => {
    // starts with " but ends without matching " (has ')
    const result = parseDotenv("KEY=\"value'\n");
    expect(result.pairs).toEqual({ KEY: "\"value'" });
  });
});

describe("parseJson", () => {
  it("imports string values", () => {
    const result = parseJson('{"DB_HOST": "localhost", "DB_PORT": "5432"}');
    expect(result.pairs).toEqual({ DB_HOST: "localhost", DB_PORT: "5432" });
    expect(result.format).toBe("json");
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("skips number values with warning", () => {
    const result = parseJson('{"PORT": 5432}');
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["PORT"]);
    expect(result.warnings).toEqual(["PORT: skipped — value is number, not string"]);
  });

  it("skips boolean values with warning", () => {
    const result = parseJson('{"ENABLED": true}');
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["ENABLED"]);
    expect(result.warnings).toEqual(["ENABLED: skipped — value is boolean, not string"]);
  });

  it("skips null values with warning", () => {
    const result = parseJson('{"EMPTY": null}');
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["EMPTY"]);
    expect(result.warnings).toEqual(["EMPTY: skipped — value is null, not string"]);
  });

  it("skips nested object values with warning", () => {
    const result = parseJson('{"DB": {"host": "localhost"}}');
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["DB"]);
    expect(result.warnings).toEqual(["DB: skipped — value is nested object, not string"]);
  });

  it("skips array values with warning", () => {
    const result = parseJson('{"TAGS": ["a", "b"]}');
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["TAGS"]);
    expect(result.warnings).toEqual(["TAGS: skipped — value is array, not string"]);
  });

  it("throws for array root", () => {
    expect(() => parseJson('[{"key": "val"}]')).toThrow(
      "JSON root must be an object, not an array",
    );
  });

  it("throws for invalid JSON", () => {
    expect(() => parseJson("{not valid json}")).toThrow("Invalid JSON:");
  });

  it("handles mixed string and non-string values", () => {
    const result = parseJson('{"GOOD": "value", "BAD": 42}');
    expect(result.pairs).toEqual({ GOOD: "value" });
    expect(result.skipped).toEqual(["BAD"]);
  });
});

describe("parseYaml", () => {
  it("imports string values", () => {
    const result = parseYaml("DB_HOST: localhost\nDB_PORT: '5432'\n");
    expect(result.pairs).toEqual({ DB_HOST: "localhost", DB_PORT: "5432" });
    expect(result.format).toBe("yaml");
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("skips non-string values with warning (number)", () => {
    const result = parseYaml("PORT: 5432\n");
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["PORT"]);
    expect(result.warnings).toEqual(["PORT: skipped — value is number, not string"]);
  });

  it("skips non-string values with warning (boolean)", () => {
    const result = parseYaml("ENABLED: true\n");
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["ENABLED"]);
    expect(result.warnings).toEqual(["ENABLED: skipped — value is boolean, not string"]);
  });

  it("skips nested mapping with warning", () => {
    const result = parseYaml("DB:\n  host: localhost\n");
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["DB"]);
    expect(result.warnings).toEqual(["DB: skipped — value is nested object, not string"]);
  });

  it("skips sequence values with warning", () => {
    const result = parseYaml("TAGS:\n  - a\n  - b\n");
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["TAGS"]);
    expect(result.warnings).toEqual(["TAGS: skipped — value is array, not string"]);
  });

  it("throws for sequence root", () => {
    expect(() => parseYaml("- a\n- b\n")).toThrow("YAML root must be a mapping, not a sequence");
  });

  it("throws for invalid YAML", () => {
    expect(() => parseYaml("key: [unclosed")).toThrow("Invalid YAML:");
  });

  it("skips null values with warning", () => {
    const result = parseYaml("EMPTY: ~\n");
    expect(result.pairs).toEqual({});
    expect(result.skipped).toEqual(["EMPTY"]);
    expect(result.warnings).toEqual(["EMPTY: skipped — value is null, not string"]);
  });
});

describe("parse", () => {
  it("parses dotenv when format is 'dotenv'", () => {
    const result = parse("KEY=value\n", "dotenv");
    expect(result.format).toBe("dotenv");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("parses json when format is 'json'", () => {
    const result = parse('{"KEY": "value"}', "json");
    expect(result.format).toBe("json");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("parses yaml when format is 'yaml'", () => {
    const result = parse("KEY: value\n", "yaml");
    expect(result.format).toBe("yaml");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("auto-detects dotenv from file path", () => {
    const result = parse("KEY=value\n", "auto", "/project/.env");
    expect(result.format).toBe("dotenv");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("auto-detects json from file path", () => {
    const result = parse('{"KEY": "value"}', "auto", "/project/secrets.json");
    expect(result.format).toBe("json");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("auto-detects yaml from file path", () => {
    const result = parse("KEY: value\n", "auto", "/project/secrets.yaml");
    expect(result.format).toBe("yaml");
    expect(result.pairs).toEqual({ KEY: "value" });
  });

  it("auto-detects without file path (falls back to content heuristics)", () => {
    const result = parse('{"KEY": "value"}', "auto");
    expect(result.format).toBe("json");
  });
});
