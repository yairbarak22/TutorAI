import { Component, type ReactNode } from "react";

/** Last line of defense: never leave the student with a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-[12vh] max-w-lg space-y-4 rounded-2xl border border-red-200 bg-white p-6 text-center shadow">
        <div className="text-4xl">😕</div>
        <h1 className="text-xl font-bold">משהו השתבש</h1>
        <p className="text-slate-600">הנתונים שלכם שמורים. נסו לטעון מחדש. אם זה חוזר, דווחו לנו ב-GitHub עם הפרטים הבאים:</p>
        <pre dir="ltr" className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-start text-xs">{this.state.error.message}</pre>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-white" onClick={() => location.reload()}>
          טעינה מחדש
        </button>
      </div>
    );
  }
}
