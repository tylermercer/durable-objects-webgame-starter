import { useEffect, useState } from 'react';
import { fetchOpenPrsWithDeployments, type PRDeployedEnvironment } from '@utils/githubPrs';

const PROD_HOSTNAME = 'durable-objects-webgame-starter.tmercer.workers.dev';
const PROD_URL = 'https://durable-objects-webgame-starter.tmercer.workers.dev';

export function WipVersionsBadge() {
  const [environments, setEnvironments] = useState<PRDeployedEnvironment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNotProd, setIsNotProd] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname !== PROD_HOSTNAME) {
      setIsNotProd(true);
    }

    let isMounted = true;
    fetchOpenPrsWithDeployments()
      .then((data) => {
        if (isMounted) {
          setEnvironments(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const openPrs = environments.filter((env) => !env.isDraft);
  const draftPrs = environments.filter((env) => env.isDraft);

  const hasPrEnvironments = !isLoading && environments.length > 0;

  if (!hasPrEnvironments && !isNotProd) {
    return null;
  }

  return (
    <div className="wip-badge-container">
      {isNotProd && (
        <a href={PROD_URL} className="wip-badge wip-stable-badge">
          You're trying a WIP version of these games. Click here to go to the stable version.
        </a>
      )}

      {hasPrEnvironments && (
        <button
          type="button"
          className="wip-badge"
          onClick={() => setIsModalOpen(true)}
        >
          🚀 try a WIP version here
        </button>
      )}

      {isModalOpen && (
        <div className="wip-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div
            className="wip-modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wip-modal-title"
          >
            <div className="wip-modal-header">
              <h2 id="wip-modal-title" className="wip-modal-title">
                Work in Progress Environments
              </h2>
              <button
                type="button"
                className="wip-modal-close"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <p className="wip-modal-subtitle">
              Select an open pull request environment to switch to that version:
            </p>

            {openPrs.length > 0 && (
              <div className="wip-modal-section">
                <h3 className="wip-section-title">Open Pull Requests</h3>
                <ul className="wip-pr-list" role="list">
                  {openPrs.map((env) => (
                    <li key={env.number} className="wip-pr-item" role="listitem">
                      <a href={env.environmentUrl} className="wip-pr-link">
                        <div className="wip-pr-title">
                          PR #{env.number}: {env.title}
                        </div>
                        <div className="wip-pr-desc">{env.description}</div>
                        <div className="wip-pr-url">{env.environmentUrl} ↗</div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draftPrs.length > 0 && (
              <div className="wip-modal-section">
                <h3 className="wip-section-title">Draft PRs</h3>
                <ul className="wip-pr-list" role="list">
                  {draftPrs.map((env) => (
                    <li key={env.number} className="wip-pr-item wip-draft-item" role="listitem">
                      <a href={env.environmentUrl} className="wip-pr-link">
                        <div className="wip-pr-title">
                          <span className="wip-draft-tag">Draft</span> PR #{env.number}: {env.title}
                        </div>
                        <div className="wip-pr-desc">{env.description}</div>
                        <div className="wip-pr-url">{env.environmentUrl} ↗</div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .wip-badge-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .wip-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--primary-12, #ffe2c0);
          background: var(--primary-3, #30200b);
          border: 1px solid var(--primary-6, #5e3c0b);
          border-radius: 20px;
          cursor: pointer;
          text-decoration: none;
          transition: transform 0.15s ease, background-color 0.15s ease;
        }

        .wip-badge:hover {
          background: var(--primary-4, #422500);
          transform: translateY(-1px);
        }

        .wip-stable-badge {
          background: var(--gray-3, #222325);
          color: var(--gray-12, #eeeef0);
          border-color: var(--gray-6, #393a40);
          font-size: 0.875rem;
        }

        .wip-stable-badge:hover {
          background: var(--gray-4, #292a2e);
        }

        .wip-modal-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          z-index: 1000;
        }

        .wip-modal-content {
          background: var(--gray-2, #19191b);
          color: var(--gray-12, #eeeef0);
          border: 1px solid var(--gray-6, #393a40);
          border-radius: 12px;
          width: 100%;
          max-width: 500px;
          padding: 1.5rem;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-height: calc(100dvh - 2rem);
          box-sizing: border-box;
          overflow-y: auto;
        }

        .wip-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .wip-modal-title {
          font-size: 1.2rem;
          font-weight: 700;
          margin: 0;
        }

        .wip-modal-subtitle {
          font-size: 0.9rem;
          color: var(--gray-11, #b2b3bd);
          margin: 0;
          text-align: left;
        }

        .wip-modal-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          text-align: left;
        }

        .wip-section-title {
          font-size: 0.9rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--gray-11, #b2b3bd);
          margin: 0.5rem 0 0 0;
        }

        .wip-modal-close {
          background: transparent;
          border: none;
          color: var(--gray-11, #b2b3bd);
          font-size: 1.2rem;
          cursor: pointer;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
        }

        .wip-modal-close:hover {
          background: var(--gray-4, #292a2e);
          color: var(--gray-12, #eeeef0);
        }

        .wip-pr-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .wip-pr-item {
          border: 1px solid var(--gray-5, #303136);
          border-radius: 8px;
          background: var(--gray-3, #222325);
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }

        .wip-pr-item:hover {
          border-color: var(--primary-8, #926323);
          background: var(--gray-4, #292a2e);
        }

        .wip-draft-tag {
          display: inline-block;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          background: var(--gray-6, #393a40);
          color: var(--gray-11, #b2b3bd);
          margin-right: 0.4rem;
          vertical-align: middle;
        }

        .wip-pr-link {
          display: block;
          padding: 1rem;
          text-decoration: none;
          color: inherit;
          text-align: left;
        }

        .wip-pr-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--primary-11, #ffb348);
          margin-bottom: 0.25rem;
        }

        .wip-pr-desc {
          font-size: 0.85rem;
          color: var(--gray-11, #b2b3bd);
          margin-bottom: 0.5rem;
          line-height: 1.4;
          word-break: break-word;
        }

        .wip-pr-url {
          font-size: 0.75rem;
          color: var(--gray-9, #6c6e79);
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}
