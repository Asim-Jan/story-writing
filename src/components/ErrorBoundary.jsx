import React from 'react';
import { AlertCircle } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-8">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-8 h-8 text-red-600 flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-red-800 mb-2">Something went wrong</h2>
                <p className="text-red-700 mb-4">
                  The application encountered an error. Please try refreshing the page.
                </p>

                {this.state.error && (
                  <details className="mb-4">
                    <summary className="cursor-pointer font-semibold text-red-800 mb-2">
                      Error Details
                    </summary>
                    <div className="bg-white p-4 rounded border border-red-200 font-mono text-sm">
                      <p className="text-red-700 mb-2">{this.state.error.toString()}</p>
                      {this.state.errorInfo && (
                        <pre className="text-gray-600 text-xs overflow-auto">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      )}
                    </div>
                  </details>
                )}

                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
