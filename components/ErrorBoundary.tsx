"use client";
import React from "react";
import { logger } from "../lib/logger";

const log = logger("ErrorBoundary");

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the fallback UI so you know which hub crashed */
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    log.error("component crashed", { label: this.props.label ?? "unknown", err: String(error), stack: info.componentStack ?? "" });
  }

  handleReset = () => this.setState({ hasError: false, message: "" });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 p-8 text-center">
        <div className="text-2xl">⚠</div>
        <p className="text-sm text-gray-400">
          {this.props.label ? `${this.props.label} ran into a problem.` : "Something went wrong."}
        </p>
        {this.state.message && (
          <p className="text-xs text-gray-600 font-mono max-w-sm break-all">{this.state.message}</p>
        )}
        <button
          onClick={this.handleReset}
          className="px-4 py-2 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
