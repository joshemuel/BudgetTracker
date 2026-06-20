import { Link } from "react-router-dom";

export default function Pending() {
  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md anim-in card p-8 sm:p-10 text-center">
        <span
          aria-hidden="true"
          className="grid place-items-center w-12 h-12 rounded-2xl shrink-0 shadow-sm mx-auto"
          style={{ backgroundColor: "var(--section-wash)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--section-edge)" }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>

        <p className="smallcaps text-ink-mute mt-6">Awaiting Approval</p>
        <h1 className="display text-3xl sm:text-4xl text-ink mt-3">
          You're on the list
        </h1>
        <div className="mt-5 h-[3px] rounded-full mx-auto w-16" style={{ background: "var(--section-edge)" }} />

        <p className="mt-7 text-ink-soft leading-relaxed">
          Thanks for signing in with Google. Your account has been created and is
          waiting for an administrator to approve access. You'll be able to enter
          the ledger as soon as that's done — just sign in again.
        </p>

        <Link
          to="/login"
          className="mt-8 inline-block smallcaps px-5 py-2.5 rounded-full text-white shadow-sm hover:brightness-110 transition-all duration-150 active:scale-95"
          style={{ backgroundColor: "var(--section-edge)" }}
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
