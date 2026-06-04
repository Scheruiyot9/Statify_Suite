import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-screen items-center justify-center bg-gray-50 p-8">
          <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-lg">
            <h2 className="mb-2 text-lg font-bold text-red-700">Something went wrong</h2>
            <pre className="overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-800">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
