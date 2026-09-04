export interface QrScanResult {
  valid: boolean;
  code?: string;
  targetUrl?: string;
  error?: string;
}

/**
  * Parses and validates a scanned URL string against the expected room join criteria.
  * Ensures the QR code is a valid URL from the same origin as current window,
  * and contains a non-empty `code` query parameter.
  */
export function parseAndValidateJoinUrl(scannedUrlString: string, currentOrigin: string): QrScanResult {
  if (!scannedUrlString || typeof scannedUrlString !== "string") {
    return { valid: false, error: "Invalid QR code contents" };
  }

  let url: URL;
  try {
    url = new URL(scannedUrlString, currentOrigin);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  let expectedOrigin = currentOrigin;
  try {
    expectedOrigin = new URL(currentOrigin).origin;
  } catch {
    // If currentOrigin wasn't a full URL, fallback to raw string
  }

  if (url.origin.toLowerCase() !== expectedOrigin.toLowerCase()) {
    return { valid: false, error: "QR code is for a different site" };
  }

  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return { valid: false, error: "QR code does not contain a room code" };
  }

  return {
    valid: true,
    code: code.toUpperCase(),
    targetUrl: url.toString(),
  };
}
