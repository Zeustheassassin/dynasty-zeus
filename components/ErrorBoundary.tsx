"use client";
import React from "react";
import { logger } from "../lib/logger";

const log = logger("ErrorBoundary");

const MAX_RETRIES = 3;

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
  retries: number;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "", retries: 0 };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    log.error("component crashed", {
      label: this.props.label ?? "unknown",
      err: String(error),
      retries: this.state.retries,
      stack: info.componentStack ?? "",
    });
  }

  handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      message: "",
      retries: prev.retries + 1,
    }));
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const exhausted = this.state.retries >= MAX_RETRIES;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center min-h-[200px] gap-4 p-8 text-center"
      >
        <div className="text-2xl" aria-hidden="true">⚠</div>
        <p className="text-sm text-gray-400">
          {this.props.label
            ? `${this.props.label} ran into a problem.`
            : "Something went wrong."}
        </p>
        {this.state.message && (
          <p className="text-xs text-gray-600 font-mono max-w-sm break-all">
            {this.state.message}
          </p>
        )}
        {exhausted ? (
          <p className="text-xs text-gray-500">
            Still failing after {MAX_RETRIES} attempts. Try refreshing the page.
          </p>
        ) : (
          <button
            onClick={this.handleReset}
            className="px-4 py-2 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
          >
            {this.state.retries > 0
              ? `Retry (${this.state.retries}/${MAX_RETRIES})`
              : "Try again"}
          </button>
        )}
      </div>
    );
  }
}
