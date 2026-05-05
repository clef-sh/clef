import { MockSecretSource } from "./mock-source";
import {
  describeCapabilities,
  isBulk,
  isLintable,
  isMergeAware,
  isMigratable,
  isRecipientManaged,
  isRotatable,
  isStructural,
} from "./guards";

describe("source/guards", () => {
  it("treats a fully-implemented source as supporting every trait", () => {
    const source = new MockSecretSource();
    expect(isLintable(source)).toBe(true);
    expect(isRotatable(source)).toBe(true);
    expect(isRecipientManaged(source)).toBe(true);
    expect(isMergeAware(source)).toBe(true);
    expect(isMigratable(source)).toBe(true);
    expect(isBulk(source)).toBe(true);
    expect(isStructural(source)).toBe(true);
  });

  it("narrows away each disabled trait independently", () => {
    expect(isLintable(new MockSecretSource({ capabilities: { lint: false } }))).toBe(false);
    expect(isRotatable(new MockSecretSource({ capabilities: { rotate: false } }))).toBe(false);
    expect(isRecipientManaged(new MockSecretSource({ capabilities: { recipients: false } }))).toBe(
      false,
    );
    expect(isMergeAware(new MockSecretSource({ capabilities: { merge: false } }))).toBe(false);
    expect(isMigratable(new MockSecretSource({ capabilities: { migrate: false } }))).toBe(false);
    expect(isBulk(new MockSecretSource({ capabilities: { bulk: false } }))).toBe(false);
    expect(isStructural(new MockSecretSource({ capabilities: { structural: false } }))).toBe(false);
  });

  it("describeCapabilities reports every trait on a fully-implemented source", () => {
    expect(describeCapabilities(new MockSecretSource())).toEqual({
      lint: true,
      rotate: true,
      recipients: true,
      merge: true,
      migrate: true,
      bulk: true,
      structural: true,
    });
  });

  it("describeCapabilities reflects disabled traits", () => {
    const source = new MockSecretSource({
      capabilities: { lint: false, rotate: false, structural: false },
    });
    expect(describeCapabilities(source)).toEqual({
      lint: false,
      rotate: false,
      recipients: true,
      merge: true,
      migrate: true,
      bulk: true,
      structural: false,
    });
  });
});
