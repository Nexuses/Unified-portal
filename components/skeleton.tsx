type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-black/[0.07] ${className}`}
      aria-hidden
    />
  );
}

export function SubmissionsCalendarCardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="rounded-xl border border-black/10 bg-[#fafaf8] p-4"
        >
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-3 h-4 w-full max-w-[240px]" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function FormFieldSkeleton({ className = "h-11 w-full rounded-xl" }: SkeletonProps) {
  return <Skeleton className={className} />;
}

export function DashboardPageSkeleton() {
  return (
    <section className="rounded-3xl border border-black/10 bg-white p-7 shadow-[0_25px_80px_-60px_rgba(0,0,0,0.55)]">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-2xl border border-black/10 bg-[#fafaf8] p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {[0, 1].map((panel) => (
          <div key={panel} className="rounded-2xl border border-black/10 p-5">
            <Skeleton className="h-5 w-52" />
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="flex items-center justify-between rounded-xl border border-black/8 bg-[#fafaf8] px-3 py-3"
                >
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AllEventPageSkeleton() {
  return (
    <section className="rounded-3xl border border-black/10 bg-white p-7 shadow-[0_25px_80px_-60px_rgba(0,0,0,0.55)]">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-full max-w-md" />

      <div className="mt-8 space-y-8">
        {[0, 1].map((group) => (
          <div key={group}>
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((card) => (
                <div
                  key={card}
                  className="rounded-2xl border border-black/10 bg-white p-4"
                >
                  <div className="mb-3 flex justify-between">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="mt-3 h-4 w-3/4" />
                  <div className="mt-4 flex gap-2">
                    <Skeleton className="h-8 w-24 rounded-lg" />
                    <Skeleton className="h-8 w-28 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SubmissionsTableSkeleton({ showCsvSection = false }: { showCsvSection?: boolean }) {
  return (
    <div>
      {showCsvSection ? (
        <div className="mb-4 rounded-xl border border-black/10 bg-[#fafaf8] p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-2 h-3 w-full max-w-md" />
          <Skeleton className="mt-3 h-9 w-32 rounded-lg" />
        </div>
      ) : null}
      <Skeleton className="mb-3 h-3 w-56" />
      <div className="overflow-hidden rounded-xl border border-black/10">
        <div className="grid grid-cols-[minmax(120px,1.1fr)_minmax(160px,1.2fr)_minmax(110px,0.9fr)_minmax(170px,1.1fr)_32px] border-b border-black/10 bg-[#f7f7f5] px-3 py-2.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
          <span />
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="grid grid-cols-[minmax(120px,1.1fr)_minmax(160px,1.2fr)_minmax(110px,0.9fr)_minmax(170px,1.1fr)_32px] items-center border-b border-black/8 px-3 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-[85%]" />
            <Skeleton className="h-4 w-[90%]" />
            <Skeleton className="h-4 w-[70%]" />
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="ml-auto h-7 w-7 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
