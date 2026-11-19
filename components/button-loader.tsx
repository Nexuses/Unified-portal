import type { ReactNode } from "react";

type ButtonLoaderProps = {
  className?: string;
};

export function ButtonLoader({ className = "h-3.5 w-3.5 shrink-0" }: ButtonLoaderProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

type ButtonLoadingContentProps = {
  loading: boolean;
  loadingText?: string;
  children: ReactNode;
  iconOnly?: boolean;
};

/** Spinner + label for buttons while an async action runs. */
export function ButtonLoadingContent({
  loading,
  loadingText,
  children,
  iconOnly = false,
}: ButtonLoadingContentProps) {
  if (!loading) {
    return <>{children}</>;
  }
  if (iconOnly) {
    return <ButtonLoader className="h-4 w-4" />;
  }
  return (
    <>
      <ButtonLoader />
      <span>{loadingText ?? children}</span>
    </>
  );
}
