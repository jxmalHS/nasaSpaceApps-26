import { Component } from 'react';

/** Keeps one broken part from blanking the whole page. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[Analog Atlas]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error);
    return (
      <div className="empty" role="alert" style={{ minHeight: 240, alignContent: 'center' }}>
        <b>This part of the page failed to load.</b>
        <span className="small dim">{String(this.state.error?.message || this.state.error).slice(0, 200)}</span>
        <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
