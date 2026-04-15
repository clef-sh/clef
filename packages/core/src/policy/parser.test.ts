import * as fs from "fs";
import { PolicyValidationError } from "../types";
import { CLEF_POLICY_FILENAME, PolicyParser } from "./parser";
import { DEFAULT_POLICY } from "./types";

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;

describe("PolicyParser", () => {
  let parser: PolicyParser;

  beforeEach(() => {
    parser = new PolicyParser();
    jest.clearAllMocks();
  });

  describe("CLEF_POLICY_FILENAME", () => {
    it("is the canonical relative path", () => {
      expect(CLEF_POLICY_FILENAME).toBe(".clef/policy.yaml");
    });
  });

  describe("load", () => {
    it("returns DEFAULT_POLICY when the file is missing", () => {
      mockExistsSync.mockReturnValue(false);
      expect(parser.load(".clef/policy.yaml")).toBe(DEFAULT_POLICY);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it("parses when the file exists", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("version: 1\nrotation:\n  max_age_days: 30\n");
      const policy = parser.load(".clef/policy.yaml");
      expect(policy).toEqual({ version: 1, rotation: { max_age_days: 30 } });
    });
  });

  describe("parse", () => {
    it("throws when the file cannot be read", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(() => parser.parse(".clef/policy.yaml")).toThrow(PolicyValidationError);
      expect(() => parser.parse(".clef/policy.yaml")).toThrow(/Could not read policy file/);
    });

    it("delegates to parseContent on successful read", () => {
      mockReadFileSync.mockReturnValue("version: 1\n");
      const policy = parser.parse(".clef/policy.yaml");
      expect(policy).toEqual({ version: 1 });
    });
  });

  describe("parseContent", () => {
    it("accepts the minimal valid document", () => {
      expect(parser.parseContent("version: 1\n")).toEqual({ version: 1 });
    });

    it("accepts top-level rotation config", () => {
      const policy = parser.parseContent("version: 1\nrotation:\n  max_age_days: 90\n");
      expect(policy).toEqual({ version: 1, rotation: { max_age_days: 90 } });
    });

    it("accepts per-environment rotation overrides", () => {
      const policy = parser.parseContent(
        [
          "version: 1",
          "rotation:",
          "  max_age_days: 90",
          "  environments:",
          "    production:",
          "      max_age_days: 30",
          "    dev:",
          "      max_age_days: 365",
          "",
        ].join("\n"),
      );
      expect(policy).toEqual({
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: {
            production: { max_age_days: 30 },
            dev: { max_age_days: 365 },
          },
        },
      });
    });

    it("throws on invalid YAML", () => {
      expect(() => parser.parseContent("{{not yaml")).toThrow(PolicyValidationError);
      expect(() => parser.parseContent("{{not yaml")).toThrow(/invalid YAML/);
    });

    it("throws when the root is not an object", () => {
      expect(() => parser.parseContent("- 1\n- 2\n")).toThrow(/must be a YAML object/);
      expect(() => parser.parseContent('"just a string"\n')).toThrow(/must be a YAML object/);
    });

    it("throws on null content", () => {
      expect(() => parser.parseContent("null\n")).toThrow(/must be a YAML object/);
    });

    it("throws when version is not 1", () => {
      expect(() => parser.parseContent("version: 2\n")).toThrow(/'version: 1'/);
      expect(() => parser.parseContent("version: '1'\n")).toThrow(/'version: 1'/);
      expect(() => parser.parseContent("rotation:\n  max_age_days: 1\n")).toThrow(/'version: 1'/);
    });

    it("attaches a 'version' field hint when version is wrong", () => {
      try {
        parser.parseContent("version: 2\n");
        fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyValidationError);
        expect((err as PolicyValidationError).field).toBe("version");
      }
    });

    it("throws when rotation is not an object", () => {
      expect(() => parser.parseContent("version: 1\nrotation: 30\n")).toThrow(
        /'rotation' must be an object/,
      );
      expect(() => parser.parseContent("version: 1\nrotation:\n  - 1\n")).toThrow(
        /'rotation' must be an object/,
      );
    });

    it("throws when rotation.max_age_days is missing or non-positive", () => {
      expect(() => parser.parseContent("version: 1\nrotation: {}\n")).toThrow(/max_age_days/);
      expect(() => parser.parseContent("version: 1\nrotation:\n  max_age_days: 0\n")).toThrow(
        /positive number/,
      );
      expect(() => parser.parseContent("version: 1\nrotation:\n  max_age_days: -1\n")).toThrow(
        /positive number/,
      );
      expect(() =>
        parser.parseContent("version: 1\nrotation:\n  max_age_days: 'thirty'\n"),
      ).toThrow(/positive number/);
    });

    it("rejects Infinity and NaN for max_age_days", () => {
      expect(() => parser.parseContent("version: 1\nrotation:\n  max_age_days: .inf\n")).toThrow(
        /positive number/,
      );
      expect(() => parser.parseContent("version: 1\nrotation:\n  max_age_days: .nan\n")).toThrow(
        /positive number/,
      );
    });

    it("throws when rotation.environments is not an object", () => {
      expect(() =>
        parser.parseContent(
          "version: 1\nrotation:\n  max_age_days: 90\n  environments:\n    - prod\n",
        ),
      ).toThrow(/'rotation.environments' must be an object/);
    });

    it("throws when an environment override is malformed", () => {
      expect(() =>
        parser.parseContent(
          "version: 1\nrotation:\n  max_age_days: 90\n  environments:\n    prod: 30\n",
        ),
      ).toThrow(/'rotation.environments.prod' must be an object/);

      expect(() =>
        parser.parseContent(
          [
            "version: 1",
            "rotation:",
            "  max_age_days: 90",
            "  environments:",
            "    prod:",
            "      max_age_days: 0",
            "",
          ].join("\n"),
        ),
      ).toThrow(/'rotation.environments.prod.max_age_days' must be a positive number/);
    });

    it("attaches the dotted field path on environment override errors", () => {
      try {
        parser.parseContent(
          [
            "version: 1",
            "rotation:",
            "  max_age_days: 90",
            "  environments:",
            "    prod:",
            "      max_age_days: -1",
            "",
          ].join("\n"),
        );
        fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyValidationError);
        expect((err as PolicyValidationError).field).toBe(
          "rotation.environments.prod.max_age_days",
        );
      }
    });

    it("does not include rotation in the result when omitted", () => {
      const policy = parser.parseContent("version: 1\n");
      expect(policy).not.toHaveProperty("rotation");
    });
  });
});
