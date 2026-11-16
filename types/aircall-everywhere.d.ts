declare module "aircall-everywhere" {
  export type AircallWorkspaceSettings = {
    debug?: boolean;
    domToLoadWorkspace?: string;
    integrationToLoad?: string;
    size?: "big" | "small" | "auto";
    workspaceUrl?: string;
    path?: string;
    window?: Window;
    onLogin?: (payload: {
      user?: {
        email?: string;
        first_name?: string;
        last_name?: string;
        company_name?: string;
      };
      settings?: Record<string, unknown>;
    }) => void;
    onLogout?: () => void;
  };

  export default class AircallWorkspace {
    constructor(settings?: AircallWorkspaceSettings);
    on(eventName: string, callback: (data: unknown) => void): void;
    removeListener(eventName: string): boolean;
    send(
      eventName: string,
      payloadOrCallback?:
        | Record<string, unknown>
        | ((success: boolean, data: unknown) => void),
      callback?: (success: boolean, data: unknown) => void,
    ): boolean | void;
    isLoggedIn(callback: (success: boolean, data: unknown) => void): void;
  }
}
