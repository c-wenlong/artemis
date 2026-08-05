import type { ReviewSnapshot, WorkspaceSummary } from "@artemis/core";
import "./ReviewSurface.css";

interface ReviewSurfaceProps {
  review: ReviewSnapshot | null;
  workspace: WorkspaceSummary;
}

export function ReviewSurface({ review, workspace }: ReviewSurfaceProps) {
  if (!review) {
    return <div className="review-empty">No review data loaded.</div>;
  }

  return (
    <div className="review-surface">
      <section className="review-header">
        <div>
          <h3>{workspace.name}</h3>
          <p>
            Comparing {workspace.branch} against {review.baseBranch}
          </p>
        </div>
        <strong>{review.files.length} files</strong>
      </section>

      <div className="changed-files">
        {review.files.length === 0 ? (
          <div className="review-empty">No changes in this workspace yet.</div>
        ) : (
          review.files.map((file) => (
            <div className="changed-file" key={file.path}>
              <div>
                <strong>{file.path}</strong>
                <span>{file.kind}</span>
              </div>
              <code>
                +{file.additions} / -{file.deletions}
              </code>
            </div>
          ))
        )}
      </div>

      {review.artifactPaths.length > 0 ? (
        <section className="artifact-list">
          <h4>Artifacts</h4>
          {review.artifactPaths.map((artifact) => (
            <code key={artifact}>{artifact}</code>
          ))}
        </section>
      ) : null}
    </div>
  );
}
