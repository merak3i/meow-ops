import { Component } from 'react';

// App-shell error boundary. Without this, a render throw in any page (a bad
// data row, a chart lib edge case, a WebGL failure outside the Sanctum's own
// boundary) unmounts the entire app to a blank screen. Here it contains the
// failure to the main content area and keeps the sidebar/navigation alive.
// Parent passes key={page} so navigating to another page clears the error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Page render error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: 400, gap: 12, textAlign: 'center',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32 }}>🙀</div>
          <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>
            This page hit an error
          </h2>
          <p style={{ maxWidth: 420, fontSize: 13, margin: 0 }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <p style={{ fontSize: 12 }}>
            The rest of the dashboard still works — pick another page in the sidebar.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
