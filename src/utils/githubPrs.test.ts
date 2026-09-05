import { describe, expect, it, vi } from 'vitest';
import {
  extractEnvironmentUrl,
  extractFirstLine,
  fetchOpenPrsWithDeployments,
} from './githubPrs.ts';

describe('githubPrs utility', () => {
  describe('extractFirstLine', () => {
    it('returns default message when body is null or empty', () => {
      expect(extractFirstLine(null)).toBe('No description provided.');
      expect(extractFirstLine(undefined)).toBe('No description provided.');
      expect(extractFirstLine('')).toBe('No description provided.');
      expect(extractFirstLine('   \n  \n  ')).toBe('No description provided.');
    });

    it('extracts first non-empty line and strips leading markdown headers', () => {
      expect(extractFirstLine('## Summary of changes\nFirst line body\nSecond line')).toBe(
        'Summary of changes'
      );
      expect(extractFirstLine('\n\n  ###   Fixes bug in controller  \nMore details...')).toBe(
        'Fixes bug in controller'
      );
      expect(extractFirstLine('Plain description text\nWith second line')).toBe(
        'Plain description text'
      );
    });
  });

  describe('extractEnvironmentUrl', () => {
    it('returns null for null, empty, or non-matching comments', () => {
      expect(extractEnvironmentUrl(null)).toBeNull();
      expect(extractEnvironmentUrl(undefined)).toBeNull();
      expect(extractEnvironmentUrl('Just a standard comment with no links')).toBeNull();
    });

    it('extracts Cloudflare Workers preview URL from comment body', () => {
      const comment = `## Deployed to Cloudflare Workers! :rocket:

| Name                    | Result |
| ----------------------- | - |
| **Preview URL**:        | https://feat-test-branch-durable-objects-webgame-starter.tmercer.workers.dev |
| **Last commit:**        | \`aacb44b\` |`;

      expect(extractEnvironmentUrl(comment)).toBe(
        'https://feat-test-branch-durable-objects-webgame-starter.tmercer.workers.dev'
      );
    });

    it('returns null if the worker was cleaned up', () => {
      const comment = `## Preview Worker Cleaned Up :wastebasket:

The preview worker for branch \`feat/test\` (https://feat-test.tmercer.workers.dev) has been deleted.`;

      expect(extractEnvironmentUrl(comment)).toBeNull();
    });
  });

  describe('fetchOpenPrsWithDeployments', () => {
    it('fetches open PRs and extracts deployed environment information', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/pulls?state=open')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                number: 10,
                title: 'Add New Game Mode',
                body: '## Feature description\nImplementation of game mode',
                html_url: 'https://github.com/test/repo/pull/10',
                comments_url: 'https://api.github.com/repos/test/repo/issues/10/comments',
              },
              {
                number: 11,
                title: 'Refactor transport',
                body: 'No deployment for this one yet',
                html_url: 'https://github.com/test/repo/pull/11',
                comments_url: 'https://api.github.com/repos/test/repo/issues/11/comments',
              },
            ],
          });
        }
        if (url.includes('/issues/10/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                body: '## Deployed to Cloudflare Workers!\n| **Preview URL**: | https://pr-10-webgame.tmercer.workers.dev |',
              },
            ],
          });
        }
        if (url.includes('/issues/11/comments')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                body: 'Standard code review comment without environment URL',
              },
            ],
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const results = await fetchOpenPrsWithDeployments('test/repo', mockFetch as unknown as typeof fetch);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        number: 10,
        title: 'Add New Game Mode',
        description: 'Feature description',
        environmentUrl: 'https://pr-10-webgame.tmercer.workers.dev',
        prUrl: 'https://github.com/test/repo/pull/10',
      });
    });

    it('returns empty array when API request fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      const results = await fetchOpenPrsWithDeployments('test/repo', mockFetch as unknown as typeof fetch);
      expect(results).toEqual([]);
    });
  });
});
