import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { crashDetails, describe, lastLogLines, reportError } from './crash';
import { useStore } from './store';

interface Props {
  /** `game`: the table, which the player leaves to the menu; `menu`: the menu, which tries again. */
  where: 'game' | 'menu';
  children: ReactNode;
}

interface State {
  error: unknown;
  componentStack?: string;
  /** The program's build, once it has written the error to its log; null without a program. */
  version: string | null;
  copied: boolean;
}

/**
 * Drawing the screen threw. Instead of a blank page, this says what went wrong, shows the
 * game's last log lines, and offers to copy the details and to leave. The error also goes
 * to the program's log (crash.ts). A class: only a class component can catch errors (React).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, version: null, copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown error') };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? undefined });
    void reportError('render', error, info.componentStack ? `While drawing:${info.componentStack}` : undefined).then((logged) => {
      if (logged) this.setState({ version: logged.version });
    });
  }

  private copy = () => {
    const text = crashDetails(this.state.error, this.state.componentStack, this.state.version);
    navigator.clipboard?.writeText(text).then(
      () => this.setState({ copied: true }),
      () => window.prompt('Copy the details:', text),
    );
  };

  /** Leaves the game the way Exit does (`quit`): at a table, that leaves the table. The menu just tries again. */
  private leave = () => {
    if (this.props.where === 'game') useStore.getState().quit();
    this.setState({ error: null, componentStack: undefined, copied: false });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { message } = describe(this.state.error);
    const lines = lastLogLines();
    return (
      <div className="stage crash">
        <div className="crash-box" role="alert">
          <h1>Something went wrong</h1>
          <p>The game hit an error it couldn't get past.</p>
          <pre className="crash-error">{message}</pre>
          {lines.length > 0 && (
            <>
              <h2>Last moves</h2>
              <ol className="crash-log">
                {lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </>
          )}
          <p className="crash-where">
            {this.state.version
              ? 'The details were also written to the program’s log, launcher.log in the ArenaEDH-data folder beside ArenaEDH.exe.'
              : 'Copy the details and send them with a few words on what was happening.'}
          </p>
          <div className="game-over-buttons">
            <button className="btn btn-plain small" onClick={this.copy}>
              <span className="btn-label">{this.state.copied ? 'Copied' : 'Copy Details'}</span>
            </button>
            <button className="btn btn-go small" onClick={this.leave}>
              <span className="btn-label">{this.props.where === 'game' ? 'Leave to Menu' : 'Try Again'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
