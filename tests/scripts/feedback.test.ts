import { describe, it, expect } from "vitest";
import { faceEmojiToValue } from "../../src/scripts/feedback";

describe("faceEmojiToValue", () => {
  it("maps each known emoji to its canonical value", () => {
    expect(faceEmojiToValue("😴")).toBe("sleepy");
    expect(faceEmojiToValue("🙂")).toBe("smile");
    expect(faceEmojiToValue("😊")).toBe("grin");
    expect(faceEmojiToValue("😍")).toBe("heart");
    expect(faceEmojiToValue("🤯")).toBe("mindblown");
  });
  it("returns null for unknown input", () => {
    expect(faceEmojiToValue("👀")).toBeNull();
    expect(faceEmojiToValue("")).toBeNull();
  });
});
