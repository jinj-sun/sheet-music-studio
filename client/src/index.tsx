import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import './index.css';
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal">
          <h1>工作台遇到错误</h1>
          <p>{this.state.error}</p>
          <p>已保存的项目仍在此浏览器中。</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
