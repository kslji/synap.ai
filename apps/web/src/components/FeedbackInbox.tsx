"use client";

export function FeedbackInbox({ refreshKey: _refreshKey = 0 }: { refreshKey?: number }) {
  return (
    <div className="data-card fb-inbox">
      <div className="tiny muted">Human feedback</div>
      <p className="tiny muted data-card-note">
        Feedback goes to our backend so we can fix issues quickly.
      </p>
    </div>
  );
}
