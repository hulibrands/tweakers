const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("account menu screenshot shows Accounts before Usage remaining", { skip: !process.env.ACCOUNT_SWITCHER_SCREENSHOT }, () => {
  const screenshot = process.env.ACCOUNT_SWITCHER_SCREENSHOT;
  assert.ok(existsSync(screenshot), `screenshot not found: ${screenshot}`);

  let ocr;
  try {
    ocr = execFileSync("tesseract", [screenshot, "stdout", "--psm", "6"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`failed to OCR account menu screenshot: ${error.stderr || error.message}`);
  }

  const text = ocr.replace(/\s+/g, " ").trim().toLowerCase();
  const accountsIndex = text.indexOf("accounts");
  const usageIndex = text.indexOf("usage remaining");
  assert.notEqual(accountsIndex, -1, `missing Accounts row in screenshot OCR: ${text}`);
  assert.notEqual(usageIndex, -1, `missing Usage remaining row in screenshot OCR: ${text}`);
  assert.ok(
    accountsIndex < usageIndex,
    `Accounts must appear before Usage remaining in screenshot OCR: ${text}`,
  );
});
