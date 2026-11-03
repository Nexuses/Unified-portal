export const dynamic = "force-dynamic";
export const revalidate = 0;

type LayoutProps = {
  children: React.ReactNode;
};

export default function PublicLeadReportsTokenLayout({ children }: LayoutProps) {
  return <div className="public-lead-reports-route">{children}</div>;
}
