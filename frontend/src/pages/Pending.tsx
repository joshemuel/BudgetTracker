import { Link } from "react-router-dom";

export default function Pending() {
  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md anim-in relative text-center">
        <div className="deco-cross" style={{ top: -6, left: -6 }} />
        <div className="deco-cross" style={{ top: -6, right: -6 }} />
        <div className="deco-cross" style={{ bottom: -6, left: -6 }} />
        <div className="deco-cross" style={{ bottom: -6, right: -6 }} />

        <p className="smallcaps text-ink-mute">Awaiting Approval</p>
        <h1 className="text-4xl font-semibold tracking-tight text-ink mt-3">
          You're on the list
        </h1>
        <div className="mt-5 h-[1px] bg-ink mx-auto w-16" />

        <p className="mt-8 text-ink-soft leading-relaxed">
          Thanks for signing in with Google. Your account has been created and is
          waiting for an administrator to approve access. You'll be able to enter
          the ledger as soon as that's done — just sign in again.
        </p>

        <Link
          to="/login"
          className="mt-8 inline-block smallcaps px-4 py-2 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
