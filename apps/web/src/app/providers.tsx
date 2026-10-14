import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { useScene } from "../features/scene/sceneStore";
import { loadProfile, saveProfile } from "../lib/profileStore";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  useEffect(() => {
    useScene.getState().setProfile(loadProfile());
    return useScene.subscribe((s, prev) => {
      if (s.profile !== prev.profile) saveProfile(s.profile);
    });
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
