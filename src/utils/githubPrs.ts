export interface PRDeployedEnvironment {
  number: number;
  title: string;
  description: string;
  environmentUrl: string;
  prUrl: string;
}

/**
 * Extracts the first non-empty line of a PR body, removing leading markdown header prefixes (`#`).
 */
export function extractFirstLine(body: string | null | undefined): string {
  if (!body) return 'No description provided.';
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return 'No description provided.';
  return lines[0].replace(/^#+\s*/, '').trim() || 'No description provided.';
}

/**
 * Extracts a Cloudflare Workers preview deployment URL from a PR comment body.
 */
export function extractEnvironmentUrl(commentBody: string | null | undefined): string | null {
  if (!commentBody) return null;
  if (commentBody.includes('Preview Worker Cleaned Up')) return null;

  const match = commentBody.match(/https:\/\/[a-zA-Z0-9-.]+\.workers\.dev[^\s|)<>"]*/i);
  if (match) {
    return match[0];
  }
  return null;
}

/**
 * Fetches open PRs for a GitHub repository and extracts their deployed environment links.
 */
export async function fetchOpenPrsWithDeployments(
  repo = 'tylermercer/durable-objects-webgame-starter',
  fetchFn: typeof fetch = typeof window !== 'undefined' ? window.fetch.bind(window) : fetch
): Promise<PRDeployedEnvironment[]> {
  try {
    const prsResponse = await fetchFn(`https://api.github.com/repos/${repo}/pulls?state=open`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!prsResponse.ok) {
      return [];
    }

    const prs = await prsResponse.json();
    if (!Array.isArray(prs) || prs.length === 0) {
      return [];
    }

    const results: PRDeployedEnvironment[] = [];

    for (const pr of prs) {
      if (!pr || typeof pr !== 'object' || !pr.number) continue;

      const commentsUrl = pr.comments_url || `https://api.github.com/repos/${repo}/issues/${pr.number}/comments`;
      const commentsResponse = await fetchFn(commentsUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });

      if (!commentsResponse.ok) continue;

      const comments = await commentsResponse.json();
      if (!Array.isArray(comments)) continue;

      let environmentUrl: string | null = null;
      // Reverse order to check newest comments first
      for (let i = comments.length - 1; i >= 0; i--) {
        const comment = comments[i];
        if (comment && typeof comment === 'object' && comment.body) {
          const url = extractEnvironmentUrl(comment.body);
          if (url) {
            environmentUrl = url;
            break;
          }
        }
      }

      if (environmentUrl) {
        results.push({
          number: pr.number,
          title: pr.title || `PR #${pr.number}`,
          description: extractFirstLine(pr.body),
          environmentUrl,
          prUrl: pr.html_url || `https://github.com/${repo}/pull/${pr.number}`,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error fetching open PRs with deployments:', error);
    return [];
  }
}
