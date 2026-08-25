import PortalSessionProvider from "@/app/components/portal/PortalSessionProvider";

export default function WorkspaceLayout({
  children,
}: LayoutProps<"/portal">) {
  return <PortalSessionProvider>{children}</PortalSessionProvider>;
}
