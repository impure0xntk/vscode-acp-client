import { strict as assert } from "assert";
import { getStandardPermissionOptions } from "../../adapter/acp/permissions";

describe("getStandardPermissionOptions", () => {
  it("returns three standard options", () => {
    const options = getStandardPermissionOptions();
    assert.strictEqual(options.length, 3);
  });

  it("includes allow_once", () => {
    const options = getStandardPermissionOptions();
    const allowOnce = options.find((o) => o.optionId === "allow_once");
    assert.ok(allowOnce);
    assert.strictEqual(allowOnce!.kind, "allow_once");
    assert.strictEqual(allowOnce!.name, "Allow once");
  });

  it("includes allow_always", () => {
    const options = getStandardPermissionOptions();
    const allowAlways = options.find((o) => o.optionId === "allow_always");
    assert.ok(allowAlways);
    assert.strictEqual(allowAlways!.kind, "allow_always");
    assert.strictEqual(allowAlways!.name, "Allow always");
  });

  it("includes reject_once", () => {
    const options = getStandardPermissionOptions();
    const reject = options.find((o) => o.optionId === "reject_once");
    assert.ok(reject);
    assert.strictEqual(reject!.kind, "reject_once");
    assert.strictEqual(reject!.name, "Reject");
  });

  it("returns options with unique optionIds", () => {
    const options = getStandardPermissionOptions();
    const ids = options.map((o) => o.optionId);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length);
  });
});
