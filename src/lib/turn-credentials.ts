export async function mintMeteredCredentials(env: {
  METERED_APP_DOMAIN?: string;
  METERED_SECRET_KEY?: string;
}): Promise<{ iceServers: RTCIceServer[]; expiryInSeconds: number } | null> {
  if (!env.METERED_APP_DOMAIN || !env.METERED_SECRET_KEY) return null;

  const expiryInSeconds = 4 * 3600;
  try {
    const resp = await fetch(
      `https://${env.METERED_APP_DOMAIN}.metered.live/api/v1/turn/credential?secretKey=${env.METERED_SECRET_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryInSeconds, label: "webgame" })
      }
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as { username?: string; password?: string };
    if (!data.username || !data.password) return null;

    return {
      expiryInSeconds,
      iceServers: [
        {
          urls: [
            `turn:${env.METERED_APP_DOMAIN}.metered.live:80`,
            `turn:${env.METERED_APP_DOMAIN}.metered.live:443`,
            `turns:${env.METERED_APP_DOMAIN}.metered.live:443`
          ],
          username: data.username,
          credential: data.password
        }
      ]
    };
  } catch {
    return null;
  }
}
