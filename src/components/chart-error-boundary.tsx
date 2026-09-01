import React, { type ReactNode } from "react";
import { BarChart3 } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Chart render error caught by ChartErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center h-full min-h-[160px] py-6 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 opacity-40 mb-2" />
            <p className="text-xs">Chart data unavailable</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

