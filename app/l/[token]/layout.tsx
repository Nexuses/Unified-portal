export const dynamic = "force-dynamic";
export const revalidate = 0;

type LayoutProps = {
  children: React.ReactNode;
};

export default function PublicLeadTokenLayout({ children }: LayoutProps) {
  return <div className="public-lead-report-route">{children}</div>;
}
