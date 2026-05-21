import { Component } from 'react';
import GloAvatar from './GloAvatar';

// Fångar oväntade exceptions i barn-trädet så vi visar en hjälpsam ruta
// istället för en tom skärm. Återställning sker via reload — vi har ingen
// global state-store att rensa, så reload är säkrast.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null });
    // Reload eftersom vi inte vet vilka contexts/queries som hamnat i konstigt
    // tillstånd — fresh fetch är billigare än selektiv recovery.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="paper-texture" style={{ minHeight: '100vh' }}>
        <div className="card card-lg" style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
          <GloAvatar size={140} float mood="sad" style={{ margin: '0 auto 16px' }} />
          <h1 style={{ marginBottom: 6 }}>Oj — Glo trillade av stolen.</h1>
          <p className="t-hand muted" style={{ fontSize: 16, margin: '0 0 18px' }}>
            Något gick fel i frontenden. Inget av dina sparade glosor påverkas. Försök att ladda om sidan.
          </p>
          {import.meta.env.DEV && (
            <pre style={{
              textAlign: 'left', fontSize: 12, background: 'var(--paper-edge)',
              padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 200, marginBottom: 16
            }}>
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          )}
          <button className="btn btn-primary" onClick={this.reset}>Ladda om</button>
        </div>
      </div>
    );
  }
}
