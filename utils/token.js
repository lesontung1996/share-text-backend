const crypto = require("crypto");

/**
 * Generates a cryptographically secure random token.
 * Uses 32 bytes = 256 bits of entropy — enough that brute force
 * is computationally infeasible.
 *
 * Output example: "a3f8c21b9e4d7f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Constant-time comparison — prevents timing attacks when validating tokens.
 * Always use this instead of === when comparing secrets.
 */
function safeCompare(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false; // buffers were different lengths
  }
}

module.exports = { generateToken, safeCompare };
