import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in child components.
 * Shows a friendly recovery UI instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-full py-24 px-6 text-center">
          <span className="text-4xl mb-4">💥</span>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-sm">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
