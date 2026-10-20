import { describe, expect, test } from "vitest";
import { passkeyName } from "./flows";

describe("passkeyName", () => {
  test("keeps this device's name for a passkey made on this device", () => {
    expect(passkeyName({ authenticatorAttachment: "platform", response: { transports: ["internal"] } }, "Windows PC")).toBe("Windows PC");
  });
  test("names a passkey made on a phone over QR, or on a security key, after that device", () => {
    expect(passkeyName({ authenticatorAttachment: "cross-platform", response: { transports: ["hybrid", "internal"] } }, "Windows PC")).toBe("Phone");
    expect(passkeyName({ authenticatorAttachment: "cross-platform", response: { transports: ["usb"] } }, "Windows PC")).toBe("Security key");
  });
});
